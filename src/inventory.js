// -----------------------------------------------------------------------------
// The answers of the Total Connect Comfort API -> plain objects (pure).
//
// - installationInfo: locations -> gateways -> temperature control systems
//   (the Evohome controllers) -> zones and hot water, with what each allows
//   (system modes, setpoint range and modes, override durations);
// - location status: the mode of each system, the temperature, setpoint and
//   setpoint mode of each zone, the state of the hot water, the active faults
//   at every level.
// Shapes and names as evohome-async reads them (its schemas and the answers
// recorded in its tests). Unknown or missing values are left undefined.
// -----------------------------------------------------------------------------

import { SETPOINT_MODES } from './constants.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const list = (value) => (Array.isArray(value) ? value : []);
const id = (value) =>
  value === undefined || value === null || String(value) === '' ? undefined : String(value);
const number = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};
const strings = (value) => list(value).filter((v) => typeof v === 'string' && v !== '');

/** "1.00:00:00", "00:10:00", "99.00:00:00" (.NET TimeSpan) -> milliseconds. */
export function parseTimeSpan(value) {
  const match = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) {
    return undefined;
  }
  const [, days = '0', hours, minutes, seconds] = match;
  return (
    Number(days) * DAY +
    Number(hours) * 60 * MINUTE +
    Number(minutes) * MINUTE +
    Number(seconds) * 1000
  );
}

const DATE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * An API date -> milliseconds. The ends of overrides and modes (`until`,
 * `timeUntil`) are UTC with a "Z"; the start of a fault (`since`) is the local
 * time of the location without offset, with up to 7 decimals (evohome-async
 * `helpers.py`): `offsetMinutes` is then the offset of the location from UTC.
 */
export function parseDate(value, offsetMinutes = 0) {
  const match = DATE.exec(typeof value === 'string' ? value.trim() : '');
  if (!match) {
    return undefined;
  }
  const [, y, mo, d, h, mi, sec = '0', fraction = '', zone] = match;
  const ms = Number(`${fraction}000`.slice(0, 3));
  const wall = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(sec),
    ms,
  );
  if (Number.isNaN(wall)) {
    return undefined;
  }
  if (!zone) {
    return wall - offsetMinutes * MINUTE;
  }
  if (/^z$/i.test(zone)) {
    return wall;
  }
  const sign = zone.startsWith('-') ? -1 : 1;
  const [hours, minutes] = [zone.slice(1, 3), zone.slice(-2)].map(Number);
  return wall - sign * (hours * 60 + minutes) * MINUTE;
}

function readModes(raw) {
  return list(raw)
    .filter((m) => typeof m?.systemMode === 'string')
    .map((m) => ({
      mode: m.systemMode,
      permanent: m.canBePermanent !== false,
      temporary: m.canBeTemporary === true,
      maxDuration: parseTimeSpan(m.maxDuration),
      resolution: parseTimeSpan(m.timingResolution),
      /** "Duration" (hours, Eco) or "Period" (whole days: Away, Day off, Custom). */
      timing: typeof m.timingMode === 'string' ? m.timingMode : undefined,
    }));
}

function readZone(raw, systemId) {
  const caps = raw?.setpointCapabilities ?? {};
  const min = number(caps.minHeatSetpoint) ?? 5;
  const max = number(caps.maxHeatSetpoint) ?? 35;
  const modes = strings(caps.allowedSetpointModes);
  return {
    id: id(raw?.zoneId),
    systemId,
    name: typeof raw?.name === 'string' ? raw.name.trim() : '',
    model: raw?.modelType,
    type: raw?.zoneType,
    min,
    max: Math.max(min, max),
    step: number(caps.valueResolution) > 0 ? number(caps.valueResolution) : 0.5,
    setpointModes: modes.length > 0 ? modes : Object.values(SETPOINT_MODES),
    maxDuration: parseTimeSpan(caps.maxDuration),
    resolution: parseTimeSpan(caps.timingResolution),
  };
}

function readDhw(raw, systemId) {
  if (!raw || id(raw.dhwId) === undefined) {
    return null;
  }
  const caps = raw.dhwStateCapabilitiesResponse ?? {};
  const modes = strings(caps.allowedModes);
  return {
    id: id(raw.dhwId),
    systemId,
    states: strings(caps.allowedStates),
    modes: modes.length > 0 ? modes : Object.values(SETPOINT_MODES),
    maxDuration: parseTimeSpan(caps.maxDuration),
    resolution: parseTimeSpan(caps.timingResolution),
  };
}

