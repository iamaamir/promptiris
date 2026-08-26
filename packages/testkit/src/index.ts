import { createRunContext } from '@meta-prompt/core';
import type { Event } from '@meta-prompt/protocol';
/** @public */
export function captureEvents(): { events: Event[]; emit: (event: Event) => void } {
  const events: Event[] = [];
  return { events, emit: (event) => events.push(event) };
}
export { createRunContext };
