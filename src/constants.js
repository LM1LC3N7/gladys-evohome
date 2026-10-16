// -----------------------------------------------------------------------------
// Manifest keys, Total Connect Comfort API constants, Gladys values, limits and
// timings.
// -----------------------------------------------------------------------------

/**
 * The Total Connect Comfort international cloud, the one of the Evohome app
 * (evohome-async `src/_evohome/const.py`: tccna.resideo.com since December
 * 2024, tccna.honeywell.com before).
 */
export const API = {
  host: 'https://tccna.resideo.com',
  tokenPath: '/Auth/OAuth/Token',
  basePath: '/WebAPI/emea/api/v1',
  /** The application id and secret of the Evohome app, public (evohome-async, Home Assistant). */
  clientAuthorization:
    'Basic NGEyMzEwODktZDJiNi00MWJkLWE1ZWItMTZhMGE0MjJiOTk5OjFhMTVjZGI4LTQyZGUtNDA3Yi1hZGQwLTA1OWY5MmM1MzBjYg==',
  scope: 'EMEA-V1-Basic EMEA-V1-Anonymous',
};

/** API paths, relative to API.basePath. */
export const PATHS = {
  userAccount: () => '/userAccount',
  installation: (userId) =>
    `/location/installationInfo?userId=${encodeURIComponent(userId)}&includeTemperatureControlSystems=True`,
  status: (locationId) =>
    `/location/${encodeURIComponent(locationId)}/status?includeTemperatureControlSystems=True`,
  systemMode: (systemId) => `/temperatureControlSystem/${encodeURIComponent(systemId)}/mode`,
  zoneSetpoint: (zoneId) => `/temperatureZone/${encodeURIComponent(zoneId)}/heatSetpoint`,
  dhwState: (dhwId) => `/domesticHotWater/${encodeURIComponent(dhwId)}/state`,
};

/** Evohome system modes (evohome-async SystemMode), the option values of the system-mode feature. */
export const SYSTEM_MODES = [
  'Auto',
  'AutoWithEco',
  'Away',
  'DayOff',
  'Custom',
  'HeatingOff',
  'AutoWithReset',
];

/** Evohome zone setpoint modes, and the hot water modes. */
export const SETPOINT_MODES = {
  FOLLOW: 'FollowSchedule',
  PERMANENT: 'PermanentOverride',
  TEMPORARY: 'TemporaryOverride',
};
export const DHW_STATES = { ON: 'On', OFF: 'Off' };

/**
 * Gladys values (server/utils/constants.js of the Gladys core, not exported by
 * the SDK).
 */
export const GLADYS = {
  ON: 1,
  OFF: 0,
  /** THERMOSTAT_MODE */
  THERMOSTAT_MODE: { OFF: 0, HEATING: 1 },
  /** WATER_HEATER_MODE */
  WATER_HEATER_MODE: { OFF: 0, BOOST: 3, MANUAL: 4, PROGRAM: 6 },
};

/** The zone setpoint after a change: for a while, or until changed again. */
export const OVERRIDE_MODES = ['temporary', 'permanent'];

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

export const SCENE_ACTIONS = {
  SET_SYSTEM_MODE: 'set_system_mode',
  SET_ZONE_SETPOINT: 'set_zone_setpoint',
  CLEAR_ZONE_OVERRIDE: 'clear_zone_override',
  SET_HOT_WATER: 'set_hot_water',
};

export const SCENE_TRIGGERS = {
  SYSTEM_MODE_CHANGED: 'system_mode_changed',
  FAULT_DETECTED: 'fault_detected',
  FAULT_CLEARED: 'fault_cleared',
};

/** Seconds. Home Assistant reads every 5 minutes and refuses less than 1 minute. */
export const POLL_INTERVAL = { min: 60, max: 3600, default: 300 };

/** Minutes. Evohome takes overrides by steps of 10 minutes, one day at most. */
export const DURATIONS = {
  override: { min: 10, max: 1440, default: 60 },
  boost: { min: 10, max: 1440, default: 60 },
};

export const LIMITS = {
  /** Gladys: 300 states per minute, 300 scene events per minute. */
  statesPerMinute: 300,
  sceneEventsPerMinute: 300,
  /** States per publishStates request. */
  statesPerRequest: 100,
  /** Largest answer read (the installation of a big house is a few dozen KB). */
  responseBytes: 4 * 1024 * 1024,
  /** Scene event strings (Gladys accepts 1000 characters). */
  eventText: 200,
  /** Events kept while Gladys is unreachable. */
  queuedEvents: 500,
};

export const TIMINGS = {
  requestTimeout: 30_000,
  /** The publisher sends what is pending every second. */
  flushInterval: 1_000,
  /** An unchanged state is sent again every 30 minutes. */
  stateHeartbeat: 30 * 60_000,
  /** Renew the access token this long before it expires (about 30 min; evohome-async: 15 s). */
  tokenMargin: 2 * 60_000,
  /** Pauses after a failed read: 1, 2, 5, 10 then 15 minutes. */
  backoff: [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000],
  /** After a 429 without Retry-After (one was seen with Retry-After: 3600). */
  rateLimitPause: 30 * 60_000,
  /** After a sign-in refused for too many attempts (`attempt_limit_exceeded`). */
  loginLimitPause: 60 * 60_000,
  forbiddenPause: 60 * 60_000,
  /** The installation (zones, hot water, allowed modes) is read again at most this often. */
  installationMaxAge: 24 * 60 * 60_000,
  /** A Scan from the Discovery tab reads the installation again at most this often. */
  scanCooldown: 10 * 60_000,
  /** A value just set wins over the readings that do not show it yet. */
  commandGuard: 2 * 60_000,
  /** A read soon after a command, to show its result. */
  afterCommand: 15_000,
  /** The "Test the connection" button reads the cloud at most this often. */
  testCooldown: 60_000,
};
