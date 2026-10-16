import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  buildDevices,
  dhwIds,
  dhwMode,
  dhwStates,
  heatingMode,
  localTime,
  parseExternalId,
  systemIds,
  systemStates,
  zoneIds,
  zoneStates,
} from '../src/devices.js';
import { readInstallation, readStatus } from '../src/inventory.js';
import { DHW, SYSTEM, ZONES, installation, status, withFaults } from './fixtures/evohome.js';

const gladys = createFakeGladys();
const [location] = readInstallation(installation());
const [system] = location.systems;
const byRole = (device) =>
  Object.fromEntries(device.features.map((f) => [f.external_id.split(':').at(-1), f]));
const value = (states, role) => {
  const s = states.find((x) => x.device_feature_external_id.endsWith(`:${role}`));
  return s && ('text' in s ? s.text : s.state);
};

test('one device per system, zone and hot water, accepted by Gladys', async () => {
  const devices = buildDevices(gladys, location, 'en');
  assert.deepEqual(
    devices.map((d) => [d.external_id, d.name]),
    [
      [`ext:test-integration:system:${SYSTEM}`, 'Evohome My Home'],
      [`ext:test-integration:zone:${ZONES.LIVING}`, 'Main Room'],
      [`ext:test-integration:zone:${ZONES.KITCHEN}`, 'Kitchen'],
      [`ext:test-integration:zone:${ZONES.BEDROOM}`, 'Main Bedroom'],
      [`ext:test-integration:dhw:${DHW}`, 'Hot water'],
    ],
  );
  // The SDK's fake checks categories, types, units like the host API.
  await gladys.connect();
  await gladys.publishDiscoveredDevices(devices);
  assert.equal(gladys.fake.discoveredDevices.length, 5);
  await gladys.disconnect();
});

test('the system: its allowed modes as a select, faults', () => {
  const [device] = buildDevices(gladys, location, 'fr');
  const f = byRole(device);
  assert.deepEqual(Object.keys(f), ['mode', 'mode-until', 'fault', 'faults']);
  assert.equal(f.mode.category, 'text');
  assert.equal(f.mode.type, 'select');
  assert.equal(f.mode.read_only, false);
  assert.deepEqual(
    f.mode.supported_options.map((o) => [o.value, o.label]),
    [
      ['HeatingOff', 'Chauffage arrêté'],
      ['Auto', 'Auto (programme)'],
      ['AutoWithReset', 'Auto, zones réinitialisées'],
      ['AutoWithEco', 'Économie'],
      ['Away', 'Absent'],
      ['DayOff', 'Jour de congé'],
      ['Custom', 'Personnalisé'],
    ],
  );
  assert.equal(f.mode.name, 'Mode du système');
  assert.deepEqual(
    device.params.find((p) => p.name === 'location_id'),
    {
      name: 'location_id',
      value: '2738909',
    },
  );
});

test('a zone: temperature, setpoint in its range, heating mode, setpoint mode, faults', () => {
  const zone = buildDevices(gladys, location, 'en')[1];
  const f = byRole(zone);
  assert.deepEqual(Object.keys(f), [
    'temperature',
    'setpoint',
    'heating-mode',
    'setpoint-mode',
    'override-until',
    'battery-low',
    'fault',
    'faults',
  ]);
  assert.deepEqual(
    [f.temperature.category, f.temperature.type, f.temperature.unit],
    ['temperature-sensor', 'decimal', 'celsius'],
  );
  assert.deepEqual(
    [f.setpoint.category, f.setpoint.type, f.setpoint.unit, f.setpoint.min, f.setpoint.max],
    ['thermostat', 'target-temperature', 'celsius', 5, 35],
  );
  assert.equal(f.setpoint.read_only, false);
  assert.deepEqual(
    f['heating-mode'].supported_options.map((o) => o.value),
    [0, 1],
  );
  assert.deepEqual(
    f['setpoint-mode'].supported_options.map((o) => o.value),
    ['PermanentOverride', 'FollowSchedule', 'TemporaryOverride'],
  );
  assert.equal(f['battery-low'].category, 'battery-low');
});

test('the hot water: probe temperature, on/off and the water heater modes', () => {
  const dhw = buildDevices(gladys, location, 'en')[4];
  const f = byRole(dhw);
  assert.deepEqual(
    [f.temperature.category, f.temperature.type],
    ['temperature-sensor', 'probe'],
    'kept out of the room average',
  );
  assert.deepEqual([f.state.category, f.state.type], ['water-heater', 'binary']);
  assert.deepEqual(
    f.mode.supported_options.map((o) => [o.value, o.label]),
    [
      [6, 'Schedule'],
      [4, 'On'],
      [3, 'Boost'],
      [0, 'Off'],
    ],
  );
});

