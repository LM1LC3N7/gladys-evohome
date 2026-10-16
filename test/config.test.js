import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, accountKey, normalizeConfig } from '../src/config.js';
import { fileStore, normalizeMemory } from '../src/store.js';

test('the defaults, mirrored by the manifest', () => {
  assert.deepEqual(normalizeConfig(), {
    email: '',
    password: '',
    account: '',
    location: '',
    overrideMode: 'temporary',
    overrideDuration: DEFAULTS.override_duration,
    boostDuration: DEFAULTS.dhw_boost_duration,
    pollInterval: 300,
    language: 'fr',
  });
});

test('values bounded and cleaned', () => {
  const config = normalizeConfig({
    email: '  User@Example.com ',
    password: ' secret ',
    location: ' Home ',
    override_mode: 'PERMANENT',
    override_duration: '5',
    dhw_boost_duration: 99999,
    poll_interval: 10,
    language: 'EN',
  });
  assert.equal(config.email, 'User@Example.com');
  assert.equal(config.password, ' secret ', 'a password is kept as typed');
  assert.equal(config.account, accountKey('user@example.com'));
  assert.equal(config.location, 'Home');
  assert.equal(config.overrideMode, 'permanent');
  assert.equal(config.overrideDuration, 10);
  assert.equal(config.boostDuration, 1440);
  assert.equal(config.pollInterval, 60, 'never faster than once a minute');
  assert.equal(config.language, 'en');
  const odd = normalizeConfig({ override_mode: 'forever', poll_interval: 'often', language: 'de' });
  assert.deepEqual([odd.overrideMode, odd.pollInterval, odd.language], ['temporary', 300, 'fr']);
});

test('the account key hides the e-mail', () => {
  assert.match(accountKey('a@b.c'), /^[0-9a-f]{16}$/);
  assert.equal(accountKey(' A@B.C '), accountKey('a@b.c'));
});

test('the persisted state, repaired', () => {
  assert.deepEqual(normalizeMemory(null), { session: null });
  assert.deepEqual(normalizeMemory({ session: { account: 'k' } }), { session: null });
  assert.deepEqual(
    normalizeMemory({ session: { account: 'k', refreshToken: 'r', expiresAt: 'x', userId: 7 } }),
    { session: { account: 'k', accessToken: null, expiresAt: 0, refreshToken: 'r', userId: null } },
  );
  assert.deepEqual(
    normalizeMemory({
      session: { account: 'k', accessToken: 'a', expiresAt: 5, refreshToken: 'r', userId: '1' },
    }),
    { session: { account: 'k', accessToken: 'a', expiresAt: 5, refreshToken: 'r', userId: '1' } },
  );
});

test('the state file: written atomically, readable by its owner only', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'evohome-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = fileStore(join(dir, 'state.json'));
  assert.equal(await store.load(), null);
  await store.save({ session: { account: 'k' } });
  assert.deepEqual(await store.load(), { session: { account: 'k' } });
  assert.equal(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')).session.account, 'k');
  assert.equal((await stat(join(dir, 'state.json'))).mode & 0o777, 0o600);
});
