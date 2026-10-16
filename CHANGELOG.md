# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-16

### Added

- Total Connect Comfort account (the e-mail and password of the Evohome app,
  international portal): the session is kept in `/data` and renewed with its
  refresh token, so a restart does not sign in again; a refused password is
  reported and never retried on its own (Honeywell blocks accounts that
  insist).
- Choice of the location when the account has several (its name or number);
  "Test the connection" lists them.
- One device for the Evohome system: its mode (Auto, Economy, Away, Day off,
  Custom, Heating off, Auto with every zone reset, as the controller allows),
  the end of a temporary mode, the active faults.
- One device per heating zone: temperature, setpoint, heating on/off, setpoint
  mode (follow schedule, permanent or temporary override) and the end of the
  override, low battery, faults.
- One device for the hot water: tank temperature, on/off, mode (schedule, on,
  boost, off) and the end of the override, low battery, faults.
- Setpoints from Gladys held for a configurable time (60 minutes by default,
  then the schedule resumes) or until changed again; heating off holds a zone
  at its minimum; back to the schedule from the setpoint mode.
- Scene actions: set the system mode (permanently, for hours or for days),
  set a zone setpoint (for minutes or permanently), put a zone back on its
  schedule, set the hot water (on, off, schedule, for minutes or permanently).
- Scene triggers: system mode changed outside Gladys, fault detected, fault
  cleared.
- One status read every 5 minutes by default (1 minute minimum), only the
  values that changed sent to Gladys, pauses after errors and as long as
  Honeywell asks after a 429, cloud badges marked unreachable when the
  gateway loses its connection.
- Feature and mode names in French or English.

[Unreleased]: https://github.com/LM1LC3N7/gladys-evohome/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-evohome/releases/tag/v0.1.1
