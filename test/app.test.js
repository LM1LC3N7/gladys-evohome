// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake Total Connect Comfort cloud behind the transport. Timers
// and Date are mocked: the tests move the clock second by second, like the
// scheduler sees it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { EvohomeApp } from '../src/app.js';
import { accountKey } from '../src/config.js';
import { ACTIONS, API, SCENE_ACTIONS, SCENE_TRIGGERS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import {
  DHW,
  EMAIL,
  MINUTE,
  NOW,
  OTHER_SYSTEM,
  PASSWORD,
  SYSTEM,
  USER_ID,
  ZONES,
  gatewayLost,
  systemOf,
  withFaults,
  zoneOf,
} from './fixtures/evohome.js';
import { fakeEvohome, memoryStore, settle } from './helpers/fakeEvohome.js';

const CONFIG = { email: EMAIL, password: PASSWORD };
const sys = (id = SYSTEM) => `ext:test-integration:system:${id}`;
const zone = (id) => `ext:test-integration:zone:${id}`;
const dhw = () => `ext:test-integration:dhw:${DHW}`;

async function setup(t, { config = CONFIG, store = memoryStore(), server = fakeEvohome() } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config });
  const app = new EvohomeApp({
    gladys,
    logger: createLogger({ level: 'silent' }),
    transport: server.transport,
    now: () => Date.now(),
    store,
    userAgent: 'gladys-evohome/test',
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      t.mock.timers.tick(1000);
      await settle();
    }
  };
  return { gladys, app, server, store, advance };
}

const deviceOf = (gladys, id) => gladys.fake.discoveredDevices.find((d) => d.external_id === id);
const featureOf = (gladys, id, role) =>
  deviceOf(gladys, id).features.find((f) => f.external_id === `${id}:${role}`);
const create = async (gladys, ...ids) => {
  for (const id of ids) {
    await gladys.fake.deviceCreated(deviceOf(gladys, id));
  }
  await settle();
};
const createAll = (gladys) =>
  create(gladys, ...gladys.fake.discoveredDevices.map((d) => d.external_id));
const last = (gladys, id, role) => gladys.fake.lastState(`${id}:${role}`);
const set = (gladys, id, role, value) =>
  gladys.fake.setValue(deviceOf(gladys, id), featureOf(gladys, id, role), value);
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

test('without credentials, the status asks for them and nothing is requested', async (t) => {
  const { gladys, server } = await setup(t, { config: {} });
  assert.equal(server.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /e-mail and password/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.fr, /e-mail et le mot de passe/);
});

test('one sign-in, then the user, the installation and the status: the devices in Discovery', async (t) => {
  const { gladys, server, store } = await setup(t);
  assert.deepEqual(
    server.requests.map((r) => r.path),
    [API.tokenPath, '/userAccount', '/location/installationInfo', '/location/2738909/status'],
  );
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [sys(), zone(ZONES.LIVING), zone(ZONES.KITCHEN), zone(ZONES.BEDROOM), dhw()],
  );
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Connected to Evohome "My Home": 3 zones and hot water. Open Discovery to add them.',
      fr: 'Connecté à Evohome « My Home » : 3 zones et eau chaude. Ouvrez Découverte pour les ajouter.',
    },
  });
  assert.deepEqual(store.data.session, {
    account: accountKey(EMAIL),
    accessToken: 'access-1',
    expiresAt: NOW + 1799 * 1000,
    refreshToken: 'refresh-1',
    userId: USER_ID,
  });
});

test('one status read every 5 minutes, the token renewed with the refresh token', async (t) => {
  const { server, advance } = await setup(t);
  await advance(30 * MINUTE);
  assert.equal(server.statusReads().length, 7);
  assert.deepEqual(
    server.tokenRequests().map((r) => r.form.grant_type),
    ['password', 'refresh_token'],
  );
  assert.equal(server.requests.filter((r) => r.path === '/location/installationInfo').length, 1);
});

test('a restart reuses the session and the user id of the same account: no sign-in', async (t) => {
  const server = fakeEvohome();
  const token = server.issue();
  const store = memoryStore({
    session: {
      account: accountKey(EMAIL),
      accessToken: token.access_token,
      expiresAt: NOW + 20 * MINUTE,
      refreshToken: token.refresh_token,
      userId: USER_ID,
    },
  });
  await setup(t, { server, store });
  assert.deepEqual(
    server.requests.map((r) => r.path),
    ['/location/installationInfo', '/location/2738909/status'],
  );
});

