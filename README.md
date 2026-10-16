# gladys-evohome

[Gladys Assistant](https://gladysassistant.com) external integration for
**Honeywell / Resideo Evohome** heating systems, through the **international
Total Connect Comfort** cloud (the one of the Evohome app, Europe and the UK).
Each heating zone with its temperature, setpoint, heating on/off and setpoint
mode (follow schedule, permanent or temporary override), the system mode
(Auto, Economy, Away, Day off, Custom, Heating off), the hot water (on, off,
boost, schedule), the faults and low batteries, scene actions to set them and
scene triggers on mode changes and faults. Unofficial, not affiliated with
Honeywell or Resideo.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress (0.1, not published to the store yet).** Tested with
> answers adapted from the recorded ones of evohome-async and Home Assistant,
> not yet with a real Evohome system. Feedback and bug reports are welcome in
> the [GitHub issues](https://github.com/LM1LC3N7/gladys-evohome/issues).

**Which Honeywell integration?** Evohome, Evotouch, Round Wireless with
RFG100 in the Evohome app (international.mytotalconnectcomfort.com): this one.
US and Canada Wi-Fi thermostats of mytotalconnectcomfort.com:
[guim31/gladys-honeywell-tcc](https://github.com/guim31/gladys-honeywell-tcc).
Lyric and T-series thermostats of the Honeywell Home app:
[guim31/gladys-honeywell-lyric](https://github.com/guim31/gladys-honeywell-lyric).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (EvohomeApp) ⇄ src/client.js ⇄ src/evohome.js ⇄ tccna.resideo.com
                                   ├─ src/inventory.js  installation and status -> plain objects (pure)
                                   ├─ src/devices.js    -> Gladys devices and states (pure)
                                   ├─ src/events.js     two readings -> scene events (pure)
                                   ├─ src/publisher.js  300 states/min, scene events queued
                                   └─ src/store.js      session and user id (/data)
```

- **Account**: e-mail and password of the Evohome app (`secret` field).
  `POST /Auth/OAuth/Token` with the app's client id (password grant, scope
  `EMEA-V1-Basic EMEA-V1-Anonymous`) returns an access token (~30 minutes)
  and a refresh token. Both are kept in `/data` with the user id, so a
  restart does not sign in again; the access token is renewed with the
  refresh token, a refused refresh falls back once to the password, and a 401
  gets one new token and one retry. A refused password is never retried by
  itself (it waits for a configuration change or the "Test the connection"
  button).
- **Reading**: the installation (`location/installationInfo`: systems,
  zones, hot water, allowed modes and ranges) at start-up, once a day and on
  Scan; then one `location/{id}/status` per poll (300 s by default, 60 to
  3600). Errors back off 1, 2, 5, 10 then 15 minutes; a 429 waits for
  `Retry-After` (30 minutes otherwise), a sign-in 429
  (`attempt_limit_exceeded`) an hour.
- **Devices**: `ext:<selector>:system:<id>`, `ext:<selector>:zone:<id>` and
  `ext:<selector>:dhw:<id>`, the ids of the cloud. The location followed is
  the first one, or the one named in the configuration.
- **Commands**: `PUT temperatureControlSystem/{id}/mode`
  `{systemMode, permanent, timeUntil}`, `PUT temperatureZone/{id}/heatSetpoint`
  `{setpointMode, heatSetpointValue, timeUntil}`, `PUT
domesticHotWater/{id}/state` `{mode, state, untilTime}`. A value just set
  wins over the readings for 2 minutes, and one read follows 15 s later.
- **States**: through `publishChangedStates` (only what changed, every 30
  minutes otherwise). Scene events (`system_mode_changed`, `fault_detected`,
  `fault_cleared`) are queued and all sent; the first reading fires nothing,
  and a change made from Gladys never fires.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/evohome.js` holds installation and status answers adapted from
the recorded ones of evohome-async and Home Assistant (with their faults,
overrides and a second location); `test/helpers/fakeEvohome.js` serves them
behind the transport, token endpoint and commands included, with the error
answers the evohome-async tests recorded against the real server. The
transport itself is tested against a loopback HTTP server.

## Credits

No maintained JavaScript library of the Evohome API exists (see
[TODO.md](TODO.md), Decisions): the client is our own, written from the
behaviour documented by these projects, read as documentation (no code
copied):

- [evohome-async](https://github.com/zxdavb/evohome-async) (Apache-2.0,
  David Bonnes), the library of the Home Assistant integration: host, token
  requests, endpoints, PUT bodies, enums, date formats, the error answers
  recorded against the real server. The test fixtures are adapted from its
  recorded answers (`tests/tests/fixtures_v2`).
- The Home Assistant [`evohome`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/evohome)
  integration (Apache-2.0): polling pace, the mapping of modes, presets and
  hot water, the scene services, test fixtures (`sys_006`: faults, several
  locations).
- [homebridge-evohome](https://github.com/luc-ass/homebridge-evohome) (ISC):
  the token endpoint answering 200 with an OAuth error, a real
  `Retry-After: 3600`.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release only.

## License

Apache-2.0. Honeywell, Resideo, Evohome and Total Connect Comfort are
trademarks of their owners; this project is not affiliated with Honeywell or
Resideo.
