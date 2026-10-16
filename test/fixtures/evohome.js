// -----------------------------------------------------------------------------
// Total Connect Comfort answers for the tests, adapted from the answers
// recorded in the tests of evohome-async (tests/tests/fixtures/default and
// system_002, Apache-2.0, © David Bonnes) and of the Home Assistant evohome
// integration (tests/components/evohome/fixtures/default and sys_006,
// Apache-2.0, © the Home Assistant authors): same shapes and key names,
// fewer zones, ids and names kept or made up, fault and override cases
// combined from both. Built fresh on each call: the tests change them.
// -----------------------------------------------------------------------------

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
/** 2026-10-16T10:00:00Z, a Friday. */
export const NOW = Date.UTC(2026, 9, 16, 10, 0, 0);

export const EMAIL = 'user@example.com';
export const PASSWORD = 'pa$$word';
export const USER_ID = '2512649';

export const LOCATION = '2738909';
export const GATEWAY = '2499896';
export const SYSTEM = '3432522';
export const ZONES = { LIVING: '3432576', KITCHEN: '3432578', BEDROOM: '3432580' };
export const DHW = '3933910';
export const OTHER_LOCATION = '0002001';
export const OTHER_SYSTEM = '0002003';

export const userAccount = () => ({
  userId: USER_ID,
  username: EMAIL,
  firstname: 'John',
  lastname: 'Smith',
  streetAddress: '1 Main Street',
  city: 'London',
  postcode: 'E1 1AA',
  country: 'UnitedKingdom',
  language: 'enGB',
});

const zoneCaps = () => ({
  maxHeatSetpoint: 35.0,
  minHeatSetpoint: 5.0,
  valueResolution: 0.5,
  canControlHeat: true,
  canControlCool: false,
  allowedSetpointModes: ['PermanentOverride', 'FollowSchedule', 'TemporaryOverride'],
  maxDuration: '1.00:00:00',
  timingResolution: '00:10:00',
});

const scheduleCaps = () => ({
  maxSwitchpointsPerDay: 6,
  minSwitchpointsPerDay: 1,
  timingResolution: '00:10:00',
  setpointValueResolution: 0.5,
});

const zone = (zoneId, name) => ({
  zoneId,
  modelType: 'HeatingZone',
  setpointCapabilities: zoneCaps(),
  scheduleCapabilities: scheduleCaps(),
  name,
  zoneType: 'RadiatorZone',
});

/** The allowedSystemModes of an EvoTouch controller (evohome-async default). */
export const allowedSystemModes = () => [
  { systemMode: 'HeatingOff', canBePermanent: true, canBeTemporary: false },
  { systemMode: 'Auto', canBePermanent: true, canBeTemporary: false },
  { systemMode: 'AutoWithReset', canBePermanent: true, canBeTemporary: false },
  {
    systemMode: 'AutoWithEco',
    canBePermanent: true,
    canBeTemporary: true,
    maxDuration: '1.00:00:00',
    timingResolution: '01:00:00',
    timingMode: 'Duration',
  },
  {
    systemMode: 'Away',
    canBePermanent: true,
    canBeTemporary: true,
    maxDuration: '99.00:00:00',
    timingResolution: '1.00:00:00',
    timingMode: 'Period',
  },
  {
    systemMode: 'DayOff',
    canBePermanent: true,
    canBeTemporary: true,
    maxDuration: '99.00:00:00',
    timingResolution: '1.00:00:00',
    timingMode: 'Period',
  },
  {
    systemMode: 'Custom',
    canBePermanent: true,
    canBeTemporary: true,
    maxDuration: '99.00:00:00',
    timingResolution: '1.00:00:00',
    timingMode: 'Period',
  },
];

const locationInfo = (locationId, name) => ({
  locationId,
  name,
  streetAddress: '45 Main Crescent',
  city: 'London',
  country: 'UnitedKingdom',
  postcode: 'E1 2AA',
  locationType: 'Residential',
  useDaylightSaveSwitching: true,
  timeZone: {
    timeZoneId: 'GMTStandardTime',
    displayName: '(UTC+00:00) Dublin, Edinburgh, Lisbon, London',
    offsetMinutes: 0,
    currentOffsetMinutes: 60,
    supportsDaylightSaving: true,
  },
  locationOwner: {
    userId: USER_ID,
    username: EMAIL,
    firstname: 'John',
    lastname: 'Smith',
  },
});

