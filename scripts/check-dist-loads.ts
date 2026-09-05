#!/usr/bin/env node
/**
 * check-dist-loads.ts (codegen-plugin pattern)
 *
 * Build gate: EXECUTE the shipped artifacts the way consumers load them, so
 * a bundle that crashes at import time — or a manifest that names a file the
 * build never emits — fails the build instead of the consumer's first
 * install. The host's 0.0.x line shipped both failure classes with every
 * gate green (manifest named `.umd.cjs` while the build emitted `.umd.js`;
 * both bundles threw a circular-import TDZ `ReferenceError` at import time);
 * this plugin gets the same protection from day one.
 *
 * Steps (all run; failures aggregate):
 *   1. Preflight — `react` and `zod` must resolve or the probes would
 *      false-fail (environment, not a dist defect). Unlike the codegen
 *      plugin, the host peer is NOT preflighted: it is a TYPE-ONLY optional
 *      peer the runtime bundle never imports, so probes succeed without it.
 *   2. Existence — every file the manifest points at exists in dist/
 *      (including exports["./style.css"]).
 *   3. Coherence — `main`/`module` agree with `exports["."]`.
 *   4. Execution probes — one CHILD PROCESS per entry (CJS + ESM).
 *   5. Sentinels — the EXACT public runtime surface listed in
 *      EXPECTED_EXPORTS below. That list MUST grow in lockstep with
 *      src/index.ts at every T-step — a deliberate coherence gate: a surface
 *      change that skips this list fails the build until acknowledged here.
 *
 * Run: node --experimental-strip-types scripts/check-dist-loads.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// tsconfig.node.json has no `resolveJsonModule`, so the manifest is read
// manually and typed narrowly.
type PackageManifest = {
  version?: string;
  main?: string;
  module?: string;
  types?: string;
  exports?: Record<string, string | Record<string, string>>;
};

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageManifest;

const failures: string[] = [];
function pass(label: string, detail: string): void {
  process.stdout.write(`[check-dist-loads] PASS ${label} — ${detail}\n`);
}
function fail(label: string, detail: string): void {
  failures.push(label);
  process.stderr.write(`[check-dist-loads] FAIL ${label} — ${detail}\n`);
}

// ─── 1. Preflight: the runtime peers the bundles DO import must resolve ──
for (const runtimePeer of ['react', 'zod']) {
  try {
    createRequire(import.meta.url).resolve(runtimePeer);
  } catch {
    process.stderr.write(
      `[check-dist-loads] environment: the \`${runtimePeer}\` peer is not installed — run \`npm install\`. NOT a dist defect. Aborting before probes that would all false-fail.\n`,
    );
    process.exit(1);
  }
}

// ─── 2. Existence ───────────────────────────────────────────────────────
function collectManifestTargets(m: PackageManifest): Map<string, string> {
  const targets = new Map<string, string>();
  if (m.main) targets.set('main', m.main);
  if (m.module) targets.set('module', m.module);
  if (m.types) targets.set('types', m.types);
  for (const [entry, value] of Object.entries(m.exports ?? {})) {
    if (typeof value === 'string') {
      targets.set(`exports["${entry}"]`, value);
    } else {
      for (const [condition, target] of Object.entries(value)) {
        targets.set(`exports["${entry}"].${condition}`, target);
      }
    }
  }
  return targets;
}

for (const [label, relativePath] of collectManifestTargets(manifest)) {
  const absolutePath = fileURLToPath(
    new URL(`../${relativePath}`, import.meta.url),
  );
  if (existsSync(absolutePath)) {
    pass(`exists ${label}`, relativePath);
  } else {
    fail(
      `exists ${label}`,
      `${relativePath} is named by the manifest but was not emitted to dist/`,
    );
  }
}

// ─── 3. Coherence ───────────────────────────────────────────────────────
const rootExport = manifest.exports?.['.'];
if (rootExport === undefined || typeof rootExport === 'string') {
  fail('coherence', 'exports["."] must be a conditions object');
} else {
  if (manifest.main === rootExport.require) {
    pass('coherence main', `main === exports["."].require (${manifest.main})`);
  } else {
    fail(
      'coherence main',
      `main (${manifest.main}) !== exports["."].require (${rootExport.require})`,
    );
  }
  if (manifest.module === rootExport.import) {
    pass(
      'coherence module',
      `module === exports["."].import (${manifest.module})`,
    );
  } else {
    fail(
      'coherence module',
      `module (${manifest.module}) !== exports["."].import (${rootExport.import})`,
    );
  }
}

// ─── 4 + 5. Execution probes (child process each) + sentinels ───────────
type ProbeVerdict = {
  ok: boolean;
  exportNames?: string[];
  sentinelTypes?: Record<string, string>;
  versionValue?: string;
  error?: string;
};

const cjsChildScript = `
  try {
    const loaded = require(process.env.DIST_PROBE_TARGET);
    const sentinelTypes = {};
    for (const name of (process.env.DIST_PROBE_SENTINELS || '').split(',').filter(Boolean)) {
      sentinelTypes[name] = typeof loaded[name];
    }
    console.log(JSON.stringify({
      ok: true,
      exportNames: Object.keys(loaded).filter((k) => k !== '__esModule'),
      sentinelTypes,
      versionValue: loaded.TIMELINE_PLUGIN_VERSION,
    }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: String(error && error.stack || error) }));
  }
`;
const esChildScript = `
  import { pathToFileURL } from 'node:url';
  try {
    const loaded = await import(pathToFileURL(process.env.DIST_PROBE_TARGET).href);
    const sentinelTypes = {};
    for (const name of (process.env.DIST_PROBE_SENTINELS || '').split(',').filter(Boolean)) {
      sentinelTypes[name] = typeof loaded[name];
    }
    console.log(JSON.stringify({
      ok: true,
      exportNames: Object.keys(loaded).filter((k) => k !== '__esModule'),
      sentinelTypes,
      versionValue: loaded.TIMELINE_PLUGIN_VERSION,
    }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: String(error && error.stack || error) }));
  }
`;

/**
 * The complete public runtime surface (types are erased at runtime).
 * GROWS EVERY T-STEP alongside src/index.ts — update BOTH or the build
 * fails, by design.
 */
