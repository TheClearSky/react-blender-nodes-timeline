#!/usr/bin/env node
/**
 * check-dist-types.ts (codegen-plugin pattern)
 *
 * Build gate: type-check the rolled-up declaration bundle (dist/index.d.ts)
 * the way a CONSUMER compiles against it, so any import specifier that
 * escapes the published package surfaces as a hard error. A clean rollup
 * imports ONLY bare externals — here `react` and `zod`; the OPTIONAL host
 * peer must never appear (host-less consumers would break — review UI-8).
 *
 * Run: node --experimental-strip-types scripts/check-dist-types.ts
 */
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const bundlePath = fileURLToPath(
  new URL('../dist/index.d.ts', import.meta.url),
);
const normalizedBundlePath = bundlePath.replace(/\\/g, '/');

const compilerOptions: ts.CompilerOptions = {
  noEmit: true,
  skipLibCheck: false,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  // Strict-mode consumers must see a clean d.ts (review UI-20).
  strict: true,
  types: [],
};

const program = ts.createProgram([bundlePath], compilerOptions);
// Keep bundle-file diagnostics AND file-less (global/option) diagnostics —
// dropping the latter hid whole error classes (review UI-20).
const bundleDiagnostics = ts
  .getPreEmitDiagnostics(program)
  .filter(
    (diagnostic) =>
      diagnostic.file === undefined ||
      diagnostic.file.fileName.replace(/\\/g, '/') === normalizedBundlePath,
  );

if (bundleDiagnostics.length > 0) {
  const formatHost: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
  };
  process.stderr.write(
    '[check-dist-types] dist/index.d.ts does not type-check as a standalone published bundle:\n\n',
  );
  process.stderr.write(
    ts.formatDiagnosticsWithColorAndContext(bundleDiagnostics, formatHost) +
      '\n',
  );
  process.exit(1);
}

// The bundle must import nothing but the declared bare externals — anything
// else means a type escaped the package. The HOST is deliberately NOT
// allowed: it is an optional peer, and a d.ts import of it breaks host-less
// consumers (review UI-8 — the picker props are structural for this
// reason).
const bundleText = ts.sys.readFile(bundlePath) ?? '';
const allowedImports = new Set(['react', 'react/jsx-runtime', 'zod']);
const importSpecifierRe = /(?:from|import)\s*\(?\s*['"]([^'"\n]+)['"]/g;
const unexpectedImports = [
  ...new Set(
    Array.from(bundleText.matchAll(importSpecifierRe), (match) => match[1]),
  ),
].filter((specifier) => !allowedImports.has(specifier));
if (unexpectedImports.length > 0) {
  process.stderr.write(
    '[check-dist-types] dist/index.d.ts imports unexpected module(s): ' +
      unexpectedImports.join(', ') +
      '. The published bundle must import ONLY react / react/jsx-runtime / zod.\n',
  );
  process.exit(1);
}
// Triple-slash reference directives widen the consumer contract past the
// import scan (review UI-20) — none are allowed.
const referenceDirectives = bundleText
  .split('\n')
  .filter((line) => /^\s*\/\/\/\s*<reference/.test(line));
if (referenceDirectives.length > 0) {
  process.stderr.write(
    '[check-dist-types] dist/index.d.ts contains triple-slash reference directive(s):\n' +
      referenceDirectives.join('\n') +
      '\n',
  );
  process.exit(1);
}

process.stdout.write(
  '[check-dist-types] OK — dist/index.d.ts type-checks standalone; imports stay within the declared externals.\n',
);
