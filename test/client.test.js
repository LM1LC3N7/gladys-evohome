import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EvohomeClient, apiDate } from '../src/client.js';
import { API } from '../src/constants.js';
import { DHW, EMAIL, NOW, PASSWORD, SYSTEM, USER_ID, ZONES } from './fixtures/evohome.js';
import { fakeEvohome } from './helpers/fakeEvohome.js';

function setup({ session = null, clock = { now: NOW } } = {}) {
  const server = fakeEvohome();
  const sessions = [];
  const client = new EvohomeClient({
    transport: server.transport,
    now: () => clock.now,
    userAgent: 'gladys-evohome/test',
    onSession: (s) => sessions.push(structuredClone(s)),
  });
  client.configure({ email: EMAIL, password: PASSWORD, session });
  return { server, client, sessions, clock };
}

test('the password grant of the Evohome app: Basic header, form, PascalCase credentials', async () => {
  const { server, client, sessions } = setup();
  assert.equal(await client.userId(), USER_ID);
  const [grant, account] = server.requests;
  assert.equal(grant.method, 'POST');
  assert.equal(grant.path, API.tokenPath);
  assert.equal(grant.headers.Authorization, API.clientAuthorization);
  assert.equal(grant.headers['Content-Type'], 'application/x-www-form-urlencoded; charset=utf-8');
  assert.deepEqual(grant.form, {
    grant_type: 'password',
    scope: 'EMEA-V1-Basic EMEA-V1-Anonymous',
    Username: EMAIL,
    Password: PASSWORD,
  });
  assert.equal(account.path, '/userAccount');
  assert.equal(account.headers.Authorization, 'Bearer access-1');
  assert.equal(account.headers['User-Agent'], 'gladys-evohome/test');
  assert.deepEqual(sessions.at(-1), {
    userId: USER_ID,
    accessToken: 'access-1',
    expiresAt: NOW + 1799 * 1000,
    refreshToken: 'refresh-1',
  });
  // The Basic value is the Evohome app id and secret (evohome-async, Home Assistant).
  assert.equal(
    Buffer.from(API.clientAuthorization.slice(6), 'base64').toString(),
    '4a231089-d2b6-41bd-a5eb-16a0a422b999:1a15cdb8-42de-407b-add0-059f92c530cb',
  );
});

test('the access token is reused, then renewed with the refresh token', async () => {
  const { server, client, clock } = setup();
  await client.locationStatus('2738909');
  clock.now += 20 * 60_000;
  await client.locationStatus('2738909');
  assert.equal(server.tokenRequests().length, 1);
  clock.now += 9 * 60_000; // 29 min: under 2 min left
  await client.locationStatus('2738909');
  assert.deepEqual(
    server.tokenRequests().map((r) => r.form.grant_type),
    ['password', 'refresh_token'],
  );
  assert.equal(server.tokenRequests()[1].form.refresh_token, 'refresh-1');
  assert.equal(client.session.refreshToken, 'refresh-2');
});

test('a refused refresh token falls back once to the password', async () => {
  const { server, client } = setup({
    session: { accessToken: null, expiresAt: 0, refreshToken: 'stale', userId: USER_ID },
  });
  await client.locationStatus('2738909');
  assert.deepEqual(
    server.tokenRequests().map((r) => r.form.grant_type),
    ['refresh_token', 'password'],
  );
  assert.equal(client.session.userId, USER_ID, 'the user id is kept');
});

test('a stored session is used as is: no sign-in', async () => {
  const { server, client } = setup();
  const token = server.issue();
  client.configure({
    email: EMAIL,
    password: PASSWORD,
    session: {
      accessToken: token.access_token,
      expiresAt: NOW + 25 * 60_000,
      refreshToken: token.refresh_token,
    },
  });
  await client.locationStatus('2738909');
  assert.equal(server.tokenRequests().length, 0);
});

test('a 401 gets one new token and one retry', async () => {
  const { server, client } = setup();
  await client.locationStatus('2738909');
  server.revokeAccess();
  await client.locationStatus('2738909');
  assert.deepEqual(
    server.tokenRequests().map((r) => r.form.grant_type),
    ['password', 'refresh_token'],
  );
  // Still refused after a new token: the error goes up.
  server.queue.push(
    { match: (r) => /status/.test(r.path), status: 401, body: [{ code: 'Unauthorized' }] },
    { match: (r) => /status/.test(r.path), status: 401, body: [{ code: 'Unauthorized' }] },
  );
  await assert.rejects(client.locationStatus('2738909'), { kind: 'unauthorized' });
});

test('a wrong password is refused, a limited sign-in says so', async () => {
  const { server, client } = setup();
  server.password = 'another';
  await assert.rejects(client.locationStatus('2738909'), {
    kind: 'refused',
    code: 'invalid_grant',
  });
  server.queue.push({
    match: (r) => r.path === API.tokenPath,
    status: 429,
    body: { error: 'attempt_limit_exceeded' },
    headers: { 'retry-after': '3600' },
  });
  const err = await client.locationStatus('2738909').catch((e) => e);
  assert.equal(err.kind, 'rate_limited');
  assert.equal(err.login, true);
  assert.equal(err.retryAfter, 3600_000);
  assert.equal(err.code, 'attempt_limit_exceeded');
  // Some answers say 200 and carry the error.
  server.queue.push({
    match: (r) => r.path === API.tokenPath,
    status: 200,
    body: { error: 'invalid_grant' },
  });
  await assert.rejects(client.locationStatus('2738909'), { kind: 'refused' });
});