test('external ids: kind, Evohome id, role', () => {
  assert.deepEqual(parseExternalId(`ext:test-integration:zone:${ZONES.LIVING}:setpoint`), {
    kind: 'zone',
    id: ZONES.LIVING,
    role: 'setpoint',
  });
  assert.deepEqual(parseExternalId(`ext:test-integration:dhw:${DHW}`), {
    kind: 'dhw',
    id: DHW,
    role: undefined,
  });
  assert.equal(parseExternalId('ext:test-integration:pet:1'), undefined);
});

test('the states of each device', () => {
  const read = readStatus(withFaults(), 60);
  const sys = systemStates(systemIds(gladys, SYSTEM), read.systems.get(SYSTEM));
  assert.equal(value(sys, 'mode'), 'Auto');
  assert.equal(value(sys, 'mode-until'), '—');
  assert.equal(value(sys, 'fault'), 1);
  assert.equal(value(sys, 'faults'), 'BoilerCommunicationLost');

  const [living, kitchen, bedroom] = system.zones;
  const l = zoneStates(zoneIds(gladys, living.id), living, read.zones.get(living.id), 'Auto');
  assert.equal(value(l, 'temperature'), 19.5);
  assert.equal(value(l, 'setpoint'), 20);
  assert.equal(value(l, 'heating-mode'), 1);
  assert.equal(value(l, 'setpoint-mode'), 'FollowSchedule');
  assert.equal(value(l, 'override-until'), '—');
  assert.equal(value(l, 'battery-low'), 1);
  assert.equal(value(l, 'fault'), 1);

  const k = zoneStates(zoneIds(gladys, kitchen.id), kitchen, read.zones.get(kitchen.id), 'Auto');
  assert.equal(value(k, 'temperature'), undefined, 'no state for an unavailable sensor');
  assert.equal(value(k, 'battery-low'), 0);

  const b = zoneStates(zoneIds(gladys, bedroom.id), bedroom, read.zones.get(bedroom.id), 'Auto');
  assert.equal(value(b, 'override-until'), localTime(Date.UTC(2026, 9, 16, 22, 10)));
  assert.equal(value(b, 'fault'), 0);
  assert.equal(value(b, 'faults'), '—');

  const d = dhwStates(dhwIds(gladys, DHW), read.dhws.get(DHW));
  assert.equal(value(d, 'temperature'), 45.5);
  assert.equal(value(d, 'state'), 1);
  assert.equal(value(d, 'mode'), 6);
  assert.equal(value(d, 'faults'), 'DHWSensorFailure');
  assert.equal(value(d, 'battery-low'), 0);
});

test('a zone is off when the system heats nothing or the zone is held at its minimum', () => {
  const [zone] = system.zones;
  const follow = { setpoint: 5, setpointMode: 'FollowSchedule' };
  assert.equal(heatingMode(zone, follow, 'Auto'), 1, 'a cold schedule point is not off');
  assert.equal(heatingMode(zone, { setpoint: 5, setpointMode: 'PermanentOverride' }, 'Auto'), 0);
  assert.equal(
    heatingMode(zone, { setpoint: 20, setpointMode: 'FollowSchedule' }, 'HeatingOff'),
    0,
  );
  assert.equal(heatingMode(zone, { setpoint: 18, setpointMode: 'TemporaryOverride' }, 'Away'), 1);
});

test('hot water state and mode -> water heater mode', () => {
  assert.equal(dhwMode({ state: 'On', mode: 'FollowSchedule' }), 6);
  assert.equal(dhwMode({ state: 'Off', mode: 'FollowSchedule' }), 6);
  assert.equal(dhwMode({ state: 'On', mode: 'PermanentOverride' }), 4);
  assert.equal(dhwMode({ state: 'On', mode: 'TemporaryOverride' }), 3);
  assert.equal(dhwMode({ state: 'Off', mode: 'PermanentOverride' }), 0);
  assert.equal(dhwMode({ state: 'Off', mode: 'TemporaryOverride' }), 0);
});

test('local times for the text features', () => {
  assert.match(localTime(Date.UTC(2026, 9, 16, 22, 10)), /^2026-10-1[67] \d{2}:\d{2}$/);
  assert.equal(localTime(undefined), '—');
});

test('no status, no states', () => {
  assert.deepEqual(systemStates(systemIds(gladys, SYSTEM), undefined), []);
  assert.deepEqual(zoneStates(zoneIds(gladys, '1'), system.zones[0], undefined), []);
  assert.deepEqual(dhwStates(dhwIds(gladys, DHW), undefined), []);
  assert.ok(status());
});
