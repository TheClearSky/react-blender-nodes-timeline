/**
 * React context seam for the editor and the curve-picker input (plan §7):
 * carries the document store plus the transport (null until the app has an
 * audio context — transport controls render disabled then).
 */
import { createContext, useContext } from 'react';
import type { TimelineTransport } from '../transport/transport';
import type { TimelineDocumentStore } from './documentStore';

export type TimelineContextValue = {
  readonly store: TimelineDocumentStore;
  readonly transport: TimelineTransport | null;
};

export const TimelineContext = createContext<TimelineContextValue | null>(null);

export function useTimelineContext(): TimelineContextValue {
  const contextValue = useContext(TimelineContext);
  if (contextValue === null) {
    throw new Error(
      'useTimelineContext must be used inside <TimelineProvider>',
    );
  }
  return contextValue;
}