test('the session of another account is never used', async (t) => {
  const server = fakeEvohome();
  const token = server.issue();
  const store = memoryStore({
    session: {
      account: accountKey('someone@else.com'),
      accessToken: token.access_token,
      expiresAt: NOW + 20 * MINUTE,
      refreshToken: token.refresh_token,
      userId: USER_ID,
    },
  });
  await setup(t, { server, store });
  assert.equal(server.requests[0].form.grant_type, 'password');
});

test('created devices get their values at once, then only what changes', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await createAll(gladys);
  assert.equal(last(gladys, sys(), 'mode'), 'Auto');
  assert.equal(last(gladys, sys(), 'fault'), 0);
  assert.equal(last(gladys, zone(ZONES.LIVING), 'temperature'), 19.5);
  assert.equal(last(gladys, zone(ZONES.LIVING), 'setpoint'), 20);
  assert.equal(last(gladys, zone(ZONES.LIVING), 'heating-mode'), 1);
  assert.equal(last(gladys, zone(ZONES.BEDROOM), 'setpoint-mode'), 'TemporaryOverride');
  assert.equal(last(gladys, dhw(), 'temperature'), 45.5);
  assert.equal(last(gladys, dhw(), 'state'), 1);
  assert.equal(last(gladys, dhw(), 'mode'), 6);
  const count = gladys.fake.states.length;
  await advance(5 * MINUTE);
  assert.equal(gladys.fake.states.length, count, 'nothing changed, nothing sent');
  zoneOf(server.data, ZONES.LIVING).temperatureStatus.temperature = 20.5;
  await advance(5 * MINUTE);
  assert.deepEqual(
    gladys.fake.states.slice(count).map((s) => [s.device_feature_external_id, s.state]),
    [[`${zone(ZONES.LIVING)}:temperature`, 20.5]],
  );
  assert.ok(
    gladys.fake.transports.every((b) => b.transport === DEVICE_TRANSPORTS.CLOUD),
    'cloud badges',
  );
});

test('a setpoint from the dashboard: temporary for the default 60 minutes, rounded to 0.5', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await createAll(gladys);
  const reads = server.statusReads().length;
  const ack = await set(gladys, zone(ZONES.LIVING), 'setpoint', 21.3);
  assert.equal(ack.success, true);
  assert.deepEqual(server.puts().at(-1).body, {
    setpointMode: 'TemporaryOverride',
    heatSetpointValue: 21.5,
    timeUntil: iso(NOW + 60 * MINUTE),
  });
  await settle();
  assert.equal(last(gladys, zone(ZONES.LIVING), 'setpoint'), 21.5);
  assert.equal(last(gladys, zone(ZONES.LIVING), 'setpoint-mode'), 'TemporaryOverride');
  await advance(20_000);
  assert.equal(server.statusReads().length, reads + 1, 'one read soon after');
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('with "until changed again", a setpoint is a permanent override', async (t) => {
  const { gladys, server } = await setup(t, {
    config: { ...CONFIG, override_mode: 'permanent' },
  });
  await createAll(gladys);
  await set(gladys, zone(ZONES.KITCHEN), 'setpoint', 18);
  assert.deepEqual(server.puts().at(-1).body, {
    setpointMode: 'PermanentOverride',
    heatSetpointValue: 18,
  });
});

test('heating mode off holds the zone at its minimum, heating puts it back on its schedule', async (t) => {
  const { gladys, server } = await setup(t);
  await createAll(gladys);
  await set(gladys, zone(ZONES.LIVING), 'heating-mode', 0);
  assert.deepEqual(server.puts().at(-1).body, {
    setpointMode: 'PermanentOverride',
    heatSetpointValue: 5,
  });
  await settle();
  assert.equal(last(gladys, zone(ZONES.LIVING), 'heating-mode'), 0);
  await set(gladys, zone(ZONES.LIVING), 'heating-mode', 1);
  assert.deepEqual(server.puts().at(-1).body, { setpointMode: 'FollowSchedule' });
});

test('the setpoint mode select: keep the current setpoint, or follow the schedule', async (t) => {
  const { gladys, server } = await setup(t);
  await createAll(gladys);
  await set(gladys, zone(ZONES.KITCHEN), 'setpoint-mode', 'PermanentOverride');
  assert.deepEqual(server.puts().at(-1).body, {
    setpointMode: 'PermanentOverride',
    heatSetpointValue: 17,
  });
  await set(gladys, zone(ZONES.KITCHEN), 'setpoint-mode', 'TemporaryOverride');
  assert.equal(server.puts().at(-1).body.timeUntil, iso(NOW + 60 * MINUTE));
  await set(gladys, zone(ZONES.BEDROOM), 'setpoint-mode', 'FollowSchedule');
  assert.deepEqual(server.puts().at(-1).body, { setpointMode: 'FollowSchedule' });
});

test('the system mode from the dashboard fires no scene event', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await createAll(gladys);
  await set(gladys, sys(), 'mode', 'AutoWithEco');
  assert.deepEqual(server.puts().at(-1).body, { systemMode: 'AutoWithEco', permanent: true });
  await settle();
  assert.equal(last(gladys, sys(), 'mode'), 'AutoWithEco');
  await advance(10 * MINUTE);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'never an event for a command from Gladys');
  const ack = await set(gladys, sys(), 'mode', 'Cool');
  assert.equal(ack.success, false);
  assert.match(
    ack.error,
    /ne propose pas le mode « Cool »/,
    'in the language of the configuration',
  );
});

