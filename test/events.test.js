import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faultEvents, modeEvent } from '../src/events.js';

test('a mode change, with its end when temporary', () => {
  assert.equal(modeEvent(undefined, { mode: 'Auto' }), undefined, 'the first reading is history');
  assert.equal(modeEvent({ mode: 'Auto' }, { mode: 'Auto' }), undefined);
  assert.deepEqual(modeEvent({ mode: 'Auto' }, { mode: 'Away', permanent: true }), {
    key: 'system_mode_changed',
    mode: 'Away',
    previous: 'Auto',
    permanent: true,
    until: undefined,
  });
  assert.deepEqual(
    modeEvent({ mode: 'Auto' }, { mode: 'AutoWithEco', permanent: false, until: 5 }),
    {
      key: 'system_mode_changed',
      mode: 'AutoWithEco',
      previous: 'Auto',
      permanent: false,
      until: 5,
    },
  );
});

test('faults raised and cleared, never on the first reading', () => {
  const low = { type: 'TempZoneActuatorLowBattery', since: 1 };
  const lost = { type: 'TempZoneSensorCommunicationLost', since: 2 };
  assert.deepEqual(faultEvents(undefined, [low]), []);
  assert.deepEqual(faultEvents([low], [low]), []);
  assert.deepEqual(faultEvents([low], [low, lost]), [
    { key: 'fault_detected', type: lost.type, since: 2 },
  ]);
  assert.deepEqual(faultEvents([low, lost], [lost]), [
    { key: 'fault_cleared', type: low.type, since: 1 },
  ]);
});
