# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency (HTTPS goes through `node:https`). It signs in to the
international Total Connect Comfort cloud (the one of the Evohome app) with
the e-mail and password of the app, reads the installation of one location
(system, zones, hot water) and its status once per poll, turns them into
Gladys devices and states, sets the system mode, the zone setpoints and the
hot water from the dashboard and the scenes, and fires scene events on mode
changes and faults. Unofficial, not affiliated with Honeywell or Resideo.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          EvohomeApp: poll loop, failures and pauses, devices, states,
                    scene events, commands, scene actions, badges, test button
src/client.js       the account: OAuth session (refresh token, one retry on 401),
                    the calls and the PUT bodies
src/evohome.js      the only network access (node:https, settles once), errors
src/inventory.js    installation and status answers -> plain objects (pure)
src/devices.js      -> Gladys devices and states (pure)
src/events.js       two readings -> scene events (pure)
src/publisher.js    states within 300/min, scene events queued
src/store.js        /data/evohome-state.json: session and user id
src/config.js       config_schema normalized, account key (hash of the e-mail)
src/constants.js    API host and paths, Evohome and Gladys values, keys, limits
src/i18n.js         runtime texts, device, feature and option names (en/fr)
test/fixtures/      answers adapted from evohome-async and Home Assistant tests
test/helpers/       a fake Total Connect Comfort behind the transport
```

## Rules

- **External ids are forever**: device = `system:<id>`, `zone:<id>`,
  `dhw:<id>` (the ids of the cloud), feature = `<device>:<role>` (`mode`,
  `mode-until`, `temperature`, `setpoint`, `heating-mode`, `setpoint-mode`,
  `override-until`, `state`, `battery-low`, `fault`, `faults`). Never change
  how they are built.
- Manifest keys (`email`, `password`, `location`, `override_mode`,
  `override_duration`, `dhw_boost_duration`, `poll_interval`, `language`,
  `test_connection`, the scene actions and triggers with their fields,
  variables and outputs) and the option values (the Evohome system and
  setpoint mode names) are frozen: users store them in devices and scenes.
- Value conventions: the Evohome side is the API's (PascalCase names, dates
  UTC with "Z" except the fault `since`, local); the Gladys side the enums of
  the core `server/utils/constants.js` (THERMOSTAT_MODE, WATER_HEATER_MODE,
  binary 1 = on). The SDK exports the categories, types and units, not the
  values: they are in `src/constants.js`.
- **Never sign in again by itself after a refused password**, never poll
  faster than once a minute, honour Retry-After: Honeywell locks accounts.
  Never log or put in a status message the password or the tokens. Never add
  a call outside `EvohomeClient`.
- Scene events go through `publisher.pushSceneEvent`; never fire one for a
  change commanded from Gladys (scene loops): `commanded()` updates the
  snapshot without events.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network. Gladys rate limits: 300 states/min, 300 scene
  events/min.
- Tests never touch the network: the transport is injected
  (`test/evohome.test.js` uses a loopback server for the real one).
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