test('a mode changed outside Gladys fires "system mode changed"', async (t) => {
  const { gladys, server, advance } = await setup(t);
  systemOf(server.data).systemModeStatus = {
    mode: 'Away',
    isPermanent: false,
    timeUntil: '2026-10-18T00:00:00Z',
  };
  await advance(5 * MINUTE);
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: SCENE_TRIGGERS.SYSTEM_MODE_CHANGED,
      data: {
        system: sys(),
        system_name: 'Evohome My Home',
        mode: 'Away',
        previous_mode: 'Auto',
        permanent: false,
        until: '2026-10-18T00:00:00.000Z',
      },
    },
  ]);
});

test('faults raised then cleared fire scene events; battery low and fault states follow', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await createAll(gladys);
  server.statuses[SYSTEM] = withFaults(server.data);
  await advance(5 * MINUTE);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => [e.key, e.data.device, e.data.fault_type, e.data.since]),
    [
      [SCENE_TRIGGERS.FAULT_DETECTED, sys(), 'BoilerCommunicationLost', '2026-10-16T08:40:00.000Z'],
      [
        SCENE_TRIGGERS.FAULT_DETECTED,
        zone(ZONES.LIVING),
        'TempZoneActuatorLowBattery',
        '2026-10-16T08:45:00.000Z',
      ],
      [
        SCENE_TRIGGERS.FAULT_DETECTED,
        zone(ZONES.KITCHEN),
        'TempZoneSensorCommunicationLost',
        '2026-10-16T08:50:00.000Z',
      ],
      [SCENE_TRIGGERS.FAULT_DETECTED, dhw(), 'DHWSensorFailure', '2026-10-16T08:55:00.000Z'],
    ],
  );
  assert.equal(gladys.fake.sceneEvents[1].data.device_name, 'Main Room');
  assert.equal(last(gladys, zone(ZONES.LIVING), 'battery-low'), 1);
  assert.equal(last(gladys, zone(ZONES.KITCHEN), 'fault'), 1);
  assert.equal(last(gladys, zone(ZONES.KITCHEN), 'faults'), 'TempZoneSensorCommunicationLost');
  zoneOf(server.data, ZONES.LIVING).activeFaults = [];
  await advance(5 * MINUTE);
  assert.deepEqual(gladys.fake.sceneEvents.at(-1), {
    key: SCENE_TRIGGERS.FAULT_CLEARED,
    data: {
      device: zone(ZONES.LIVING),
      device_name: 'Main Room',
      fault_type: 'TempZoneActuatorLowBattery',
      since: '2026-10-16T08:45:00.000Z',
    },
  });
  assert.equal(last(gladys, zone(ZONES.LIVING), 'battery-low'), 0);
});

