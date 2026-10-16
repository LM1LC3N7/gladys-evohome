// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { DURATIONS, OVERRIDE_MODES, POLL_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  location: '',
  override_mode: 'temporary',
  override_duration: DURATIONS.override.default,
  dhw_boost_duration: DURATIONS.boost.default,
  poll_interval: POLL_INTERVAL.default,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/** The account a session belongs to, without keeping the e-mail itself. */
export const accountKey = (email) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);

const bounded = (raw, { min, max, default: fallback }) => {
  const value = Number(raw);
  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.round(Math.max(min, Math.min(max, value)));
};

export function normalizeConfig(raw = {}) {
  const email = String(raw?.email ?? '').trim();
  const password = String(raw?.password ?? '');
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  const mode = String(raw?.override_mode ?? DEFAULTS.override_mode)
    .trim()
    .toLowerCase();
  return {
    email,
    password,
    account: email === '' ? '' : accountKey(email),
    location: String(raw?.location ?? '').trim(),
    overrideMode: OVERRIDE_MODES.includes(mode) ? mode : DEFAULTS.override_mode,
    overrideDuration: bounded(raw?.override_duration, DURATIONS.override),
    boostDuration: bounded(raw?.dhw_boost_duration, DURATIONS.boost),
    pollInterval: bounded(raw?.poll_interval, POLL_INTERVAL),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
