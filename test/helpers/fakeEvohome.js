// -----------------------------------------------------------------------------
// A fake Total Connect Comfort cloud behind the transport the integration is
// given: the token endpoint (password and refresh grants), the user account,
// the installation, the location status and the three PUTs, with the statuses
// and bodies the evohome-async tests recorded against the real server (400
// `invalid_grant`, 429 `attempt_limit_exceeded`, 401 `Unauthorized`, 201 and a
// comm task id for a PUT). The PUTs change the status like the controller
// would. Records every request. No network.
// -----------------------------------------------------------------------------

import { API } from '../../src/constants.js';
import { EvohomeError } from '../../src/evohome.js';
import {
  EMAIL,
  PASSWORD,
  installation,
  otherStatus,
  status,
  systemOf,
  userAccount,
} from '../fixtures/evohome.js';

const answer = (status, body, headers = {}) => ({
  status,
  headers,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const unauthorized = () => answer(401, [{ code: 'Unauthorized', message: 'Unauthorized.' }]);

export function fakeEvohome({ second = false } = {}) {
  const server = {
    email: EMAIL,
    password: PASSWORD,
    account: userAccount(),
    installation: installation({ second }),
    statuses: { [systemOf(status()).systemId]: status() },
    /** { method, path, query, form, body, token, headers } */
    requests: [],
    accessTokens: new Set(),
    refreshTokens: new Set(),
    issued: 0,
    lifetime: 1799,
    /** No answer at all (DNS, connection refused). */
    down: false,
    /** One-shot answers: { match(request), status, body, headers } */
    queue: [],
    commTasks: 0,
    tokenRequests() {
      return this.requests.filter((r) => r.path === API.tokenPath);
    },
    grants(type) {
      return this.tokenRequests().filter((r) => r.form.grant_type === type);
    },
    statusReads() {
      return this.requests.filter((r) => /\/status$/.test(r.path));
    },
    puts() {
      return this.requests.filter((r) => r.method === 'PUT');
    },
    apiCalls() {
      return this.requests.filter((r) => r.path !== API.tokenPath);
    },
    /** The status of "My Home" as the next read will return it. */
    get data() {
      return this.statuses['3432522'];
    },
    issue() {
      this.issued += 1;
      const access = `access-${this.issued}`;
      const refresh = `refresh-${this.issued}`;
      this.accessTokens.add(access);
      this.refreshTokens.add(refresh);
      return {
        access_token: access,
        token_type: 'bearer',
        expires_in: this.lifetime,
        refresh_token: refresh,
        scope: 'EMEA-V1-Basic EMEA-V1-Anonymous',
      };
    },
    /** Revokes every access token (they expired early), keeping the refresh tokens. */
    revokeAccess() {
      this.accessTokens.clear();
    },
  };
  server.statuses['0002003'] = otherStatus();

  const findSystem = (systemId) =>
    Object.values(server.statuses)
      .flatMap((s) => s.gateways.flatMap((g) => g.temperatureControlSystems))
      .find((t) => t.systemId === systemId);
  const findZone = (zoneId) =>
    Object.values(server.statuses)
      .flatMap((s) => s.gateways.flatMap((g) => g.temperatureControlSystems))
      .flatMap((t) => t.zones)
      .find((z) => z.zoneId === zoneId);
  const findDhw = (dhwId) =>
    Object.values(server.statuses)
      .flatMap((s) => s.gateways.flatMap((g) => g.temperatureControlSystems))
      .map((t) => t.dhw)
      .find((d) => d?.dhwId === dhwId);

  server.transport = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const target = new URL(url);
    const path = target.pathname.replace(API.basePath, '');
    const json = headers['Content-Type'] === 'application/json' ? JSON.parse(body) : undefined;
    const form =
      body !== undefined && json === undefined ? Object.fromEntries(new URLSearchParams(body)) : {};
    const request = {
      method,
      path,
      query: Object.fromEntries(target.searchParams),
      form,
      body: json,
      token: String(headers.Authorization ?? '').replace(/^Bearer /, ''),
      headers,
    };
    server.requests.push(request);
    if (server.down) {
      throw new EvohomeError('network', 'connection refused');
    }
    const forced = server.queue.findIndex((q) => q.match(request));
    if (forced >= 0) {
      const [{ status: code, body: forcedBody, headers: forcedHeaders }] = server.queue.splice(
        forced,
        1,
      );
      return answer(code, forcedBody, forcedHeaders);
    }

    if (path === API.tokenPath && method === 'POST') {
      if (headers.Authorization !== API.clientAuthorization) {
        return answer(400, { error: 'invalid_client' });
      }
      if (form.scope !== API.scope) {
        return answer(400, { error: 'invalid_scope' });
      }
      if (form.grant_type === 'password') {
        if (form.Username !== server.email || form.Password !== server.password) {
          return answer(400, { error: 'invalid_grant' });
        }
        return answer(200, server.issue());
      }
      if (form.grant_type === 'refresh_token') {
        if (!server.refreshTokens.has(form.refresh_token)) {
          return answer(400, { error: 'invalid_grant' });
        }
        server.refreshTokens.delete(form.refresh_token);
        return answer(200, server.issue());
      }
      return answer(400, { error: 'unsupported_grant_type' });
    }

    if (!server.accessTokens.has(request.token)) {
      return unauthorized();
    }
    if (path === '/userAccount' && method === 'GET') {
      return answer(200, server.account);
    }
    if (path === '/location/installationInfo' && method === 'GET') {
      if (request.query.userId !== server.account.userId) {
        return answer(401, [
          { code: 'Unauthorized', message: 'You are not allowed to perform this action.' },
        ]);
      }
      return answer(200, server.installation);
    }
    const location = /^\/location\/(\d+)\/status$/.exec(path);
    if (location && method === 'GET') {
      const found = Object.values(server.statuses).find((s) => s.locationId === location[1]);
      return found ? answer(200, found) : answer(404, '<html>Not Found</html>');
    }
    const comm = () => {
      server.commTasks += 1;
      return answer(201, { id: String(1668279943 + server.commTasks) });
    };
    const mode = /^\/temperatureControlSystem\/(\d+)\/mode$/.exec(path);
    if (mode && method === 'PUT') {
      const tcs = findSystem(mode[1]);
      const { systemMode, permanent, timeUntil } = request.body ?? {};
      if (!tcs) {
        return answer(401, [
          { code: 'Unauthorized', message: 'You are not allowed to perform this action.' },
        ]);
      }
      if (!systemMode) {
        return answer(400, [{ code: 'ParameterIsMissing', parameterName: 'TccSystemMode' }]);
      }
      if (permanent === false && !timeUntil) {
        return answer(400, [{ code: 'SystemModeChangeTimeUntilNotSet' }]);
      }
      tcs.systemModeStatus = permanent
        ? { mode: systemMode === 'AutoWithReset' ? 'Auto' : systemMode, isPermanent: true }
        : { mode: systemMode, timeUntil, isPermanent: false };
      if (systemMode === 'AutoWithReset') {
        for (const z of tcs.zones) {
          z.setpointStatus = {
            targetHeatTemperature: z.setpointStatus.targetHeatTemperature,
            setpointMode: 'FollowSchedule',
          };
        }
      }
      return comm();
    }
    const setpoint = /^\/temperatureZone\/(\d+)\/heatSetpoint$/.exec(path);
    if (setpoint && method === 'PUT') {
      const zone = findZone(setpoint[1]);
      const { setpointMode, heatSetpointValue, timeUntil } = request.body ?? {};
      if (!zone) {
        return answer(401, [
          { code: 'Unauthorized', message: 'You are not allowed to perform this action.' },
        ]);
      }
      if (setpointMode === 'FollowSchedule') {
        zone.setpointStatus = {
          targetHeatTemperature: zone.setpointStatus.targetHeatTemperature,
          setpointMode,
        };
        return comm();
      }
      if (heatSetpointValue === undefined) {
        return answer(400, [{ code: 'HeatSetpointChangeTargetTemperatureNotSet' }]);
      }
      if (setpointMode === 'TemporaryOverride' && !timeUntil) {
        return answer(400, [{ code: 'HeatSetpointChangeTimeUntilNotSet' }]);
      }
      zone.setpointStatus = {
        targetHeatTemperature: heatSetpointValue,
        setpointMode,
        ...(setpointMode === 'TemporaryOverride' ? { until: timeUntil } : {}),
      };
      return comm();
    }
    const dhw = /^\/domesticHotWater\/(\d+)\/state$/.exec(path);
    if (dhw && method === 'PUT') {
      const found = findDhw(dhw[1]);
      const { mode: dhwMode, state, untilTime } = request.body ?? {};
      if (!found) {
        return answer(401, [
          { code: 'Unauthorized', message: 'You are not allowed to perform this action.' },
        ]);
      }
      if (dhwMode === 'FollowSchedule') {
        found.stateStatus = { state: found.stateStatus.state, mode: dhwMode };
        return comm();
      }
      if (!state) {
        return answer(400, [{ code: 'DHWStateNotSet' }]);
      }
      if (dhwMode === 'TemporaryOverride' && !untilTime) {
        return answer(400, [{ code: 'DHWUntilTimeNotSet' }]);
      }
      found.stateStatus = {
        state,
        mode: dhwMode,
        ...(dhwMode === 'TemporaryOverride' ? { until: untilTime } : {}),
      };
      return comm();
    }
    return answer(404, '<html>Not Found</html>');
  };

  return server;
}

/** An in-memory store, in place of the /data file. */
export function memoryStore(initial = null) {
  return {
    data: initial,
    saves: 0,
    async load() {
      return this.data === null ? null : structuredClone(this.data);
    },
    async save(data) {
      this.saves += 1;
      this.data = structuredClone(data);
    },
  };
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
