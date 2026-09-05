import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CurveTimeline,
  TimelineProvider,
  createTimelineDocumentStore,
  createTimelineDriverRegistry,
  createTimelineTransport,
  evaluateCurve,
  type TimelineDocument,
  type TimelineDriverRegistry,
  type TimelineTransport,
} from '@/index';

// The plan §3 demo document plus a second lane so multi-curve UX is visible.
const demoDocument: TimelineDocument = {
  version: 1,
  durationSec: 8,
  loop: true,
  curves: [
    {
      id: 'crv_cutoff',
      name: 'cutoff',
      color: '#f59e0b',
      defaultValue: 800,
      points: [
        { t: 0, v: 400, leftInterp: 'linear', rightInterp: 'ease' },
        { t: 2, v: 2000, leftInterp: 'linear', rightInterp: 'step' },
        { t: 5, v: 2000, leftInterp: 'linear', rightInterp: 'linear' },
        { t: 8, v: 400, leftInterp: 'ease', rightInterp: 'linear' },
      ],
    },
    {
      id: 'crv_vibrato',
      name: 'vibrato',
      color: '#22d3ee',
      defaultValue: 0,
      points: [
        { t: 0, v: 0, leftInterp: 'linear', rightInterp: 'ease' },
        { t: 4, v: 50, leftInterp: 'ease', rightInterp: 'ease' },
        { t: 8, v: 0, leftInterp: 'ease', rightInterp: 'linear' },
      ],
    },
  ],
};

const PLAYGROUND_BUILD_ID = 'playground';

function PlaygroundApp() {
  const [store] = useState(() => createTimelineDocumentStore(demoDocument));
  const [transport, setTransport] = useState<TimelineTransport | null>(null);
  const registryRef = useRef<TimelineDriverRegistry | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const silentSinkRef = useRef<GainNode | null>(null);
  const [driverReadouts, setDriverReadouts] = useState<Record<string, number>>(
    {},
  );

  function acquireAndConnectDriver(curveId: string) {
    const registry = registryRef.current;
    const silentSink = silentSinkRef.current;
    if (registry === null || silentSink === null) {
      return;
    }
    const { node, isNew } = registry.acquireDriver(
      curveId,
      PLAYGROUND_BUILD_ID,
    );
    if (isNew) {
      // The seam type hides connect(); at runtime this IS a
      // ConstantSourceNode from this very context (the T4 app does the same
      // widening when handing drivers to Tone).
      (node as unknown as AudioNode).connect(silentSink);
    }
  }

  function enableTransport() {
    if (transport !== null) {
      return;
    }
    // The plugin only sees the structural seam — a real AudioContext
    // satisfies it. Drivers route through a ZERO-GAIN sink: silent, but the
    // nodes are pulled by the render graph, so offset.value reflects the
    // scheduled automation (an unconnected source is never processed and
    // its param .value would only show direct assignments).
    const audioContext = new AudioContext();
    void audioContext.resume();
    audioContextRef.current = audioContext;
    const silentSink = audioContext.createGain();
    silentSink.gain.value = 0;
    silentSink.connect(audioContext.destination);
    silentSinkRef.current = silentSink;
    const registry = createTimelineDriverRegistry(audioContext);
    registryRef.current = registry;
    const nextTransport = createTimelineTransport({
      context: audioContext,
      registry,
      getDocument: store.getDocument,
    });
    for (const curve of store.getDocument().curves) {
      acquireAndConnectDriver(curve.id);
    }
    setTransport(nextTransport);
  }

  // Curves added AFTER enabling the transport also get drivers (UI-23).
  useEffect(() => {
    if (transport === null) {
      return;
    }
    return store.subscribe(() => {
      for (const curve of store.getDocument().curves) {
        acquireAndConnectDriver(curve.id);
      }
    });
  }, [transport, store]);

  useEffect(() => {
    if (transport === null) {
      return;
    }
    let frameHandle = 0;
    function frame() {
      frameHandle = requestAnimationFrame(frame);
      const registry = registryRef.current;
      if (registry === null) {
        return;
      }
      const readouts: Record<string, number> = {};
      for (const driver of registry.getLiveDrivers()) {
        readouts[driver.curveId] = driver.node.offset.value;
      }
      // Only re-render when a value actually moved (UI-23).
      setDriverReadouts((previous) => {
        const previousKeys = Object.keys(previous);
        const nextKeys = Object.keys(readouts);
        if (
          previousKeys.length === nextKeys.length &&
          nextKeys.every((key) => previous[key] === readouts[key])
        ) {
          return previous;
        }
        return readouts;
      });
    }
    frameHandle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameHandle);
  }, [transport]);

  // Dev handle for automated (MCP) verification — playground-only.
  useEffect(() => {
    const devHandle = {
      exportDocument: () => store.getDocument(),
      evaluate: (curveId: string, timeSeconds: number) => {
        const curve = store
          .getDocument()
          .curves.find((candidate) => candidate.id === curveId);
        return curve === undefined ? null : evaluateCurve(curve, timeSeconds);
      },
      getState: () => transport?.getState() ?? null,
      getPlayheadTime: () => transport?.getPlayheadTime() ?? null,
      getDriverValue: (curveId: string) =>
        registryRef.current
          ?.getLiveDrivers()
          .find((driver) => driver.curveId === curveId)?.node.offset.value ??
        null,
      contextState: () => audioContextRef.current?.state ?? null,
      enableTransport,
      play: () => transport?.play(),
      pause: () => transport?.pause(),
      stop: () => transport?.stop(),
      scrub: (timeSeconds: number) => transport?.scrub(timeSeconds),
    };
    (
      window as unknown as { __timelinePlayground?: unknown }
    ).__timelinePlayground = devHandle;
  });

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#1d1d1d',
        color: '#e6e6e6',
        fontFamily: 'system-ui, sans-serif',
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.05rem' }}>
          react-blender-nodes-timeline playground
        </h1>
        <button
          type="button"
          onClick={enableTransport}
          disabled={transport !== null}
          style={{
            background: transport === null ? '#303030' : '#232323',
            color: transport === null ? '#e6e6e6' : '#797979',
            border: '1px solid #444444',
            borderRadius: 4,
            padding: '4px 10px',
            cursor: transport === null ? 'pointer' : 'default',
          }}
        >
          {transport === null
            ? 'Enable transport (creates AudioContext)'
            : 'Transport enabled'}
        </button>
        {transport !== null && (
          <span
            style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: 11,
              color: '#979797',
            }}
          >
            drivers:{' '}
            {Object.entries(driverReadouts)
              .map(([curveId, value]) => `${curveId}=${value.toFixed(1)}`)
              .join(' · ') || '(none)'}
          </span>
        )}
      </div>
      <TimelineProvider store={store} transport={transport}>
        <CurveTimeline />
      </TimelineProvider>
      <p style={{ color: '#797979', fontSize: 12, marginTop: 10 }}>
        Click an empty spot in a lane to add a point (and drag it) · drag points
        to move · Delete removes the selected point · drag the ruler to scrub ·
        ctrl+wheel zooms · drivers are UNCONNECTED constant sources — the
        readout above proves scheduling on a real audio clock, silently.
      </p>
    </main>
  );
}

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('playground: #root element missing from index.html');
}
createRoot(rootElement).render(
  <StrictMode>
    <PlaygroundApp />
  </StrictMode>,
);
