// -----------------------------------------------------------------------------
// The Total Connect Comfort account: the OAuth session (an access token of
// about 30 minutes and a refresh token, from the password grant of the
// Evohome app), renewed with the refresh token, and the calls the integration
// needs. Every request goes through the transport of src/evohome.js.
//
// As evohome-async does: the access token is renewed just before it expires
// (never on a timer), a refused refresh token falls back once to the
// password, an API call refused with 401 gets one new token and one retry.
// -----------------------------------------------------------------------------

import { API, PATHS, TIMINGS } from './constants.js';
import { EvohomeError, errorFor, httpRequest, parseAnswer } from './evohome.js';

/** A date as the API takes it: UTC, seconds, "Z" (evohome-async TCC_DTM_STRFTIME). */
export const apiDate = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export class EvohomeClient {
  constructor({
    transport = httpRequest,
    now = Date.now,
    host = API.host,
    userAgent = 'gladys-evohome',
    onSession,
  } = {}) {
    this.transport = transport;
    this.now = now;
    this.host = host;
    this.userAgent = userAgent;
    /** Called with the new session after each sign-in or renewal (never throws). */
    this.onSession = onSession;
    this.email = '';
    this.password = '';
    /** { accessToken, expiresAt, refreshToken, userId } | null */
    this.session = null;
    this.signingIn = undefined;
  }

  configure({ email, password, session = null }) {
    this.email = email;
    this.password = password;
    this.session = session
      ? {
          accessToken: session.accessToken ?? null,
          expiresAt: session.expiresAt ?? 0,
          refreshToken: session.refreshToken ?? null,
          userId: session.userId ?? null,
        }
      : null;
  }

  get hasCredentials() {
    return this.email !== '' && this.password !== '';
  }

  async save() {
    try {
      await this.onSession?.(this.session);
    } catch {
      // Saving is best effort: the session still works in memory.
    }
  }

  // --- Session ----------------------------------------------------------------

  /** Whether the access token can be used for one more request. */
  tokenValid() {
    const s = this.session;
    return Boolean(s?.accessToken) && this.now() < s.expiresAt - TIMINGS.tokenMargin;
  }

  async grant(form, { refresh = false } = {}) {
    const body = new URLSearchParams(form).toString();
    const answer = await this.transport(`${this.host}${API.tokenPath}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store',
        Pragma: 'no-cache',
        Authorization: API.clientAuthorization,
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': this.userAgent,
      },
      body,
    });
    if (answer.status < 200 || answer.status >= 300) {
      throw errorFor(answer, { token: true, refresh, now: this.now() });
    }
    const json = parseAnswer(answer.body);
    if (typeof json.error === 'string') {
      // Some answers say HTTP 200 and carry the OAuth error (homebridge-evohome).
      const status = json.error === 'attempt_limit_exceeded' ? 429 : 400;
      throw errorFor({ ...answer, status }, { token: true, refresh, now: this.now() });
    }
    const accessToken = json.access_token;
    const lifetime = Number(json.expires_in);
    if (typeof accessToken !== 'string' || accessToken === '') {
      throw new EvohomeError('bad_response', 'Total Connect Comfort sent no access token');
    }
    return {
      accessToken,
      expiresAt: this.now() + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 1800) * 1000,
      refreshToken:
        typeof json.refresh_token === 'string' && json.refresh_token !== ''
          ? json.refresh_token
          : null,
    };
  }

  /**
   * A new access token: from the refresh token when there is one (it falls
   * back to the password when Honeywell refuses it), else from the password.
   * One at a time, the other requests wait for it.
   */
  authenticate() {
    if (!this.hasCredentials) {
      return Promise.reject(new EvohomeError('no_credentials', 'no e-mail or password'));
    }
    if (!this.signingIn) {
      const { email } = this;
      this.signingIn = this.renew()
        .then(async (tokens) => {
          // A sign-in started for another account never overwrites the new one.
          if (this.email === email) {
            this.session = { userId: this.session?.userId ?? null, ...tokens };
            await this.save();
          }
          return tokens;
        })
        .finally(() => {
          this.signingIn = undefined;
        });
    }
    return this.signingIn;
  }

  async renew() {
    const scope = API.scope;
    const refreshToken = this.session?.refreshToken;
    if (refreshToken) {
      try {
        const tokens = await this.grant(
          { grant_type: 'refresh_token', scope, refresh_token: refreshToken },
          { refresh: true },
        );
        return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
      } catch (err) {
        if (err.kind !== 'refresh_refused') {
          throw err;
        }
        if (this.session) {
          this.session.refreshToken = null;
        }
      }
    }
    // Username and Password: the keys are case-sensitive (evohome-async).
    return this.grant({
      grant_type: 'password',
      scope,
      Username: this.email,
      Password: this.password,
    });
  }

  async token() {
    if (!this.tokenValid()) {
      await this.authenticate();
    }
    return this.session.accessToken;
  }

  // --- Requests ---------------------------------------------------------------

  async send(method, path, token, payload) {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': this.userAgent,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const answer = await this.transport(`${this.host}${API.basePath}${path}`, {
      method,
      headers,
      body,
    });
    if (answer.status < 200 || answer.status >= 300) {
      throw errorFor(answer, { now: this.now() });
    }
    return answer.body;
  }

  async call(method, path, payload) {
    const token = await this.token();
    try {
      return await this.send(method, path, token, payload);
    } catch (err) {
      if (err.kind !== 'unauthorized') {
        throw err;
      }
      // Revoked or expired early: one new token (the refresh token is kept), one retry.
      if (this.session?.accessToken === token) {
        this.session.accessToken = null;
      }
      return this.send(method, path, await this.token(), payload);
    }
  }

  async get(path, options) {
    return parseAnswer(await this.call('GET', path), options);
  }

  /** The id of the user of the account (kept with the session). */
  async userId() {
    const account = await this.get(PATHS.userAccount());
    const id = account.userId;
    if (id === undefined || id === null || String(id) === '') {
      throw new EvohomeError('bad_response', 'Total Connect Comfort sent no user id');
    }
    if (this.session) {
      this.session.userId = String(id);
      await this.save();
    }
    return String(id);
  }

  /** Every location of the user, with its systems, zones and hot water. */
  installation(userId) {
    return this.get(PATHS.installation(userId), { array: true });
  }

  /** The status of a location: modes, temperatures, setpoints, hot water, faults. */
  locationStatus(locationId) {
    return this.get(PATHS.status(locationId));
  }

  /** The system mode, permanent (`until` undefined) or until a time. */
  setSystemMode(systemId, { mode, until }) {
    const body = { systemMode: mode, permanent: until === undefined };
    if (until !== undefined) {
      body.timeUntil = apiDate(until);
    }
    return this.call('PUT', PATHS.systemMode(systemId), body);
  }

  /** A zone setpoint (Permanent or TemporaryOverride with `until`), or FollowSchedule. */
  setZoneSetpoint(zoneId, { mode, setpoint, until }) {
    const body = { setpointMode: mode };
    if (setpoint !== undefined) {
      body.heatSetpointValue = setpoint;
    }
    if (until !== undefined) {
      body.timeUntil = apiDate(until);
    }
    return this.call('PUT', PATHS.zoneSetpoint(zoneId), body);
  }

  /** The hot water On or Off (Permanent or TemporaryOverride with `until`), or FollowSchedule. */
  setDhwState(dhwId, { mode, state, until }) {
    const body = { mode };
    if (state !== undefined) {
      body.state = state;
    }
    if (until !== undefined) {
      // untilTime here, timeUntil for the zones and the system (evohome-async).
      body.untilTime = apiDate(until);
    }
    return this.call('PUT', PATHS.dhwState(dhwId), body);
  }
}
