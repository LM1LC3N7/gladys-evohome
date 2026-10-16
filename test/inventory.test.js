import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseLocation,
  overrideUntil,
  parseDate,
  parseTimeSpan,
  readInstallation,
  readStatus,
  systemUntil,
} from '../src/inventory.js';
import {
  DHW,
  HOUR,
  LOCATION,
  MINUTE,
  NOW,
  OTHER_LOCATION,
  SYSTEM,
  ZONES,
  gatewayLost,
  installation,
  status,
  withFaults,
} from './fixtures/evohome.js';

test('.NET time spans', () => {
  assert.equal(parseTimeSpan('00:10:00'), 10 * MINUTE);
  assert.equal(parseTimeSpan('01:00:00'), HOUR);
  assert.equal(parseTimeSpan('1.00:00:00'), 24 * HOUR);
  assert.equal(parseTimeSpan('99.00:00:00'), 99 * 24 * HOUR);
  assert.equal(parseTimeSpan('365.23:45:00'), 365 * 24 * HOUR + 23 * HOUR + 45 * MINUTE);
  assert.equal(parseTimeSpan('soon'), undefined);
  assert.equal(parseTimeSpan(undefined), undefined);
});

test('dates: UTC ends, local fault starts with up to 7 decimals', () => {
  assert.equal(parseDate('2026-10-16T22:10:00Z'), Date.UTC(2026, 9, 16, 22, 10));
  // A fault `since` is the local time of the location: UTC+1 in summer for London.
  assert.equal(parseDate('2026-10-16T09:45:00', 60), Date.UTC(2026, 9, 16, 8, 45));
  assert.equal(parseDate('2025-02-23T22:34:25.04', 0), Date.UTC(2025, 1, 23, 22, 34, 25, 40));
  assert.equal(parseDate('2023-05-04T18:47:36.7727046', 0), Date.UTC(2023, 4, 4, 18, 47, 36, 772));
  assert.equal(parseDate('2026-10-16T10:00:00+02:00'), Date.UTC(2026, 9, 16, 8, 0));
  assert.equal(parseDate('yesterday'), undefined);
  assert.equal(parseDate(undefined), undefined);
});

test('the installation: location, system, zones with their range, hot water, modes', () => {
  const [location, other] = readInstallation(installation({ second: true }));
  assert.equal(location.id, LOCATION);
  assert.equal(location.name, 'My Home');
  assert.equal(location.offsetMinutes, 60);
  assert.equal(location.systems.length, 1);
  const [system] = location.systems;
  assert.equal(system.id, SYSTEM);
  assert.equal(system.locationName, 'My Home');
  assert.equal(system.model, 'EvoTouch');
  assert.deepEqual(
    system.modes.map((m) => m.mode),
    ['HeatingOff', 'Auto', 'AutoWithReset', 'AutoWithEco', 'Away', 'DayOff', 'Custom'],
  );
  const eco = system.modes.find((m) => m.mode === 'AutoWithEco');
  assert.deepEqual(eco, {
    mode: 'AutoWithEco',
    permanent: true,
    temporary: true,
    maxDuration: 24 * HOUR,
    resolution: HOUR,
    timing: 'Duration',
  });
  assert.equal(system.modes.find((m) => m.mode === 'Auto').temporary, false);
  assert.deepEqual(
    system.zones.map((z) => [z.id, z.name]),
    [
      [ZONES.LIVING, 'Main Room'],
      [ZONES.KITCHEN, 'Kitchen'],
      [ZONES.BEDROOM, 'Main Bedroom'],
    ],
  );
  const [zone] = system.zones;
  assert.deepEqual(
    [zone.min, zone.max, zone.step, zone.maxDuration, zone.resolution, zone.type],
    [5, 35, 0.5, 24 * HOUR, 10 * MINUTE, 'RadiatorZone'],
  );
  assert.deepEqual(zone.setpointModes, [
    'PermanentOverride',
    'FollowSchedule',
    'TemporaryOverride',
  ]);
  assert.equal(system.dhw.id, DHW);
  assert.deepEqual(system.dhw.states, ['On', 'Off']);
  assert.equal(other.id, OTHER_LOCATION);
  assert.equal(other.systems[0].dhw, null);
  assert.deepEqual(
    other.systems[0].modes.map((m) => m.mode),
    ['Auto', 'AutoWithEco', 'Away'],
  );
});

test('an empty or broken installation gives no location', () => {
  assert.deepEqual(readInstallation([]), []);
  assert.deepEqual(readInstallation(null), []);
  assert.deepEqual(readInstallation([{ gateways: [] }]), []);
});

