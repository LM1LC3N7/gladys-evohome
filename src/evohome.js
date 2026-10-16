// -----------------------------------------------------------------------------
// The only network access: HTTPS requests to the Total Connect Comfort
// international cloud (the Evohome "v2" API of the Evohome app), and the
// errors they end with.
//
// The API is undocumented. What is used here was read from evohome-async
// (Apache-2.0, the library of the Home Assistant evohome integration) and the
// Home Assistant integration itself, as protocol documentation.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { LIMITS, TIMINGS } from './constants.js';

/**
 * A failed Evohome call. `kind`:
 * - `no_credentials`: no e-mail or password in the configuration (never sent);
 * - `refused`: the sign-in was refused (wrong e-mail or password);
 * - `refresh_refused`: the refresh token was refused (expired or revoked);
 * - `unauthorized`: the API refused the access token (401);
 * - `forbidden`: the API refused the request (403);
 * - `rate_limited`: too many requests or sign-ins (429), `retryAfter` in ms when given;
 * - `unavailable`: the cloud is down (5xx);
 * - `network`, `timeout`: no answer;
 * - `bad_response`, `size`: an answer that is not the expected JSON;
 * - `not_found`: an unknown location, zone or hot water (404);
 * - `rejected`: a command the API refused (400 on a write);
 * - `http`: any other status.
 */
export class EvohomeError extends Error {
  constructor(kind, message, { status, retryAfter, code } = {}) {
    super(message);
    this.name = 'EvohomeError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
    /** The error code of the answer (`invalid_grant`, `attempt_limit_exceeded`…), when any. */
    this.code = code;
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
};

/** A socket error -> EvohomeError (never the request: the sign-in carries the password). */
export function networkError(err) {
  if (err instanceof EvohomeError) {
    return err;
  }
  const reason = NETWORK_REASONS[err?.code] ?? err?.code ?? 'network error';
  return new EvohomeError('network', reason);
}

/** A short, secret-free reason for a log or a status message. */
export function errorReason(err) {
  if (err instanceof EvohomeError) {
    return err.status ? `${err.message} (HTTP ${err.status})` : err.message;
  }
  return String(err?.message ?? err);
}

/**
 * One request; resolves `{ status, headers, body }` whatever the status. The
 * promise settles once: a request destroyed for its size or its timeout may
 * still end or fail after that.
 * @param {string} url
 * @param {{ method?: string, headers?: object, body?: string, timeout?: number, maxBytes?: number }} options
 */
export function httpRequest(
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeout = TIMINGS.requestTimeout,
    maxBytes = LIMITS.responseBytes,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    let timer;
    let settled = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = lib.request(target, { method, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          settle(reject, new EvohomeError('size', 'answer too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        settle(resolve, {
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      res.on('error', (err) => settle(reject, networkError(err)));
    });
    timer = setTimeout(() => {
      settle(
        reject,
        new EvohomeError('timeout', `no answer within ${Math.round(timeout / 1000)} s`),
      );
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err)));
    req.end(body);
  });
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** A JSON body, undefined when it is not JSON. */
export function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** The error code of an answer: `{ error }` (OAuth) or `[{ code, message }]` (API). */
export function errorCode(body) {
  const json = parseJson(body);
  if (Array.isArray(json)) {
    return typeof json[0]?.code === 'string' ? json[0].code : undefined;
  }
  return typeof json?.error === 'string' ? json.error : undefined;
}

/**
 * The error of a non-2xx answer (statuses and bodies recorded by the
 * evohome-async tests against the real server). `token`: the answer of the
 * token endpoint, `refresh`: of a refresh grant.
 */
export function errorFor(
  { status, headers = {}, body },
  { token = false, refresh = false, now } = {},
) {
  const code = errorCode(body);
  const retryAfter = parseRetryAfter(headers['retry-after'], now);
  if (status === 429) {
    const err = new EvohomeError(
      'rate_limited',
      token ? 'too many sign-ins' : 'too many requests',
      {
        status,
        retryAfter,
        code,
      },
    );
    err.login = token;
    return err;
  }
  if (token && status === 400) {
    // `invalid_grant`: a wrong password, or a refresh token that expired.
    return refresh
      ? new EvohomeError('refresh_refused', 'session refused', { status, code })
      : new EvohomeError('refused', 'e-mail or password refused', { status, code });
  }
  if (token && status === 401) {
    return new EvohomeError('refused', 'sign-in refused', { status, code });
  }
  if (status === 401) {
    return new EvohomeError('unauthorized', 'access refused', { status, code });
  }
  if (status === 403) {
    return new EvohomeError('forbidden', 'request refused', { status, code });
  }
  if (status === 404) {
    return new EvohomeError('not_found', 'unknown location or device', { status, code });
  }
  if (status === 400) {
    return new EvohomeError('rejected', code ? `request refused: ${code}` : 'request refused', {
      status,
      code,
    });
  }
  if (status >= 500) {
    return new EvohomeError('unavailable', 'Total Connect Comfort is unavailable', {
      status,
      code,
    });
  }
  return new EvohomeError('http', 'request failed', { status, code });
}

/** A JSON answer that must be an object (or an array with `array`). */
export function parseAnswer(body, { array = false } = {}) {
  const json = parseJson(body);
  const ok = array ? Array.isArray(json) : json && typeof json === 'object' && !Array.isArray(json);
  if (!ok) {
    throw new EvohomeError('bad_response', 'Total Connect Comfort sent an unexpected answer');
  }
  return json;
}
