// -----------------------------------------------------------------------------
// Two readings -> scene events (pure): a system mode that changed, a fault
// that appeared or went away. The first reading after a start is history: it
// fires nothing. A change commanded from Gladys never fires (scene loops): the
// app shows it as soon as it is sent, so the reading after it sees no change.
// -----------------------------------------------------------------------------

import { SCENE_TRIGGERS } from './constants.js';

/** The system mode change between two snapshots, or undefined. */
export function modeEvent(before, current) {
  if (!current?.mode || !before?.mode || before.mode === current.mode) {
    return undefined;
  }
  return {
    key: SCENE_TRIGGERS.SYSTEM_MODE_CHANGED,
    mode: current.mode,
    previous: before.mode,
    permanent: current.permanent !== false,
    until: current.permanent === false ? current.until : undefined,
  };
}

const faultKey = (fault) => fault.type;

/** The faults raised and cleared between two lists of active faults. */
export function faultEvents(before, current) {
  if (!before) {
    return [];
  }
  const was = new Map(before.map((f) => [faultKey(f), f]));
  const is = new Map((current ?? []).map((f) => [faultKey(f), f]));
  const events = [];
  for (const [key, fault] of is) {
    if (!was.has(key)) {
      events.push({ key: SCENE_TRIGGERS.FAULT_DETECTED, type: fault.type, since: fault.since });
    }
  }
  for (const [key, fault] of was) {
    if (!is.has(key)) {
      events.push({ key: SCENE_TRIGGERS.FAULT_CLEARED, type: fault.type, since: fault.since });
    }
  }
  return events;
}
