// -----------------------------------------------------------------------------
// The installation -> Gladys devices, and the status -> their states (pure).
//
// One device per temperature control system (the Evohome controller of a
// location), `ext:<selector>:system:<system id>`, one per heating zone,
// `ext:<selector>:zone:<zone id>`, and one for the hot water when there is
// one, `ext:<selector>:dhw:<dhw id>`. The ids are the ones of the Total
// Connect Comfort cloud: they never change for an installation.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DHW_STATES, GLADYS, SETPOINT_MODES } from './constants.js';
import {
  DEVICE_NAMES,
  DHW_MODE_NAMES,
  FEATURE_NAMES,
  HEATING_MODE_NAMES,
  NONE,
  SETPOINT_MODE_NAMES,
  SYSTEM_MODE_NAMES,
  word,
} from './i18n.js';

const { THERMOSTAT_MODE, WATER_HEATER_MODE } = GLADYS;

const select = { category: C.TEXT, type: T.TEXT.SELECT, min: 0, max: 0, keep_history: false };
const text = { category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false };
const writable = { read_only: false, has_feedback: true };

/** The features, by role (the last part of their external id), per device kind. */
export const FEATURES = {
  system: {
    mode: { ...select, ...writable, nameKey: 'system-mode' },
    'mode-until': { ...text, nameKey: 'mode-until' },
  },
  zone: {
    temperature: {
      category: C.TEMPERATURE_SENSOR,
      type: T.SENSOR.DECIMAL,
      unit: U.CELSIUS,
      min: -10,
      max: 50,
    },
    setpoint: {
      category: C.THERMOSTAT,
      type: T.THERMOSTAT.TARGET_TEMPERATURE,
      unit: U.CELSIUS,
      ...writable,
    },
    'heating-mode': {
      category: C.THERMOSTAT,
      type: T.THERMOSTAT.MODE,
      min: THERMOSTAT_MODE.OFF,
      max: THERMOSTAT_MODE.HEATING,
      keep_history: false,
      ...writable,
    },
    'setpoint-mode': { ...select, ...writable },
    'override-until': { ...text },
  },
  dhw: {
    temperature: {
      category: C.TEMPERATURE_SENSOR,
      type: T.TEMPERATURE_SENSOR.PROBE,
      unit: U.CELSIUS,
      min: 0,
      max: 100,
      nameKey: 'dhw-temperature',
    },
    state: {
      category: C.WATER_HEATER,
      type: T.WATER_HEATER.BINARY,
      min: 0,
      max: 1,
      ...writable,
      nameKey: 'dhw-state',
    },
    mode: {
      category: C.WATER_HEATER,
      type: T.WATER_HEATER.MODE,
      min: WATER_HEATER_MODE.OFF,
      max: WATER_HEATER_MODE.PROGRAM,
      keep_history: false,
      ...writable,
      nameKey: 'dhw-mode',
    },
    'override-until': { ...text },
  },
  common: {
    'battery-low': { category: C.BATTERY_LOW, type: T.BATTERY_LOW.BINARY, min: 0, max: 1 },
    fault: { category: C.INPUT, type: T.INPUT.BINARY, min: 0, max: 1 },
    faults: { ...text },
  },
};

/** The hot water modes offered, in this order (WATER_HEATER_MODE values). */
export const DHW_MODES = [
  WATER_HEATER_MODE.PROGRAM,
  WATER_HEATER_MODE.MANUAL,
  WATER_HEATER_MODE.BOOST,
  WATER_HEATER_MODE.OFF,
];

export const systemIds = (gladys, id) => gladys.externalIds('system', String(id));
export const zoneIds = (gladys, id) => gladys.externalIds('zone', String(id));
export const dhwIds = (gladys, id) => gladys.externalIds('dhw', String(id));

/** The kind, the Evohome id and the role of a device or feature external id. */
export function parseExternalId(externalId) {
  const match = /:(system|zone|dhw):([^:]+)(?::([^:]+))?$/.exec(String(externalId ?? ''));
  return match ? { kind: match[1], id: match[2], role: match[3] } : undefined;
}

export const systemName = (system, language) =>
  `${word(DEVICE_NAMES.system, language)} ${system.locationName}`.trim();