/** installationInfo -> [{ id, name, timeZone, systems: [{ …, zones, dhw }] }]. */
export function readInstallation(raw) {
  return list(raw)
    .map((entry) => {
      const info = entry?.locationInfo ?? {};
      const locationId = id(info.locationId);
      const name = typeof info.name === 'string' && info.name.trim() ? info.name.trim() : '';
      const systems = [];
      for (const gateway of list(entry?.gateways)) {
        const gatewayId = id(gateway?.gatewayInfo?.gatewayId);
        for (const tcs of list(gateway?.temperatureControlSystems)) {
          const systemId = id(tcs?.systemId);
          if (systemId === undefined) {
            continue;
          }
          systems.push({
            id: systemId,
            locationId,
            locationName: name || locationId,
            gatewayId,
            model: tcs.modelType,
            modes: readModes(tcs.allowedSystemModes),
            zones: list(tcs.zones)
              .map((zone) => readZone(zone, systemId))
              .filter((zone) => zone.id !== undefined),
            dhw: readDhw(tcs.dhw, systemId),
          });
        }
      }
      return {
        id: locationId,
        name: name || locationId,
        timeZone: info.timeZone?.timeZoneId,
        /** Offset of the local time of the location from UTC, now (daylight saving included). */
        offsetMinutes:
          number(info.timeZone?.currentOffsetMinutes) ?? number(info.timeZone?.offsetMinutes) ?? 0,
        systems,
      };
    })
    .filter((location) => location.id !== undefined);
}

/** The location named (id or name, any case) in the configuration, else the first one. */
export function chooseLocation(locations, wanted) {
  const key = String(wanted ?? '')
    .trim()
    .toLowerCase();
  if (key === '') {
    return locations[0];
  }
  return locations.find((l) => l.id === key) ?? locations.find((l) => l.name.toLowerCase() === key);
}

function readFaults(raw, offsetMinutes) {
  return list(raw)
    .filter((f) => typeof f?.faultType === 'string' && f.faultType !== '')
    .map((f) => ({ type: f.faultType, since: parseDate(f.since, offsetMinutes) }));
}

const temperatureOf = (status) =>
  status?.isAvailable === false ? undefined : number(status?.temperature);

/**
 * Location status -> { systems, zones, dhws }: maps by Evohome id. The faults of
 * a gateway are the faults of its systems (`gatewayLost` when it lost the cloud).
 * `offsetMinutes`: the offset of the location from UTC, for the fault dates.
 */
export function readStatus(raw, offsetMinutes = 0) {
  const systems = new Map();
  const zones = new Map();
  const dhws = new Map();
  for (const gateway of list(raw?.gateways)) {
    const gatewayFaults = readFaults(gateway?.activeFaults, offsetMinutes);
    const gatewayLost = gatewayFaults.some((f) => /^GatewayCommunicationLost$/i.test(f.type));
    for (const tcs of list(gateway?.temperatureControlSystems)) {
      const systemId = id(tcs?.systemId);
      if (systemId === undefined) {
        continue;
      }
      const mode = tcs.systemModeStatus ?? {};
      const permanent = mode.isPermanent !== false;
      systems.set(systemId, {
        mode: typeof mode.mode === 'string' ? mode.mode : undefined,
        permanent,
        until: permanent ? undefined : parseDate(mode.timeUntil),
        faults: [...gatewayFaults, ...readFaults(tcs.activeFaults, offsetMinutes)],
        gatewayLost,
      });
      for (const zone of list(tcs.zones)) {
        const zoneId = id(zone?.zoneId);
        if (zoneId === undefined) {
          continue;
        }
        const setpoint = zone.setpointStatus ?? {};
        zones.set(zoneId, {
          temperature: temperatureOf(zone.temperatureStatus),
          setpoint: number(setpoint.targetHeatTemperature),
          setpointMode:
            typeof setpoint.setpointMode === 'string' ? setpoint.setpointMode : undefined,
          until: parseDate(setpoint.until),
          faults: readFaults(zone.activeFaults, offsetMinutes),
        });
      }
      const dhw = tcs.dhw;
      if (dhw && id(dhw.dhwId) !== undefined) {
        const state = dhw.stateStatus ?? {};
        dhws.set(id(dhw.dhwId), {
          temperature: temperatureOf(dhw.temperatureStatus),
          state: typeof state.state === 'string' ? state.state : undefined,
          mode: typeof state.mode === 'string' ? state.mode : undefined,
          until: parseDate(state.until),
          faults: readFaults(dhw.activeFaults, offsetMinutes),
        });
      }
    }
  }
  return { systems, zones, dhws };
}

/** A temporary override end: `minutes` from now, rounded up to the allowed step, capped. */
export function overrideUntil(target, minutes, now) {
  const step = target.resolution > 0 ? target.resolution : 10 * MINUTE;
  const max = target.maxDuration > 0 ? target.maxDuration : DAY;
  const wanted = Math.min(Math.max(minutes * MINUTE, step), max);
  const end = Math.ceil((now + wanted) / step) * step;
  return Math.min(end, now + max);
}

/**
 * The end of a temporary system mode, undefined for a permanent one: `hours`
 * from now for a mode timed by duration, the midnight (local time) `days`
 * from today for a mode timed by period.
 */
export function systemUntil(mode, { hours, days, now }) {
  if (mode.timing === 'Period') {
    if (!days) {
      return undefined;
    }
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    midnight.setDate(midnight.getDate() + Math.ceil(days));
    return midnight.getTime();
  }
  if (!hours) {
    return undefined;
  }
  const step = mode.resolution > 0 ? mode.resolution : 60 * MINUTE;
  const end = Math.ceil((now + hours * 60 * MINUTE) / step) * step;
  return mode.maxDuration > 0 ? Math.min(end, now + mode.maxDuration) : end;
}