/** location/installationInfo: "My Home" (3 zones and hot water), and "Holiday Home" when asked. */
export function installation({ second = false } = {}) {
  const locations = [
    {
      locationInfo: locationInfo(LOCATION, 'My Home'),
      gateways: [
        {
          gatewayInfo: { gatewayId: GATEWAY, mac: '00D02DEE4E56', crc: '1234', isWiFi: false },
          temperatureControlSystems: [
            {
              systemId: SYSTEM,
              modelType: 'EvoTouch',
              zones: [
                zone(ZONES.LIVING, 'Main Room'),
                zone(ZONES.KITCHEN, 'Kitchen'),
                zone(ZONES.BEDROOM, 'Main Bedroom'),
              ],
              allowedSystemModes: allowedSystemModes(),
              dhw: {
                dhwId: DHW,
                dhwStateCapabilitiesResponse: {
                  allowedStates: ['On', 'Off'],
                  allowedModes: ['FollowSchedule', 'PermanentOverride', 'TemporaryOverride'],
                  maxDuration: '1.00:00:00',
                  timingResolution: '00:10:00',
                },
                scheduleCapabilitiesResponse: {
                  maxSwitchpointsPerDay: 6,
                  minSwitchpointsPerDay: 1,
                  timingResolution: '00:10:00',
                },
              },
            },
          ],
        },
      ],
    },
  ];
  if (second) {
    // Home Assistant sys_006: a second location, three modes, no hot water.
    locations.push({
      locationInfo: locationInfo(OTHER_LOCATION, 'Holiday Home'),
      gateways: [
        {
          gatewayInfo: { gatewayId: '0002002', mac: '00D02D000002', crc: '0002', isWiFi: false },
          temperatureControlSystems: [
            {
              systemId: OTHER_SYSTEM,
              modelType: 'EvoTouch',
              zones: [{ ...zone('0002004', 'Lounge'), zoneType: 'ZoneTemperatureControl' }],
              allowedSystemModes: allowedSystemModes().filter((m) =>
                ['Auto', 'AutoWithEco', 'Away'].includes(m.systemMode),
              ),
            },
          ],
        },
      ],
    });
  }
  return locations;
}

const zoneStatus = (zoneId, name, temperature, target, mode = 'FollowSchedule', until) => ({
  zoneId,
  temperatureStatus:
    temperature === undefined ? { isAvailable: false } : { temperature, isAvailable: true },
  activeFaults: [],
  setpointStatus: {
    targetHeatTemperature: target,
    setpointMode: mode,
    ...(until ? { until } : {}),
  },
  name,
});

/** location/{id}/status of "My Home": Auto, the bedroom held until 22:10, the hot water on. */
export function status() {
  return {
    locationId: LOCATION,
    gateways: [
      {
        gatewayId: GATEWAY,
        temperatureControlSystems: [
          {
            systemId: SYSTEM,
            zones: [
              zoneStatus(ZONES.LIVING, 'Main Room', 19.5, 20.0),
              zoneStatus(ZONES.KITCHEN, 'Kitchen', 20.0, 17.0),
              zoneStatus(
                ZONES.BEDROOM,
                'Main Bedroom',
                21.0,
                20.5,
                'TemporaryOverride',
                '2026-10-16T22:10:00Z',
              ),
            ],
            dhw: {
              dhwId: DHW,
              temperatureStatus: { temperature: 45.5, isAvailable: true },
              stateStatus: { state: 'On', mode: 'FollowSchedule' },
              activeFaults: [],
            },
            activeFaults: [],
            systemModeStatus: { mode: 'Auto', isPermanent: true },
          },
        ],
        activeFaults: [],
      },
    ],
  };
}

/** The status of the second location. */
export function otherStatus() {
  return {
    locationId: OTHER_LOCATION,
    gateways: [
      {
        gatewayId: '0002002',
        temperatureControlSystems: [
          {
            systemId: OTHER_SYSTEM,
            zones: [zoneStatus('0002004', 'Lounge', 12.5, 10.0, 'PermanentOverride')],
            activeFaults: [],
            systemModeStatus: { mode: 'Away', isPermanent: true },
          },
        ],
        activeFaults: [],
      },
    ],
  };
}

/** The faults of Home Assistant sys_006, on "My Home". */
export function withFaults(data = status()) {
  const [gateway] = data.gateways;
  const [tcs] = gateway.temperatureControlSystems;
  tcs.zones[0].activeFaults = [
    { faultType: 'TempZoneActuatorLowBattery', since: '2026-10-16T09:45:00' },
  ];
  tcs.zones[1].activeFaults = [
    { faultType: 'TempZoneSensorCommunicationLost', since: '2026-10-16T09:50:00' },
  ];
  tcs.zones[1].temperatureStatus = { isAvailable: false };
  tcs.dhw.activeFaults = [{ faultType: 'DHWSensorFailure', since: '2026-10-16T09:55:00' }];
  tcs.activeFaults = [{ faultType: 'BoilerCommunicationLost', since: '2026-10-16T09:40:00' }];
  return data;
}

/** The gateway lost the cloud (Home Assistant sys_006). */
export function gatewayLost(data = status()) {
  data.gateways[0].activeFaults = [
    { faultType: 'GatewayCommunicationLost', since: '2026-10-16T09:30:00' },
  ];
  return data;
}

export const systemOf = (data) => data.gateways[0].temperatureControlSystems[0];
export const zoneOf = (data, zoneId) => systemOf(data).zones.find((z) => z.zoneId === zoneId);
