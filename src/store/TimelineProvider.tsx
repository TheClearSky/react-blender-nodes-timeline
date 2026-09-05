import { useMemo, type ReactNode } from 'react';
import type { TimelineTransport } from '../transport/transport';
import { TimelineContext } from './TimelineContext';
import type { TimelineDocumentStore } from './documentStore';

export type TimelineProviderProps = {
  store: TimelineDocumentStore;
  /** null until the app has a running audio context. */
  transport?: TimelineTransport | null;
  children?: ReactNode;
};

export function TimelineProvider({
  store,
  transport = null,
  children,
}: TimelineProviderProps) {
  const contextValue = useMemo(
    () => ({ store, transport }),
    [store, transport],
  );
  return (
    <TimelineContext.Provider value={contextValue}>
      {children}
    </TimelineContext.Provider>
  );
}