export const zoneName = (zone, language) =>
  zone.name || `${word(DEVICE_NAMES.zone, language)} ${zone.id}`;
export const dhwName = (_dhw, language) => word(DEVICE_NAMES.dhw, language);

function feature(ids, kind, role, language, extra = {}) {
  const { nameKey = role, ...spec } = FEATURES[kind][role] ?? FEATURES.common[role];
  return {
    name: word(FEATURE_NAMES[nameKey], language),
    external_id: ids.feature(role),
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...spec,
    ...extra,
  };
}

const options = (values, names, language) =>
  values.map((value, i) => ({
    value,
    label: word(names[value] ?? { en: String(value) }, language),
    sort_order: i,
  }));

function params(entries) {
  return entries
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([name, value]) => ({ name, value: String(value) }));
}

const faultFeatures = (ids, kind, language, { battery = true } = {}) => [
  ...(battery ? [feature(ids, kind, 'battery-low', language)] : []),
  feature(ids, kind, 'fault', language),
  feature(ids, kind, 'faults', language),
];

function systemDevice(gladys, system, language) {
  const ids = systemIds(gladys, system.id);
  return {
    name: systemName(system, language),
    external_id: ids.device,
    features: [
      feature(ids, 'system', 'mode', language, {
        supported_options: options(
          system.modes.map((m) => m.mode),
          SYSTEM_MODE_NAMES,
          language,
        ),
      }),
      feature(ids, 'system', 'mode-until', language),
      ...faultFeatures(ids, 'system', language, { battery: false }),
    ],
    params: params([
      ['location', system.locationName],
      ['location_id', system.locationId],
      ['model', system.model],
      ['evohome_id', system.id],
    ]),
  };
}

function zoneDevice(gladys, system, zone, language) {
  const ids = zoneIds(gladys, zone.id);
  return {
    name: zoneName(zone, language),
    external_id: ids.device,
    features: [
      feature(ids, 'zone', 'temperature', language),
      feature(ids, 'zone', 'setpoint', language, { min: zone.min, max: zone.max }),
      feature(ids, 'zone', 'heating-mode', language, {
        supported_options: options(
          [THERMOSTAT_MODE.OFF, THERMOSTAT_MODE.HEATING],
          HEATING_MODE_NAMES,
          language,
        ),
      }),
      feature(ids, 'zone', 'setpoint-mode', language, {
        supported_options: options(zone.setpointModes, SETPOINT_MODE_NAMES, language),
      }),
      feature(ids, 'zone', 'override-until', language),
      ...faultFeatures(ids, 'zone', language),
    ],
    params: params([
      ['location', system.locationName],
      ['zone_type', zone.type],
      ['model', zone.model],
      ['evohome_id', zone.id],
    ]),
  };
}

function dhwDevice(gladys, system, dhw, language) {
  const ids = dhwIds(gladys, dhw.id);
  return {
    name: dhwName(dhw, language),
    external_id: ids.device,
    features: [
      feature(ids, 'dhw', 'temperature', language),
      feature(ids, 'dhw', 'state', language),
      feature(ids, 'dhw', 'mode', language, {
        supported_options: options(dhwModes(dhw), DHW_MODE_NAMES, language),
      }),
      feature(ids, 'dhw', 'override-until', language),
      ...faultFeatures(ids, 'dhw', language),
    ],
    params: params([
      ['location', system.locationName],
      ['evohome_id', dhw.id],
    ]),
  };
}

/** The hot water modes this hot water allows (boost needs temporary overrides). */
export function dhwModes(dhw) {
  return DHW_MODES.filter((mode) => {
    if (mode === WATER_HEATER_MODE.PROGRAM) {
      return dhw.modes.includes(SETPOINT_MODES.FOLLOW);
    }
    if (mode === WATER_HEATER_MODE.BOOST) {
      return dhw.modes.includes(SETPOINT_MODES.TEMPORARY);
    }
    return dhw.modes.includes(SETPOINT_MODES.PERMANENT);
  });
}

/** The Gladys devices of a location: each system, its zones, its hot water. */
export function buildDevices(gladys, location, language) {
  const devices = [];
  for (const system of location?.systems ?? []) {
    devices.push(systemDevice(gladys, system, language));
    for (const zone of system.zones) {
      devices.push(zoneDevice(gladys, system, zone, language));
    }
    if (system.dhw) {
      devices.push(dhwDevice(gladys, system, system.dhw, language));
    }
  }
  return devices;
}

