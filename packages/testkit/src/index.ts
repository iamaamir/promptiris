import { createRunContext } from '@promptiris/core';
import type { Event } from '@promptiris/protocol';
/** @public */
export function captureEvents(): { events: Event[]; emit: (event: Event) => void } {
  const events: Event[] = [];
  return { events, emit: (event) => events.push(event) };
}
export { createRunContext };