test('faults already there at start-up fire nothing', async (t) => {
  const server = fakeEvohome();
  server.statuses[SYSTEM] = withFaults(server.data);
  const { gladys, advance } = await setup(t, { server });
  await advance(5 * MINUTE);
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('the hot water: off, boost for the configured time, back to its schedule', async (t) => {
  const { gladys, server } = await setup(t, { config: { ...CONFIG, dhw_boost_duration: 30 } });
  await createAll(gladys);
  await set(gladys, dhw(), 'state', 0);
  assert.deepEqual(server.puts().at(-1).body, { mode: 'PermanentOverride', state: 'Off' });
  await settle();
  assert.equal(last(gladys, dhw(), 'state'), 0);
  assert.equal(last(gladys, dhw(), 'mode'), 0);
  await set(gladys, dhw(), 'mode', 3);
  assert.deepEqual(server.puts().at(-1).body, {
    mode: 'TemporaryOverride',
    state: 'On',
    untilTime: iso(NOW + 30 * MINUTE),
  });
  await set(gladys, dhw(), 'mode', 4);
  assert.deepEqual(server.puts().at(-1).body, { mode: 'PermanentOverride', state: 'On' });
  await set(gladys, dhw(), 'mode', 6);
  assert.deepEqual(server.puts().at(-1).body, { mode: 'FollowSchedule' });
});

test('a refused command fails its ack and Gladys gets the real value back', async (t) => {
  const { gladys, server } = await setup(t);
  await createAll(gladys);
  server.queue.push({
    match: (r) => r.method === 'PUT',
    status: 400,
    body: [{ code: 'InvalidInput', message: 'Invalid Input.' }],
  });
  const before = gladys.fake.states.length;
  const ack = await set(gladys, zone(ZONES.LIVING), 'setpoint', 22);
  assert.equal(ack.success, false);
  assert.match(ack.error, /InvalidInput \(HTTP 400\)/);
  const again = gladys.fake.states.slice(before);
  assert.ok(
    again.some(
      (s) => s.device_feature_external_id === `${zone(ZONES.LIVING)}:setpoint` && s.state === 20,
    ),
    'the setpoint of the cloud is sent again',
  );
});

test('scene actions: system mode for days, zone setpoints, back to schedule, hot water', async (t) => {
  const { gladys, server } = await setup(t);
  let ack = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_SYSTEM_MODE, { mode: 'Away', days: 2 });
  assert.equal(ack.success, true, ack.error);
  const midnight = new Date(NOW);
  midnight.setHours(0, 0, 0, 0);
  midnight.setDate(midnight.getDate() + 2);
  assert.deepEqual(server.puts().at(-1).body, {
    systemMode: 'Away',
    permanent: false,
    timeUntil: iso(midnight.getTime()),
  });
  assert.deepEqual(ack.data.outputs, { until: midnight.toISOString() });

  ack = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_SYSTEM_MODE, {
    system: sys(),
    mode: 'AutoWithEco',
    hours: 3,
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(server.puts().at(-1).body.timeUntil, iso(NOW + 180 * MINUTE));

  ack = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_SYSTEM_MODE, {
    mode: 'HeatingOff',
    hours: 2,
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /ne peut pas être réglé pour une durée/);

  ack = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_ZONE_SETPOINT, {
    zone: zone(ZONES.KITCHEN),
    temperature: 19,
    minutes: 0,
  });
  assert.deepEqual(server.puts().at(-1).body, {
    setpointMode: 'PermanentOverride',
    heatSetpointValue: 19,
  });
  assert.deepEqual(ack.data.outputs, { until: '' });

  ack = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_ZONE_SETPOINT, {
    zone: zone(ZONES.KITCHEN),
    temperature: 21,
    minutes: 90,
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(server.puts().at(-1).body.timeUntil, iso(NOW + 90 * MINUTE));

  ack = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_ZONE_SETPOINT, {
    zone: zone(ZONES.KITCHEN),
    temperature: 40,
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /entre 5 et 35/);

  ack = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_ZONE_SETPOINT, {
    zone: dhw(),
    temperature: 20,
  });
  assert.equal(ack.success, false, 'the hot water is not a zone');

  ack = await gladys.fake.sceneAction(SCENE_ACTIONS.CLEAR_ZONE_OVERRIDE, {
    zone: zone(ZONES.BEDROOM),
  });
  assert.equal(ack.success, true);
  assert.deepEqual(server.puts().at(-1).body, { setpointMode: 'FollowSchedule' });

  ack = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_HOT_WATER, {
    hot_water: dhw(),
    state: 'on',
    minutes: 45,
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(server.puts().at(-1).body, {
    mode: 'TemporaryOverride',
    state: 'On',
    untilTime: iso(NOW + 50 * MINUTE),
  });
  ack = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_HOT_WATER, {
    hot_water: dhw(),
    state: 'auto',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(server.puts().at(-1).body, { mode: 'FollowSchedule' });
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('a refused password is never tried again by itself; the test button tries once', async (t) => {
  const server = fakeEvohome();
  server.password = 'changed in the app';
  const { gladys, advance } = await setup(t, { server });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the e-mail or password/);
  await advance(30 * MINUTE);
  assert.equal(server.tokenRequests().length, 1);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /refused/);
  assert.equal(server.tokenRequests().length, 2);
});

test('too many sign-ins: a pause of an hour (or what Honeywell asks)', async (t) => {
  const server = fakeEvohome();
  server.queue.push({
    match: (r) => r.path === API.tokenPath,
    status: 429,
    body: { error: 'attempt_limit_exceeded' },
  });
  const { gladys, advance } = await setup(t, { server });
  assert.match(gladys.fake.connectionStatus.message.en, /Too many sign-ins.*60 min/);
  await advance(55 * MINUTE);
  assert.equal(server.tokenRequests().length, 1);
  await advance(10 * MINUTE);
  assert.equal(server.tokenRequests().length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a 429 on the status waits for its Retry-After', async (t) => {
  const { gladys, server, advance } = await setup(t);
  server.queue.push({
    match: (r) => /status$/.test(r.path),
    status: 429,
    body: [{ code: 'TooManyRequests' }],
    headers: { 'retry-after': '3600' },
  });
  await advance(5 * MINUTE);
  assert.match(gladys.fake.connectionStatus.message.en, /slow down: pausing for 60 min/);
  const reads = server.statusReads().length;
  await advance(50 * MINUTE);
  assert.equal(server.statusReads().length, reads);
  await advance(15 * MINUTE);
  assert.ok(server.statusReads().length > reads);
});

test('the cloud down: unreachable badges, retries after 1 then 2 minutes', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await createAll(gladys);
  server.down = true;
  await advance(5 * MINUTE);
  assert.match(gladys.fake.connectionStatus.message.en, /cannot be reached \(connection refused\)/);
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.UNREACHABLE);
  server.down = false;
  await advance(5 * MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.CLOUD);
});

test('a gateway that lost the cloud: badges unreachable, with the reason', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await createAll(gladys);
  server.statuses[SYSTEM] = gatewayLost(server.data);
  await advance(5 * MINUTE);
  const badge = gladys.fake.transports.at(-1);
  assert.equal(badge.transport, DEVICE_TRANSPORTS.UNREACHABLE);
  assert.equal(badge.degraded, true);
  assert.match(badge.message.en, /gateway lost/);
});

test('several locations: the one named in the configuration, or a clear message', async (t) => {
  const server = fakeEvohome({ second: true });
  const { gladys } = await setup(t, { server, config: { ...CONFIG, location: 'holiday home' } });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [sys(OTHER_SYSTEM), zone('0002004')],
  );
  assert.equal(server.statusReads().at(-1).path, '/location/0002001/status');
  await gladys.fake.configUpdated({ ...CONFIG, location: 'Castle' });
  await settle();
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /No location "Castle".*My Home \(2738909\), Holiday Home \(0002001\)/,
  );
});