// --- States ------------------------------------------------------------------

/** "2026-10-20 18:30" in the time zone of the container (Gladys passes its own). */
export function localTime(ms) {
  if (!Number.isFinite(ms)) {
    return NONE;
  }
  return new Date(ms).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
}

const state = (ids, role, value) => ({ device_feature_external_id: ids.feature(role), ...value });
const binary = (on) => ({ state: on ? GLADYS.ON : GLADYS.OFF });

function faultStates(ids, faults, { battery = true } = {}) {
  if (!faults) {
    return [];
  }
  const states = [
    state(ids, 'fault', binary(faults.length > 0)),
    state(ids, 'faults', { text: faults.length > 0 ? faults.map((f) => f.type).join(', ') : NONE }),
  ];
  if (battery) {
    states.unshift(state(ids, 'battery-low', binary(faults.some(isBatteryFault))));
  }
  return states;
}

export const isBatteryFault = (fault) => /LowBattery/i.test(fault.type);
export const isCommunicationFault = (fault) => /CommunicationLost|ConnectionLost/i.test(fault.type);

/** The states of a system; the faults of its gateway count as its own. */
export function systemStates(ids, status) {
  if (!status) {
    return [];
  }
  const states = [];
  if (status.mode) {
    states.push(state(ids, 'mode', { text: status.mode }));
    states.push(
      state(ids, 'mode-until', { text: status.permanent ? NONE : localTime(status.until) }),
    );
  }
  return [...states, ...faultStates(ids, status.faults, { battery: false })];
}

/** Off when the system heats nothing, or the zone is held at its minimum. */
export function heatingMode(zone, status, systemMode) {
  if (systemMode === 'HeatingOff') {
    return THERMOSTAT_MODE.OFF;
  }
  const held = status.setpointMode && status.setpointMode !== SETPOINT_MODES.FOLLOW;
  if (held && status.setpoint !== undefined && status.setpoint <= zone.min) {
    return THERMOSTAT_MODE.OFF;
  }
  return THERMOSTAT_MODE.HEATING;
}

export function zoneStates(ids, zone, status, systemMode) {
  if (!status) {
    return [];
  }
  const states = [];
  if (status.temperature !== undefined) {
    states.push(state(ids, 'temperature', { state: status.temperature }));
  }
  if (status.setpoint !== undefined) {
    states.push(state(ids, 'setpoint', { state: status.setpoint }));
    states.push(state(ids, 'heating-mode', { state: heatingMode(zone, status, systemMode) }));
  }
  if (status.setpointMode) {
    states.push(state(ids, 'setpoint-mode', { text: status.setpointMode }));
    const until = status.setpointMode === SETPOINT_MODES.TEMPORARY ? status.until : undefined;
    states.push(state(ids, 'override-until', { text: localTime(until) }));
  }
  return [...states, ...faultStates(ids, status.faults)];
}

/** Evohome state and mode -> WATER_HEATER_MODE. */
export function dhwMode({ state: on, mode }) {
  if (mode === SETPOINT_MODES.FOLLOW) {
    return WATER_HEATER_MODE.PROGRAM;
  }
  if (on === DHW_STATES.OFF) {
    return WATER_HEATER_MODE.OFF;
  }
  return mode === SETPOINT_MODES.TEMPORARY ? WATER_HEATER_MODE.BOOST : WATER_HEATER_MODE.MANUAL;
}

export function dhwStates(ids, status) {
  if (!status) {
    return [];
  }
  const states = [];
  if (status.temperature !== undefined) {
    states.push(state(ids, 'temperature', { state: status.temperature }));
  }
  if (status.state) {
    states.push(state(ids, 'state', binary(status.state === DHW_STATES.ON)));
  }
  if (status.state && status.mode) {
    states.push(state(ids, 'mode', { state: dhwMode(status) }));
    const until = status.mode === SETPOINT_MODES.TEMPORARY ? status.until : undefined;
    states.push(state(ids, 'override-until', { text: localTime(until) }));
  }
  return [...states, ...faultStates(ids, status.faults)];
}