test('no credentials, no request', async () => {
  const { server, client } = setup();
  client.configure({ email: '', password: '' });
  await assert.rejects(client.locationStatus('2738909'), { kind: 'no_credentials' });
  assert.equal(server.requests.length, 0);
});

test('one sign-in for concurrent requests', async () => {
  const { server, client } = setup();
  await Promise.all([client.locationStatus('2738909'), client.installation(USER_ID)]);
  assert.equal(server.tokenRequests().length, 1);
});

test('an API 429 carries its Retry-After', async () => {
  const { server, client } = setup();
  server.queue.push({
    match: (r) => /status/.test(r.path),
    status: 429,
    body: [{ code: 'TooManyRequests', message: 'Too many requests' }],
    headers: { 'retry-after': '120' },
  });
  const err = await client.locationStatus('2738909').catch((e) => e);
  assert.equal(err.kind, 'rate_limited');
  assert.equal(err.login, false);
  assert.equal(err.retryAfter, 120_000);
  assert.equal(err.code, 'TooManyRequests');
});

test('the PUT bodies, key for key (evohome-async against the real server)', async () => {
  const { server, client } = setup();
  const until = Date.UTC(2026, 9, 16, 11, 10, 0, 500);
  await client.setSystemMode(SYSTEM, { mode: 'Auto' });
  await client.setSystemMode(SYSTEM, { mode: 'Away', until });
  await client.setZoneSetpoint(ZONES.LIVING, { mode: 'PermanentOverride', setpoint: 21.5 });
  await client.setZoneSetpoint(ZONES.LIVING, { mode: 'TemporaryOverride', setpoint: 19, until });
  await client.setZoneSetpoint(ZONES.LIVING, { mode: 'FollowSchedule' });
  await client.setDhwState(DHW, { mode: 'PermanentOverride', state: 'Off' });
  await client.setDhwState(DHW, { mode: 'TemporaryOverride', state: 'On', until });
  await client.setDhwState(DHW, { mode: 'FollowSchedule' });
  assert.deepEqual(
    server.puts().map((r) => [r.path, r.body]),
    [
      [`/temperatureControlSystem/${SYSTEM}/mode`, { systemMode: 'Auto', permanent: true }],
      [
        `/temperatureControlSystem/${SYSTEM}/mode`,
        { systemMode: 'Away', permanent: false, timeUntil: '2026-10-16T11:10:00Z' },
      ],
      [
        `/temperatureZone/${ZONES.LIVING}/heatSetpoint`,
        { setpointMode: 'PermanentOverride', heatSetpointValue: 21.5 },
      ],
      [
        `/temperatureZone/${ZONES.LIVING}/heatSetpoint`,
        {
          setpointMode: 'TemporaryOverride',
          heatSetpointValue: 19,
          timeUntil: '2026-10-16T11:10:00Z',
        },
      ],
      [`/temperatureZone/${ZONES.LIVING}/heatSetpoint`, { setpointMode: 'FollowSchedule' }],
      [`/domesticHotWater/${DHW}/state`, { mode: 'PermanentOverride', state: 'Off' }],
      [
        `/domesticHotWater/${DHW}/state`,
        { mode: 'TemporaryOverride', state: 'On', untilTime: '2026-10-16T11:10:00Z' },
      ],
      [`/domesticHotWater/${DHW}/state`, { mode: 'FollowSchedule' }],
    ],
  );
  assert.ok(server.puts().every((r) => r.headers['Content-Type'] === 'application/json'));
});

test('a refused command keeps the code of the answer', async () => {
  const { server, client } = setup();
  server.queue.push({
    match: (r) => r.method === 'PUT',
    status: 400,
    body: [{ code: 'HeatSetpointChangeTimeUntilNotSet', message: 'Time until not set.' }],
  });
  await assert.rejects(client.setZoneSetpoint(ZONES.LIVING, { mode: 'TemporaryOverride' }), {
    kind: 'rejected',
    code: 'HeatSetpointChangeTimeUntilNotSet',
  });
});

test('installation and status answers', async () => {
  const { server, client } = setup();
  const locations = await client.installation(USER_ID);
  assert.equal(locations[0].locationInfo.locationId, '2738909');
  assert.deepEqual(server.requests.at(-1).query, {
    userId: USER_ID,
    includeTemperatureControlSystems: 'True',
  });
  const read = await client.locationStatus('2738909');
  assert.equal(read.locationId, '2738909');
  assert.equal(server.requests.at(-1).query.includeTemperatureControlSystems, 'True');
  await assert.rejects(client.locationStatus('999'), { kind: 'not_found' });
});

test('API dates: UTC, seconds, Z', () => {
  assert.equal(apiDate(Date.UTC(2026, 0, 2, 3, 4, 5, 678)), '2026-01-02T03:04:05Z');
});