const EXPECTED_EXPORTS = [
  'TIMELINE_PLUGIN_VERSION',
  'MIN_POINT_DELTA_SECONDS',
  'sideInterps',
  'evaluateCurve',
  'curvePointSchema',
  'sideInterpSchema',
  'timelineCurveSchema',
  'timelineDocumentSchema',
  'parseTimelineDocument',
  'createTimelineDriverRegistry',
  'createTimelineTransport',
  'transportStates',
  'createTimelineDocumentStore',
  'createEmptyTimelineDocument',
  'useTimelineContext',
  'TimelineProvider',
  'CurveTimeline',
  'timelineCurveRefSchema',
  'makeTimelineCurveRef',
  'parseTimelineCurveRef',
  'makeTimelineCurveNodeType',
  'TimelineCurvePicker',
  'demoTimelineDocument',
] as const;
const SENTINEL_EXPECTED_TYPEOF: Record<
  (typeof EXPECTED_EXPORTS)[number],
  string
> = {
  TIMELINE_PLUGIN_VERSION: 'string',
  MIN_POINT_DELTA_SECONDS: 'number',
  sideInterps: 'object',
  evaluateCurve: 'function',
  curvePointSchema: 'object',
  sideInterpSchema: 'object',
  timelineCurveSchema: 'object',
  timelineDocumentSchema: 'object',
  parseTimelineDocument: 'function',
  createTimelineDriverRegistry: 'function',
  createTimelineTransport: 'function',
  transportStates: 'object',
  createTimelineDocumentStore: 'function',
  createEmptyTimelineDocument: 'function',
  useTimelineContext: 'function',
  TimelineProvider: 'function',
  CurveTimeline: 'function',
  timelineCurveRefSchema: 'object',
  makeTimelineCurveRef: 'function',
  parseTimelineCurveRef: 'function',
  makeTimelineCurveNodeType: 'function',
  TimelineCurvePicker: 'function',
  demoTimelineDocument: 'object',
};

