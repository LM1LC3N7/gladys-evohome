// -----------------------------------------------------------------------------
// The integration: the Total Connect Comfort account (e-mail and password),
// the installation of the chosen location read once (systems, zones, hot
// water, allowed modes), its status read once per poll, the Gladys devices and
// their states, the scene events (mode changes, faults), the commands (system
// mode, zone setpoints, hot water) from the dashboard and the scenes, and the
// transport badges. index.js only wires the SDK handlers to it.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { EvohomeClient } from './client.js';
import { normalizeConfig } from './config.js';
import { DHW_STATES, GLADYS, LIMITS, SETPOINT_MODES, SYSTEM_MODES, TIMINGS } from './constants.js';
import {
  buildDevices,
  dhwIds,
  dhwName,
  dhwStates,
  parseExternalId,
  systemIds,
  systemName,
  systemStates,
  zoneIds,
  zoneName,
  zoneStates,
} from './devices.js';
import { errorReason } from './evohome.js';
import { faultEvents, modeEvent } from './events.js';
import { SYSTEM_MODE_NAMES, T, age, word } from './i18n.js';
import {
  chooseLocation,
  overrideUntil,
  readInstallation,
  readStatus,
  systemUntil,
} from './inventory.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';

const cut = (text, max = LIMITS.eventText) => (text.length > max ? text.slice(0, max) : text);

/** Errors after which only a change of the configuration (or the test button) helps. */
const REFUSED = new Set(['refused', 'no_credentials']);
/** Errors meaning the cloud did not answer usefully: the devices are unreachable. */
const OFFLINE = new Set(['network', 'timeout', 'unavailable', 'bad_response', 'size', 'http']);

/** An error shown as such in the ack of a command or a scene action. */
const userError = (texts, language) => new Error(word(texts, language));

