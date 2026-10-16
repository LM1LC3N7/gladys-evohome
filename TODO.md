# TODO — Honeywell Evohome v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the claim is post #214 of /t/10385; the main session posts one recap there,
  with a link to each repo, once the batch is published.

## Status

- [x] **Milestone 1 — core** (2026-10-16): Total Connect Comfort international
      sign-in (OAuth password grant of the Evohome app, access and refresh
      tokens and user id kept in `/data`, refresh token first, a refused
      refresh falling back once to the password, one new token and one retry
      on a 401, refused password never retried by itself, 429 on sign-in = one
      hour pause), location chosen by name or number (first by default), the
      installation read at start, daily and on Scan (10 min cooldown), one
      status read per poll (300 s, 60–3600), backoff and Retry-After; devices
      for the system (mode select of the allowed modes, end of a temporary
      mode, faults), each zone (temperature, setpoint, thermostat mode
      off/heating, setpoint mode select, end of override, battery low, faults)
      and the hot water (probe temperature, water-heater binary and mode,
      end of override, battery low, faults); commands from the dashboard;
      scene actions `set_system_mode`, `set_zone_setpoint`,
      `clear_zone_override`, `set_hot_water`; scene triggers
      `system_mode_changed`, `fault_detected`, `fault_cleared`; badges
      (gateway lost = unreachable degraded); "Test the connection"; en/fr
      names; docs en/fr. Tested against fixtures adapted from evohome-async
      and Home Assistant only.