function runProbe(relativePath: string, kind: 'cjs' | 'es'): ProbeVerdict {
  const absolutePath = fileURLToPath(
    new URL(`../${relativePath}`, import.meta.url),
  );
  const nodeArguments =
    kind === 'cjs'
      ? ['-e', cjsChildScript]
      : ['--input-type=module', '-e', esChildScript];
  const child = spawnSync(process.execPath, nodeArguments, {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DIST_PROBE_TARGET: absolutePath,
      DIST_PROBE_SENTINELS: Object.keys(SENTINEL_EXPECTED_TYPEOF).join(','),
    },
    timeout: 60_000,
  });
  if (child.error) {
    return { ok: false, error: String(child.error) };
  }
  const lastLine = child.stdout.trim().split('\n').at(-1) ?? '';
  try {
    return JSON.parse(lastLine) as ProbeVerdict;
  } catch {
    return {
      ok: false,
      error: `child produced no JSON verdict.\nstdout: ${child.stdout}\nstderr: ${child.stderr}`,
    };
  }
}

function checkSentinels(label: string, verdict: ProbeVerdict): void {
  const actual = [...(verdict.exportNames ?? [])].sort();
  const expected = [...EXPECTED_EXPORTS].sort();
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass(`sentinel surface (${label})`, `exactly [${expected.join(', ')}]`);
  } else {
    fail(
      `sentinel surface (${label})`,
      `expected exactly [${expected.join(', ')}], got [${actual.join(', ')}]. If the surface legitimately grew this T-step, update EXPECTED_EXPORTS + SENTINEL_EXPECTED_TYPEOF here.`,
    );
  }
  for (const [sentinel, expectedTypeof] of Object.entries(
    SENTINEL_EXPECTED_TYPEOF,
  )) {
    const actualTypeof = verdict.sentinelTypes?.[sentinel];
    if (actualTypeof === expectedTypeof) {
      pass(`sentinel ${sentinel} (${label})`, `typeof === '${expectedTypeof}'`);
    } else {
      fail(
        `sentinel ${sentinel} (${label})`,
        `expected typeof '${expectedTypeof}', got typeof === '${actualTypeof}'`,
      );
    }
  }
  // Version sync (review UI-19): a bumped manifest with a stale constant
  // would silently desynchronize.
  if (verdict.versionValue === manifest.version) {
    pass(
      `version sync (${label})`,
      `TIMELINE_PLUGIN_VERSION === package.json version (${manifest.version})`,
    );
  } else {
    fail(
      `version sync (${label})`,
      `TIMELINE_PLUGIN_VERSION (${String(verdict.versionValue)}) !== package.json version (${manifest.version})`,
    );
  }
}

// Aggregate — both probes run even after a failure.
const probeTargets: Array<{
  label: string;
  relativePath: string | undefined;
  kind: 'cjs' | 'es';
}> = [
  {
    label: 'load require',
    relativePath:
      typeof rootExport === 'object' ? rootExport?.require : undefined,
    kind: 'cjs',
  },
  {
    label: 'load import',
    relativePath:
      typeof rootExport === 'object' ? rootExport?.import : undefined,
    kind: 'es',
  },
];

for (const probe of probeTargets) {
  if (probe.relativePath === undefined) {
    fail(probe.label, 'manifest exports entry missing or malformed');
    continue;
  }
  const verdict = runProbe(probe.relativePath, probe.kind);
  if (verdict.ok) {
    pass(
      probe.label,
      `${probe.relativePath} evaluated (${verdict.exportNames?.length ?? 0} exports)`,
    );
    checkSentinels(probe.label, verdict);
  } else {
    fail(
      probe.label,
      `${probe.relativePath} threw during module evaluation:\n${verdict.error}\n(A "Cannot access 'X' before initialization" here is the circular-import TDZ class — trace X's declaration vs first use.)`,
    );
  }
}

// ─── Verdict ────────────────────────────────────────────────────────────
if (failures.length > 0) {
  process.stderr.write(
    `[check-dist-loads] ${failures.length} check(s) failed: ${failures.join('; ')}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `[check-dist-loads] OK — manifest targets exist, main/module cohere with exports, both bundles evaluate, the ${EXPECTED_EXPORTS.length}-value surface is intact.\n`,
);
