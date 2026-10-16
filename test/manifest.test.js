// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import {
  ACTIONS,
  DURATIONS,
  OVERRIDE_MODES,
  POLL_INTERVAL,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  SYSTEM_MODES,
} from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');
const app = read('src/app.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

const byKey = (list) => Object.fromEntries(list.map((entry) => [entry.key, entry]));

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.match(
    manifest.gladys_version,
    /^>=5\.1\.0$/,
    'scene triggers and actions need Gladys 5.1',
  );
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-evohome:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/LM1LC3N7/gladys-evohome/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /not\s+affiliated\s+with\s+Honeywell|sans\s+lien\s+avec\s+Honeywell/i);
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code', () => {
  const fields = byKey(manifest.config_schema);
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.deepEqual(
    fields.override_mode.options.map((o) => o.value),
    OVERRIDE_MODES,
  );
  assert.equal(fields.email.type, 'string');
  assert.equal(fields.password.type, 'secret', 'the password is never sent back to the browser');
  assert.equal(fields.email.required && fields.password.required, true);
  assert.equal(fields.location.required, false);
  const range = (f) => [f.min, f.max];
  assert.deepEqual(range(fields.poll_interval), [POLL_INTERVAL.min, POLL_INTERVAL.max]);
  assert.ok(POLL_INTERVAL.min >= 60, 'never faster than Home Assistant allows');
  assert.equal(POLL_INTERVAL.default, 300);
  assert.deepEqual(range(fields.override_duration), [
    DURATIONS.override.min,
    DURATIONS.override.max,
  ]);
  assert.deepEqual(range(fields.dhw_boost_duration), [DURATIONS.boost.min, DURATIONS.boost.max]);
  const intro = fields.intro;
  assert.equal(intro.type, 'section');
  for (const lang of ['en', 'fr']) {
    assert.ok(intro.description[lang].length <= 1000, `intro.${lang} over 1000 characters`);
    assert.match(intro.description[lang], /Total Connect Comfort/);
  }
  assert.ok(intro.links.length <= 5 && intro.links.every((l) => l.url.startsWith('https://')));
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.ok(
      handlers.includes(`onSceneAction(SCENE_ACTIONS.${name}`),
      `SCENE_ACTIONS.${name} has no handler`,
    );
  }
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  assert.ok(handlers.includes('onSetValue'));
});

test('the scene action fields are the ones the handlers read', () => {
  const actions = byKey(manifest.scene_actions);
  const fieldsOf = (key) => actions[key].fields.map((f) => f.key);
  assert.deepEqual(fieldsOf(SCENE_ACTIONS.SET_SYSTEM_MODE), ['system', 'mode', 'hours', 'days']);
  assert.deepEqual(fieldsOf(SCENE_ACTIONS.SET_ZONE_SETPOINT), ['zone', 'temperature', 'minutes']);
  assert.deepEqual(fieldsOf(SCENE_ACTIONS.CLEAR_ZONE_OVERRIDE), ['zone']);
  assert.deepEqual(fieldsOf(SCENE_ACTIONS.SET_HOT_WATER), ['hot_water', 'state', 'minutes']);
  for (const action of manifest.scene_actions) {
    for (const field of action.fields) {
      assert.ok(app.includes(`fields.${field.key}`), `${action.key}.${field.key} is never read`);
    }
    for (const output of action.outputs ?? []) {
      assert.equal(output.key, 'until', 'sceneAction() resolves { until }');
    }
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
  }
  const mode = byKey(actions[SCENE_ACTIONS.SET_SYSTEM_MODE].fields).mode;
  assert.deepEqual(
    mode.options.map((o) => o.value),
    SYSTEM_MODES,
  );
  const state = byKey(actions[SCENE_ACTIONS.SET_HOT_WATER].fields).state;
  assert.deepEqual(
    state.options.map((o) => o.value),
    ['on', 'off', 'auto'],
  );
  for (const key of ['system', 'zone', 'hot_water']) {
    const field = manifest.scene_actions.flatMap((a) => a.fields).find((f) => f.key === key);
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('the trigger fields and variables are what the events carry', () => {
  const triggers = byKey(manifest.scene_triggers);
  const declared = (key) => [...triggers[key].fields, ...triggers[key].variables].map((f) => f.key);
  // The data objects of pushSceneEvent in src/app.js: the mode one, then the fault one.
  const [modeData, faultData] = [
    ...app.matchAll(/pushSceneEvent\(event\.key, \{([\s\S]*?)\}\);/g),
  ].map((m) => m[1]);
  assert.deepEqual(declared(SCENE_TRIGGERS.SYSTEM_MODE_CHANGED), [
    'system',
    'mode',
    'system_name',
    'previous_mode',
    'permanent',
    'until',
  ]);
  for (const key of declared(SCENE_TRIGGERS.SYSTEM_MODE_CHANGED)) {
    assert.match(modeData, new RegExp(`\\b${key}:`), `system_mode_changed: ${key} is never sent`);
  }
  for (const trigger of [SCENE_TRIGGERS.FAULT_DETECTED, SCENE_TRIGGERS.FAULT_CLEARED]) {
    assert.deepEqual(declared(trigger), ['device', 'device_name', 'fault_type', 'since']);
  }
  // device and device_name are in `common`, spread into the fault events.
  assert.match(faultData, /\.\.\.common,\s+fault_type:[\s\S]*since:/);
  assert.match(app, /const common = \{ device: entry\.ids\.device, device_name:/);
  const mode = byKey(triggers[SCENE_TRIGGERS.SYSTEM_MODE_CHANGED].fields).mode;
  assert.deepEqual(
    mode.options.map((o) => o.value),
    SYSTEM_MODES.filter((m) => m !== 'AutoWithReset'),
    'a reset reads as Auto',
  );
  for (const trigger of manifest.scene_triggers) {
    const devices = trigger.fields.filter((f) => f.type === 'select');
    assert.ok(devices.every((f) => f.source === 'devices' && f.options === undefined));
  }
});