test('the location followed: by id, by name, the first one when empty', () => {
  const locations = readInstallation(installation({ second: true }));
  assert.equal(chooseLocation(locations, '').id, LOCATION);
  assert.equal(chooseLocation(locations, OTHER_LOCATION).id, OTHER_LOCATION);
  assert.equal(chooseLocation(locations, '  holiday home ').id, OTHER_LOCATION);
  assert.equal(chooseLocation(locations, 'Castle'), undefined);
  assert.equal(chooseLocation([], ''), undefined);
});

test('the status: mode, temperatures, setpoints, override end, hot water', () => {
  const read = readStatus(status(), 60);
  assert.deepEqual(read.systems.get(SYSTEM), {
    mode: 'Auto',
    permanent: true,
    until: undefined,
    faults: [],
    gatewayLost: false,
  });
  assert.deepEqual(read.zones.get(ZONES.LIVING), {
    temperature: 19.5,
    setpoint: 20,
    setpointMode: 'FollowSchedule',
    until: undefined,
    faults: [],
  });
  assert.equal(read.zones.get(ZONES.BEDROOM).setpointMode, 'TemporaryOverride');
  assert.equal(read.zones.get(ZONES.BEDROOM).until, Date.UTC(2026, 9, 16, 22, 10));
  assert.deepEqual(read.dhws.get(DHW), {
    temperature: 45.5,
    state: 'On',
    mode: 'FollowSchedule',
    until: undefined,
    faults: [],
  });
});

test('faults at every level; an unavailable sensor has no temperature', () => {
  const read = readStatus(gatewayLost(withFaults()), 60);
  const system = read.systems.get(SYSTEM);
  assert.equal(system.gatewayLost, true);
  assert.deepEqual(
    system.faults.map((f) => f.type),
    ['GatewayCommunicationLost', 'BoilerCommunicationLost'],
  );
  assert.equal(system.faults[0].since, Date.UTC(2026, 9, 16, 8, 30));
  assert.equal(read.zones.get(ZONES.KITCHEN).temperature, undefined);
  assert.deepEqual(read.zones.get(ZONES.LIVING).faults, [
    { type: 'TempZoneActuatorLowBattery', since: Date.UTC(2026, 9, 16, 8, 45) },
  ]);
  assert.equal(read.dhws.get(DHW).faults[0].type, 'DHWSensorFailure');
});

test('a temporary system mode carries its end', () => {
  const data = status();
  data.gateways[0].temperatureControlSystems[0].systemModeStatus = {
    mode: 'AutoWithEco',
    timeUntil: '2026-10-16T13:00:00Z',
    isPermanent: false,
  };
  const system = readStatus(data).systems.get(SYSTEM);
  assert.equal(system.permanent, false);
  assert.equal(system.until, Date.UTC(2026, 9, 16, 13));
});

test('override ends: rounded up to the 10-minute step, one day at most', () => {
  const [zone] = readInstallation(installation())[0].systems[0].zones;
  const now = NOW + 3 * MINUTE; // 10:03
  assert.equal(overrideUntil(zone, 60, now), Date.UTC(2026, 9, 16, 11, 10));
  assert.equal(overrideUntil(zone, 10, NOW), Date.UTC(2026, 9, 16, 10, 10));
  assert.equal(overrideUntil(zone, 1, NOW), Date.UTC(2026, 9, 16, 10, 10));
  assert.equal(overrideUntil(zone, 5000, now), now + 24 * HOUR);
});

test('system mode ends: hours for Eco, midnights for Away, Day off and Custom', () => {
  const [system] = readInstallation(installation())[0].systems;
  const mode = (name) => system.modes.find((m) => m.mode === name);
  assert.equal(systemUntil(mode('AutoWithEco'), { hours: 3, now: NOW }), NOW + 3 * HOUR);
  assert.equal(
    systemUntil(mode('AutoWithEco'), { hours: 2, now: NOW + 20 * MINUTE }),
    NOW + 3 * HOUR,
    'rounded up to the hour',
  );
  assert.equal(systemUntil(mode('AutoWithEco'), { hours: 30, now: NOW }), NOW + 24 * HOUR);
  assert.equal(systemUntil(mode('AutoWithEco'), { now: NOW }), undefined);
  // The test runner's time zone is the container's (TZ): midnight local time.
  const midnight = new Date(NOW);
  midnight.setHours(0, 0, 0, 0);
  midnight.setDate(midnight.getDate() + 2);
  assert.equal(systemUntil(mode('Away'), { days: 2, now: NOW }), midnight.getTime());
  assert.equal(systemUntil(mode('Away'), { hours: 5, now: NOW }), undefined);
});