- [ ] **Milestone 2 — real account**: run against a real Evohome account
      and compare with the app (see "To check on a real account"); turn the
      answers (anonymized, evohome-async's PII rules) into fixtures; fix what
      differs.
- [ ] **Milestone 3 — more**: an "until the next switchpoint" override
      (what the controller and Home Assistant do: needs
      `GET temperatureZone/{id}/schedule`, cached a day per zone, one request
      per zone); the schedules as text and a scene action to copy one;
      higher-precision temperatures through the old v1 API (Home Assistant's
      `client_v1`: one more session and request per poll — only if users ask);
      several locations at once; the non-Evohome models of the same API
      (VisionPro, FocusPro: `Heat`/`Off`/`Cool` modes, fan) if anyone has one.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, GHCR package public (the main session does it).

## To check on a real account

- Sign-in: the password grant answer (`expires_in` ≈ 1799, `refresh_token`
  present), the refresh grant (is the refresh token rotated? how long does it
  live?), the answer to a wrong password (400 `invalid_grant`), the 429 of the
  token endpoint and whether it carries `Retry-After`.
- How many status reads per day an account can make before a 429: the
  default (300 s) is Home Assistant's; Home Assistant also reads every zone
  schedule at each refresh, so we are lighter.
- The PUT answers (201 and a comm task id, recorded by evohome-async) and
  how long the cloud takes to show the change (the guard is 2 minutes, the
  read 15 s after); whether a comm task should be awaited.
- `timeUntil` alignment: the zone override end is rounded up to 10 minutes,
  the Eco end to the hour, the Away/Day off/Custom end is local midnight;
  check the controller shows the same end.
- `AutoWithReset`: is it echoed as `Auto` in the status, and are the zones
  back to `FollowSchedule` at once?
- Fault `since` (local time of the location without offset): compare with
  the app for a battery fault; `currentOffsetMinutes` across a daylight saving
  change.
- Hot water: `TemporaryOverride` with `untilTime`, the status `until`, the
  state when the system goes Away or Heating off (the controller turns it
  off).
- A zone without sensor (`isAvailable: false`) and a zone whose actuator lost
  its link: what the app shows.
- `tccna.resideo.com` answers to node:https with our User-Agent (no WAF
  surprise as with Toshiba).

## Decisions

- **Not a duplicate** (checked 2026-10-16):
  - Gladys core master `165e0d94` (2026-10-16): `git grep -i
'evohome|resideo|honeywell|total connect|tccna'` finds nothing in
    `server/` or `front/src`; the core `thermostat` service is a virtual
    thermostat (schedules driving heaters and sensors), not a Honeywell
    client. Evohome is not Matter.
  - Store index (live, 433 entries, 2026-10-16T11:15Z) and `rejected.json`:
    no Evohome. Honeywell entries: guim31/gladys-honeywell-tcc 1.0.1 and
    guim31/gladys-honeywell-lyric 1.0.1. Tracker row #245 "Honeywell Evohome
    (Total Connect Comfort Europe)" was free; claimed in /t/10385 #214.
  - **Who should use which** (their READMEs and code, 2026-10-16):
    gladys-honeywell-tcc talks to the US/Canada portal
    `mytotalconnectcomfort.com` (browser-style form login and cookie,
    RTH6580WF/RTH8580WF/RTH9580WF/TH6320WF/TH8320WF/VisionPRO Wi-Fi) and says
    the European Evohome portal is another one; gladys-honeywell-lyric talks
    to the Resideo developer API `api.honeywellhome.com` (OAuth with the
    user's own developer key, Lyric Round, T5, T6, T9, T10) and lists
    "Total Connect Comfort and evohome systems" as not covered. This module:
    Evohome / Evotouch / Round Wireless + RFG100 owners of the international
    TCC (Evohome app, Europe and UK), `tccna.resideo.com` v2 API. No overlap;
    the docs carry a "which Honeywell integration?" table.
- **Own client, no dependency** (Louis's rule: reuse maintained work,
  rewrite dead or debt-heavy code). The candidates, 2026-10-16:
  - `@svrooij/evohome` 1.0.2 (2020, MIT), `node-evohome-client` 0.0.3
    (2020), `evohome` 0.0.3 (2014): the only importable libraries, dead, on
    the old v1 session API or the old `tccna.honeywell.com` host, which no
    longer resolves (checked 2026-10-16), with node-fetch v2 or moment.
  - `node-red-contrib-evohome` 1.3.6 (2026-02, ISC): a Node-RED node on
    `request`, `q`, `lodash`; `npm audit`: 6 vulnerabilities, 2 critical.
  - `homebridge-evohome` 1.0.2 (2026-09, ISC, active, 0 open issue): the only
    good modern client (EMEA v2 on tccna.resideo.com), but embedded in a
    Homebridge plugin: its `exports` only expose the plugin, and a default
    install is 256 MB (an optional dependency pulls googleapis). Forks
    (`@jdegouw/homebridge-evohome`, `homebridge-evohome-modern`,
    `homebridge-evohome-kharms`) are older copies on request/axios/moment.
  - `evohome-async` 3.0.0 (Python, 2026-10-10, Apache-2.0, very active, the
    library of Home Assistant): the reference, read as protocol documentation
    together with the Home Assistant integration (Apache-2.0) and, for one
    point (HTTP 200 answers carrying an OAuth error), homebridge-evohome
    (ISC, no LICENSE file: read only). No code copied; the test fixtures are
    adapted from the recorded answers of evohome-async and Home Assistant
    (Apache-2.0, noted in `test/fixtures/evohome.js`). ~250 lines of client on
    `node:https`; runtime dependencies: the SDK only.
- **Host and protocol** as evohome-async 3.0.0: `POST
https://tccna.resideo.com/Auth/OAuth/Token` with the Evohome app's Basic
  header, form `grant_type`/`scope=EMEA-V1-Basic EMEA-V1-Anonymous` and
  `Username`/`Password` (case-sensitive); API under `/WebAPI/emea/api/v1`
  (`userAccount`, `location/installationInfo?userId=…&includeTemperatureControlSystems=True`,
  `location/{id}/status?includeTemperatureControlSystems=True`); PUT bodies
  `{systemMode, permanent, timeUntil}`, `{setpointMode, heatSetpointValue,
timeUntil}`, `{mode, state, untilTime}` (untilTime for the hot water only);
  dates sent as UTC `YYYY-MM-DDTHH:MM:SSZ`.
- **Rate limits**: Honeywell publishes none. Home Assistant reads every 300 s
  (60 s minimum) and adds every zone schedule at each refresh; a Homebridge
  user got `Retry-After: 3600` and a longer lockout for ignoring it. Here:
  one status request per poll, 300 s default, 60 s minimum, the installation
  once a day, Retry-After honoured (30 min without it), one hour after an
  `attempt_limit_exceeded`, tokens kept so restarts do not sign in, a refused
  password never retried by itself (Toshiba lesson).
- **Session**: the access token (~30 min) is used until 2 minutes before its
  end, then renewed with the refresh token (evohome-async renews 15 s
  before; our polls are minutes apart). A refresh token refused with 400
  falls back to the password once, like evohome-async. Kept in
  `/data/evohome-state.json` (mode 600) with a hash of the e-mail and the user
  id (saves the `userAccount` request at each start).
- **System mode = `text`/`select`** with the Evohome names as values
  (`Auto`, `AutoWithEco`, `Away`, `DayOff`, `Custom`, `HeatingOff`,
  `AutoWithReset`), only the modes the controller allows: THERMOSTAT_PRESET
  (schedule, frost, away, eco, night, comfort) cannot say Day off or Custom,
  and the Gladys doc keeps `select` for lists no generic value set describes.
  `AutoWithReset` reads back as `Auto`.
- **Zone**: `temperature-sensor/decimal`, `thermostat/target-temperature`
  (min/max/resolution of the zone), `thermostat/mode` OFF/HEATING
  (THERMOSTAT_MODE: off = permanent override at the minimum, heating =
  FollowSchedule, as Home Assistant's hvac modes; reads off when the system
  is HeatingOff or the zone is held at its minimum), setpoint mode as
  `text/select` (`FollowSchedule`, `PermanentOverride`, `TemporaryOverride`:
  no generic value set).
- **Setpoint from Gladys**: temporary for a configurable duration (60 min by
  default, rounded up to the 10-minute resolution, one day at most) or
  permanent. Home Assistant holds it until the next switchpoint, which needs
  the zone schedules (one request per zone): milestone 3.
- **Hot water**: `temperature-sensor/probe` (kept out of the room average),
  `water-heater/binary` (on/off = permanent override, Home Assistant's
  turn_on/turn_off) and `water-heater/mode` (WATER_HEATER_MODE: PROGRAM =
  FollowSchedule, MANUAL = permanent on, BOOST = temporary on for the
  configured time, OFF = off override, permanent or temporary).
- **Faults**: `input/binary` "Fault", `text` "Active faults" (the fault
  types), `battery-low/binary` on zones and hot water (any `*LowBattery`
  fault); the gateway faults count as the system's; `GatewayCommunicationLost`
  turns every badge `unreachable` degraded. Fault `since` is the local time
  of the location without offset (evohome-async): converted with the
  location's `currentOffsetMinutes` (installation re-read daily).
- **Events**: `system_mode_changed` and `fault_detected`/`fault_cleared`
  from two readings; the first reading is history; a change commanded from
  Gladys is shown at once (guard 2 minutes) so it never fires (no scene
  loops).
- **One location** (Home Assistant's `location_idx`): the first, or the one
  named in the configuration; evohome-async warns that several locations
  multiply the requests.
- **Scene actions resolve `{ until }`** (ISO UTC, empty when permanent) for
  the next actions of a scene; errors come back in the language of the
  configuration.