test('the first location by default, the others pointed to', async (t) => {
  const server = fakeEvohome({ second: true });
  const { gladys } = await setup(t, { server });
  assert.match(gladys.fake.connectionStatus.message.en, /The account has 1 other location/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.equal(
    ack.data.message.en,
    'Locations: My Home (2738909), followed; Holiday Home (0002001). Mode Auto (schedule), 3 zones, hot water. No active fault.',
  );
});

test('the test button reads again, at most once a minute', async (t) => {
  const { gladys, server } = await setup(t);
  const reads = server.statusReads().length;
  let ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.fr, /Emplacements : My Home \(2738909\), suivi\./);
  assert.equal(server.statusReads().length, reads + 1);
  ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /^Already read less than a minute ago/);
  assert.equal(server.statusReads().length, reads + 1);
});

test('a new interval reschedules, a new language renames, a new e-mail signs in again', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await gladys.fake.configUpdated({ ...CONFIG, poll_interval: 60, language: 'en' });
  await settle();
  const reads = server.statusReads().length;
  await advance(3 * MINUTE);
  assert.equal(server.statusReads().length, reads + 3);
  assert.equal(featureOf(gladys, sys(), 'mode').name, 'System mode');
  const logins = server.grants('password').length;
  server.email = 'new@example.com';
  await gladys.fake.configUpdated({ ...CONFIG, email: 'new@example.com' });
  await settle();
  assert.equal(server.grants('password').length, logins + 1);
});

test('a Gladys restart resends Discovery and the status without reading the cloud', async (t) => {
  const { gladys, server } = await setup(t);
  const requests = server.requests.length;
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  assert.equal(server.requests.length, requests);
  assert.equal(gladys.fake.discoveredDevices.length, 5);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('Scan reads the installation again, at most every 10 minutes', async (t) => {
  const { gladys, server, advance } = await setup(t);
  const installs = () =>
    server.requests.filter((r) => r.path === '/location/installationInfo').length;
  await gladys.fake.scanRequest();
  await settle();
  assert.equal(installs(), 2);
  await gladys.fake.scanRequest();
  await settle();
  assert.equal(installs(), 2);
  await advance(11 * MINUTE);
  await gladys.fake.scanRequest();
  await settle();
  assert.equal(installs(), 3);
});