export class EvohomeApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'evohome' }),
    transport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
    userAgent,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = new EvohomeClient({
      transport,
      now,
      userAgent,
      onSession: (session) => this.saveSession(session),
    });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null);
    /** Every location of the account (readInstallation), undefined before the first read. */
    this.locations = undefined;
    /** The location followed. */
    this.location = undefined;
    this.installationAt = undefined;
    /** The last status read (readStatus) and when. */
    this.status = undefined;
    this.readAt = undefined;
    /** Snapshot of the previous status, for the events. */
    this.previous = undefined;
    /** featureId -> { value, until }: a value just set, not read back yet */
    this.guards = new Map();
    this.published = undefined;
    /** deviceId -> badge last published (JSON) */
    this.transports = new Map();
    this.timer = undefined;
    this.soonTimer = undefined;
    this.running = undefined;
    this.generation = 0;
    this.refused = false;
    this.misconfigured = false;
    this.offline = false;
    this.connectedOnce = false;
    this.failures = 0;
    this.pausedUntil = 0;
    this.lastTestAt = -Infinity;
    this.lastScanAt = -Infinity;
    this.started = false;
    this.lastStatus = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.reset();
    this.memory = normalizeMemory(await this.store.load().catch(() => null));
    const { email, password, account } = this.config;
    const session = this.memory.session?.account === account ? this.memory.session : null;
    this.client.configure({ email, password, session });
    this.publisher.start();
    if (!this.client.hasCredentials) {
      await this.setStatus(false, T.noCredentials);
      return;
    }
    await this.setStatus(false, T.connecting);
    this.schedule();
    await this.tick();
  }

  stop() {
    this.generation += 1;
    if (this.timer) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.soonTimer) {
      this.timers.clearTimeout(this.soonTimer);
      this.soonTimer = undefined;
    }
    this.publisher.stop();
  }

  /** Forgets the account and the failures: a new account, or a restart. */
  reset() {
    this.locations = undefined;
    this.location = undefined;
    this.installationAt = undefined;
    this.status = undefined;
    this.readAt = undefined;
    this.previous = undefined;
    this.guards.clear();
    this.published = undefined;
    this.transports.clear();
    this.refused = false;
    this.misconfigured = false;
    this.offline = false;
    this.connectedOnce = false;
    this.failures = 0;
    this.pausedUntil = 0;
  }

  schedule() {
    if (this.timer) {
      this.timers.clearInterval(this.timer);
    }
    this.timer = this.timers.setInterval(() => {
      this.tick().catch((err) => this.logger.error(`Evohome refresh failed: ${err.message}`));
    }, this.config.pollInterval * 1000);
  }

  /** One read soon after commands, to show their result (several commands, one read). */
  soon() {
    if (this.soonTimer) {
      this.timers.clearTimeout(this.soonTimer);
    }
    this.soonTimer = this.timers.setTimeout(() => {
      this.soonTimer = undefined;
      this.tick().catch((err) => this.logger.error(`Evohome refresh failed: ${err.message}`));
    }, TIMINGS.afterCommand);
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (Discovery list,
   * status, badges) without reading the cloud again.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.transports.clear();
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    await this.publishAllTransports();
  }

  /** A new account or location restarts; a new interval reschedules; a new language renames. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (
      next.email !== previous.email ||
      next.password !== previous.password ||
      next.location !== previous.location
    ) {
      return this.start(raw);
    }
    this.config = next;
    if (next.pollInterval !== previous.pollInterval && this.timer) {
      this.schedule();
    }
    if (next.language !== previous.language) {
      await this.publishDevices();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async saveSession(session) {
    this.memory.session = session ? { account: this.config.account, ...session } : null;
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the session to /data failed: ${err.message}`));
  }

  // --- Polling ---------------------------------------------------------------

  /** One run at a time: a tick during a run joins it. */
  tick(options) {
    if (!this.running) {
      this.running = this.run(options).finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  async run({ installation = false } = {}) {
    const generation = this.generation;
    if (
      !this.client.hasCredentials ||
      this.refused ||
      this.misconfigured ||
      this.now() < this.pausedUntil
    ) {
      return;
    }
    try {
      const stale =
        this.installationAt === undefined ||
        this.now() - this.installationAt >= TIMINGS.installationMaxAge;
      if (installation || stale) {
        await this.readInstallation(generation);
      }
      if (generation !== this.generation || !this.location) {
        return;
      }
      const raw = await this.client.locationStatus(this.location.id);
      if (generation !== this.generation) {
        return;
      }
      this.apply(readStatus(raw, this.location.offsetMinutes));
      this.failures = 0;
      this.offline = false;
      this.connectedOnce = true;
      await this.setStatus(true, this.statusMessage());
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.failed(err);
    }
    await this.publishAllTransports();
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  /** The user, the installation of every location, the location followed. */
  async readInstallation(generation) {
    let userId = this.client.session?.userId;
    if (!userId) {
      userId = await this.client.userId();
    }
    const locations = readInstallation(await this.client.installation(userId));
    if (generation !== this.generation) {
      return;
    }
    this.locations = locations;
    this.installationAt = this.now();
    const location = chooseLocation(locations, this.config.location);
    if (!location) {
      this.location = undefined;
      this.misconfigured = true;
      const names = locations.map((l) => `${l.name} (${l.id})`).join(', ');
      const message =
        locations.length === 0 ? T.noLocation : T.unknownLocation(this.config.location, names);
      this.logger.warn(word(message, 'en'));
      await this.setStatus(false, message);
      return;
    }
    if (this.location && this.location.id !== location.id) {
      this.previous = undefined;
    }
    this.location = location;
    await this.publishDevices();
  }

  counts() {
    const systems = this.location?.systems ?? [];
    return {
      zones: systems.reduce((n, s) => n + s.zones.length, 0),
      dhw: systems.some((s) => s.dhw),
    };
  }

  statusMessage() {
    return T.connected(this.location.name, this.counts(), (this.locations?.length ?? 1) - 1);
  }

  async failed(err) {
    const reason = errorReason(err);
    if (err.kind === 'unauthorized' || err.kind === 'not_found') {
      // A location removed or no longer shared (evohome-async StaleConfigError): read it again.
      this.installationAt = undefined;
    }
    if (REFUSED.has(err.kind)) {
      // Never signed in again by itself: Honeywell locks accounts that insist.
      this.refused = true;
      this.offline = true;
      this.logger.warn(`Total Connect Comfort refused the sign-in: ${reason}`);
      await this.setStatus(false, this.connectedOnce ? T.expired : T.refused);
      return;
    }
    let wait;
    if (err.kind === 'rate_limited' && err.login) {
      wait = Math.max(err.retryAfter ?? TIMINGS.loginLimitPause, TIMINGS.backoff[0]);
      this.offline = true;
      await this.setStatus(false, T.loginLimited(age(wait)));
    } else if (err.kind === 'rate_limited') {
      wait = Math.max(err.retryAfter ?? TIMINGS.rateLimitPause, TIMINGS.backoff[0]);
      await this.setStatus(this.connectedOnce, T.rateLimited(age(wait)));
    } else if (err.kind === 'forbidden') {
      wait = TIMINGS.forbiddenPause;
      this.offline = true;
      await this.setStatus(false, T.forbidden(age(wait)));
    } else {
      wait = TIMINGS.backoff[Math.min(this.failures, TIMINGS.backoff.length - 1)];
      this.offline = OFFLINE.has(err.kind) || this.offline;
      await this.setStatus(false, T.unreachable(reason, age(wait)));
    }
    this.failures += 1;
    this.pausedUntil = this.now() + wait;
    this.logger.warn(`Evohome: ${reason}; next try in ${Math.round(wait / 1000)} s`);
  }

  /** A status read (or the last one, with a command just sent: `fire` false). */
  apply(status, { fire = true } = {}) {
    this.status = this.guarded(status);
    if (fire) {
      this.readAt = this.now();
    }
    this.queueStates();
    this.queueEvents(fire);
  }

  // --- Gladys ----------------------------------------------------------------

  async publishDevices() {
    if (!this.location) {
      return;
    }
    const devices = buildDevices(this.gladys, this.location, this.config.language);
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  /** Every device of the location, with its status: [{ kind, entity, system, ids, status }]. */
  entries(status = this.status) {
    const list = [];
    for (const system of this.location?.systems ?? []) {
      list.push({
        kind: 'system',
        entity: system,
        system,
        ids: systemIds(this.gladys, system.id),
        status: status?.systems.get(system.id),
      });
      for (const zone of system.zones) {
        list.push({
          kind: 'zone',
          entity: zone,
          system,
          ids: zoneIds(this.gladys, zone.id),
          status: status?.zones.get(zone.id),
        });
      }
      if (system.dhw) {
        list.push({
          kind: 'dhw',
          entity: system.dhw,
          system,
          ids: dhwIds(this.gladys, system.dhw.id),
          status: status?.dhws.get(system.dhw.id),
        });
      }
    }
    return list;
  }

  nameOf({ kind, entity }) {
    const language = this.config.language;
    if (kind === 'system') {
      return systemName(entity, language);
    }
    return kind === 'zone' ? zoneName(entity, language) : dhwName(entity, language);
  }

  /**
   * The status with the values just commanded, until a reading shows them (the
   * cloud takes a little while to report a change made through it).
   */
  guarded(status) {
    const now = this.now();
    for (const [key, guard] of this.guards) {
      const [kind, id] = key.split(':');
      const map = { system: status.systems, zone: status.zones, dhw: status.dhws }[kind];
      const current = map?.get(id);
      if (!current || now >= guard.until) {
        this.guards.delete(key);
        continue;
      }
      const shown = Object.entries(guard.values).every(([k, v]) => current[k] === v);
      if (shown) {
        this.guards.delete(key);
      } else {
        map.set(id, { ...current, ...guard.values });
      }
    }
    return status;
  }

  guard(kind, id, values) {
    this.guards.set(`${kind}:${id}`, { values, until: this.now() + TIMINGS.commandGuard });
  }

  statesOf({ kind, entity, ids, status }, systemMode) {
    if (kind === 'system') {
      return systemStates(ids, status);
    }
    return kind === 'zone' ? zoneStates(ids, entity, status, systemMode) : dhwStates(ids, status);
  }

  /** The states of the created features (publishChangedStates drops the unchanged ones). */
  queueStates(created = this.createdFeatures()) {
    if (!this.status) {
      return;
    }
    for (const entry of this.entries()) {
      const systemMode = this.status.systems.get(entry.system.id)?.mode;
      for (const { device_feature_external_id: id, ...value } of this.statesOf(entry, systemMode)) {
        if (created.has(id)) {
          this.publisher.push(id, value);
        }
      }
    }
  }

  /**
   * The scene events since the previous reading: mode changes, faults raised
   * or cleared. Without `fire`, the snapshot only takes the new values.
   */
  queueEvents(fire = true) {
    const snapshot = new Map();
    for (const entry of this.entries()) {
      const key = `${entry.kind}:${entry.entity.id}`;
      const before = this.previous?.get(key);
      const current = {
        mode: entry.status?.mode,
        permanent: entry.status?.permanent,
        until: entry.status?.until,
        faults: entry.status?.faults ?? [],
      };
      snapshot.set(key, current);
      if (!fire || !this.previous || !entry.status) {
        continue;
      }
      const common = { device: entry.ids.device, device_name: cut(this.nameOf(entry)) };
      if (entry.kind === 'system') {
        const event = modeEvent(before, current);
        if (event) {
          this.logger.info(`${common.device_name}: mode ${event.previous} -> ${event.mode}`);
          this.publisher.pushSceneEvent(event.key, {
            system: entry.ids.device,
            system_name: common.device_name,
            mode: event.mode,
            previous_mode: event.previous ?? null,
            permanent: event.permanent,
            until: event.until === undefined ? null : new Date(event.until).toISOString(),
          });
        }
      }
      for (const event of faultEvents(before?.faults, current.faults)) {
        this.logger.info(`${common.device_name}: ${event.key} ${event.type}`);
        this.publisher.pushSceneEvent(event.key, {
          ...common,
          fault_type: event.type,
          since: event.since === undefined ? null : new Date(event.since).toISOString(),
        });
      }
    }
    this.previous = snapshot;
  }

  badge(entry) {
    if (this.refused || this.offline) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    if (this.status?.systems.get(entry.system.id)?.gatewayLost) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE, degraded: true, message: T.gatewayLost };
    }
    return { transport: DEVICE_TRANSPORTS.CLOUD };
  }

  async publishAllTransports() {
    if (!this.location) {
      return;
    }
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const list = [];
    for (const entry of this.entries()) {
      const externalId = entry.ids.device;
      if (!created.has(externalId)) {
        continue;
      }
      const badge = { external_id: externalId, ...this.badge(entry) };
      const json = JSON.stringify(badge);
      if (this.transports.get(externalId) !== json) {
        this.transports.set(externalId, json);
        list.push(badge);
      }
    }
    if (list.length > 0) {
      await this.gladys
        .publishTransports(list)
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.transports.delete(device?.external_id);
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueStates(created);
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
    await this.publishAllTransports();
  }

  async deviceDeleted(device) {
    this.transports.delete(device?.external_id);
    if (device?.external_id) {
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: the installation again, if not read just now. */
  async scan() {
    if (
      this.client.hasCredentials &&
      !this.refused &&
      this.now() - this.lastScanAt >= TIMINGS.scanCooldown
    ) {
      this.lastScanAt = this.now();
      this.misconfigured = false;
      await this.tick({ installation: true });
      return;
    }
    await this.publishDevices();
  }

  // --- Commands --------------------------------------------------------------

  /** The device of the location an external id names: { kind, entity, system, ids }. */
  find(externalId) {
    const target = parseExternalId(externalId);
    if (!target) {
      return undefined;
    }
    const entry = this.entries().find((e) => e.kind === target.kind && e.entity.id === target.id);
    return entry ? { ...entry, role: target.role } : undefined;
  }

  ready() {
    const language = this.config.language;
    if (this.refused) {
      throw userError(T.refused, language);
    }
    if (!this.location) {
      throw userError(T.notReady, language);
    }
  }

  /** A command sent: what it set wins over the readings for a while, then one read. */
  async commanded(kind, id, values) {
    this.guard(kind, id, values);
    if (this.status) {
      this.apply(this.status, { fire: false });
    }
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
    this.soon();
  }

  /** A refused command: Gladys shows the value asked for, send the real one again. */
  async restore(featureId) {
    this.gladys.forgetPublishedStates(featureId);
    if (this.status) {
      this.queueStates();
    }
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  async setValue(_device, feature, value) {
    this.ready();
    const entry = this.find(feature?.external_id);
    if (!entry) {
      throw userError(T.unknownDevice, this.config.language);
    }
    try {
      await this.command(entry, value);
    } catch (err) {
      await this.restore(feature.external_id);
      // The ack shows the message: the Evohome one, with its HTTP status.
      throw err.kind ? new Error(errorReason(err), { cause: err }) : err;
    }
  }

  async command(entry, value) {
    const { kind, role, entity } = entry;
    if (kind === 'system' && role === 'mode') {
      return this.setSystemMode(entity, String(value));
    }
    if (kind === 'zone' && role === 'setpoint') {
      return this.setSetpoint(entity, Number(value));
    }
    if (kind === 'zone' && role === 'heating-mode') {
      return Number(value) === GLADYS.THERMOSTAT_MODE.OFF
        ? this.setSetpoint(entity, entity.min, { permanent: true })
        : this.clearOverride(entity);
    }
    if (kind === 'zone' && role === 'setpoint-mode') {
      return this.setSetpointMode(entity, String(value));
    }
    if (kind === 'dhw' && role === 'state') {
      return this.setHotWater(entity, Number(value) === GLADYS.ON ? 'on' : 'off');
    }
    if (kind === 'dhw' && role === 'mode') {
      const modes = {
        [GLADYS.WATER_HEATER_MODE.PROGRAM]: ['auto'],
        [GLADYS.WATER_HEATER_MODE.MANUAL]: ['on'],
        [GLADYS.WATER_HEATER_MODE.OFF]: ['off'],
        [GLADYS.WATER_HEATER_MODE.BOOST]: ['on', this.config.boostDuration],
      };
      const choice = modes[Number(value)];
      if (!choice) {
        throw new Error(`Unknown hot water mode ${value}`);
      }
      return this.setHotWater(entity, ...choice);
    }
    throw new Error(`${entry.ids.feature(role)} cannot be set`);
  }

  /**
   * The system mode, permanent or until a time: `{ hours }` for the modes
   * timed by duration (Eco), `{ days }` for the ones timed by period (Away,
   * Day off, Custom: until midnight, local time).
   */
  async setSystemMode(system, mode, { hours, days } = {}) {
    const language = this.config.language;
    const allowed = system.modes.find((m) => m.mode === mode);
    if (!SYSTEM_MODES.includes(mode) || !allowed) {
      throw userError(T.modeNotAllowed(mode), language);
    }
    const until = systemUntil(allowed, { hours, days, now: this.now() });
    if (until !== undefined && !allowed.temporary) {
      throw userError(T.temporaryNotAllowed(word(SYSTEM_MODE_NAMES[mode], language)), language);
    }
    await this.client.setSystemMode(system.id, { mode, until });
    this.logger.info(`${systemName(system, 'en')}: mode ${mode}`);
    // A reset puts the zones back on their schedule, and reads as Auto.
    const shown = mode === 'AutoWithReset' ? 'Auto' : mode;
    await this.commanded('system', system.id, {
      mode: shown,
      permanent: until === undefined,
      until,
    });
    return until;
  }

  /** A setpoint for the default time (or `minutes`), or permanent; resolves its end. */
  async setSetpoint(zone, value, { minutes, permanent } = {}) {
    const language = this.config.language;
    if (!Number.isFinite(value) || value < zone.min || value > zone.max) {
      throw userError(T.badSetpoint(zone.min, zone.max), language);
    }
    const setpoint = Math.round(value / zone.step) * zone.step;
    const forever =
      permanent ??
      (minutes === undefined ? this.config.overrideMode === 'permanent' : minutes === 0);
    const canTemporary = zone.setpointModes.includes(SETPOINT_MODES.TEMPORARY);
    const until =
      forever || !canTemporary
        ? undefined
        : overrideUntil(zone, minutes ?? this.config.overrideDuration, this.now());
    const mode = until === undefined ? SETPOINT_MODES.PERMANENT : SETPOINT_MODES.TEMPORARY;
    await this.client.setZoneSetpoint(zone.id, { mode, setpoint, until });
    this.logger.info(`${zone.name}: ${setpoint} °C, ${mode}`);
    await this.commanded('zone', zone.id, { setpoint, setpointMode: mode, until });
    return until;
  }

  async clearOverride(zone) {
    await this.client.setZoneSetpoint(zone.id, { mode: SETPOINT_MODES.FOLLOW });
    this.logger.info(`${zone.name}: back to its schedule`);
    await this.commanded('zone', zone.id, {
      setpointMode: SETPOINT_MODES.FOLLOW,
      until: undefined,
    });
  }

  /** From the setpoint mode select: the current setpoint kept for a while, or for good. */
  async setSetpointMode(zone, mode) {
    if (mode === SETPOINT_MODES.FOLLOW) {
      return this.clearOverride(zone);
    }
    if (mode !== SETPOINT_MODES.PERMANENT && mode !== SETPOINT_MODES.TEMPORARY) {
      throw new Error(`Unknown setpoint mode "${mode}"`);
    }
    const current = this.status?.zones.get(zone.id)?.setpoint;
    if (current === undefined) {
      throw userError(T.notReady, this.config.language);
    }
    return this.setSetpoint(zone, current, { permanent: mode === SETPOINT_MODES.PERMANENT });
  }

  /** Hot water `on`, `off` (permanent, or for `minutes`) or `auto` (its schedule). */
  async setHotWater(dhw, choice, minutes) {
    if (choice === 'auto') {
      await this.client.setDhwState(dhw.id, { mode: SETPOINT_MODES.FOLLOW });
      this.logger.info('Hot water: back to its schedule');
      await this.commanded('dhw', dhw.id, { mode: SETPOINT_MODES.FOLLOW, until: undefined });
      return undefined;
    }
    const state = choice === 'on' ? DHW_STATES.ON : DHW_STATES.OFF;
    const canTemporary = dhw.modes.includes(SETPOINT_MODES.TEMPORARY);
    const until = minutes && canTemporary ? overrideUntil(dhw, minutes, this.now()) : undefined;
    const mode = until === undefined ? SETPOINT_MODES.PERMANENT : SETPOINT_MODES.TEMPORARY;
    await this.client.setDhwState(dhw.id, { mode, state, until });
    this.logger.info(`Hot water: ${state}, ${mode}`);
    await this.commanded('dhw', dhw.id, { state, mode, until });
    return until;
  }

  // --- Scene actions ----------------------------------------------------------

  sceneTarget(externalId, kind) {
    this.ready();
    const fallback = kind === 'system' && !externalId;
    const entry = fallback
      ? this.entries().find((e) => e.kind === 'system')
      : this.find(externalId);
    if (!entry || entry.kind !== kind) {
      throw userError(T.unknownDevice, this.config.language);
    }
    return entry.entity;
  }

  async sceneAction(run) {
    try {
      const until = await run();
      return { until: until === undefined ? '' : new Date(until).toISOString() };
    } catch (err) {
      throw err.kind ? new Error(errorReason(err), { cause: err }) : err;
    }
  }

  sceneSystemMode(fields = {}) {
    return this.sceneAction(() => {
      const system = this.sceneTarget(fields.system, 'system');
      return this.setSystemMode(system, String(fields.mode ?? ''), {
        hours: positive(fields.hours),
        days: positive(fields.days),
      });
    });
  }

  sceneZoneSetpoint(fields = {}) {
    return this.sceneAction(() => {
      const zone = this.sceneTarget(fields.zone, 'zone');
      const minutes = Number(fields.minutes);
      return this.setSetpoint(zone, Number(fields.temperature), {
        minutes:
          fields.minutes === undefined || fields.minutes === null || fields.minutes === ''
            ? undefined
            : Number.isFinite(minutes) && minutes > 0
              ? minutes
              : 0,
      });
    });
  }

  sceneClearOverride(fields = {}) {
    return this.sceneAction(async () => {
      await this.clearOverride(this.sceneTarget(fields.zone, 'zone'));
      return undefined;
    });
  }

  sceneHotWater(fields = {}) {
    return this.sceneAction(() => {
      const dhw = this.sceneTarget(fields.hot_water, 'dhw');
      const choice = String(fields.state ?? '');
      if (!['on', 'off', 'auto'].includes(choice)) {
        throw new Error(`Unknown hot water state "${choice}"`);
      }
      return this.setHotWater(dhw, choice, positive(fields.minutes));
    });
  }

  // --- "Test the connection" button -----------------------------------------

  async testConnection() {
    if (!this.client.hasCredentials) {
      return T.noCredentials;
    }
    if (this.status && this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      const summary = this.summary();
      return {
        en: `${T.test.cooldown.en} ${summary.en}`,
        fr: `${T.test.cooldown.fr} ${summary.fr}`,
      };
    }
    this.lastTestAt = this.now();
    // One sign-in per click: the button is how a refused account is retried.
    this.refused = false;
    this.misconfigured = false;
    this.pausedUntil = 0;
    await this.running;
    await this.tick({ installation: true });
    const [connected, message] = JSON.parse(this.lastStatus ?? '[false,null]');
    if (!connected || !this.status) {
      return message ?? T.noCredentials;
    }
    return this.summary();
  }

  /** The locations (the followed one marked), the mode, zones and faults of its systems. */
  summary() {
    const list = (lang) =>
      (this.locations ?? [])
        .map(
          (l) =>
            `${l.name} (${l.id})${l.id === this.location?.id ? `, ${T.test.chosen[lang]}` : ''}`,
        )
        .join('; ');
    const lines = [T.test.locations({ en: list('en'), fr: list('fr') })];
    let faults = 0;
    for (const system of this.location?.systems ?? []) {
      const mode = this.status?.systems.get(system.id)?.mode;
      const names = SYSTEM_MODE_NAMES[mode] ?? { en: mode ?? '?', fr: mode ?? '?' };
      lines.push(T.test.system(names, system.zones.length, Boolean(system.dhw)));
    }
    for (const entry of this.entries()) {
      faults += entry.status?.faults?.length ?? 0;
    }
    lines.push(T.test.faults(faults));
    const join = (lang) => lines.map((line) => line[lang] ?? line.en).join(' ');
    return { en: join('en'), fr: join('fr') };
  }
}

/** A positive number from a scene field, undefined when empty or zero. */
function positive(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
