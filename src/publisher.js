// -----------------------------------------------------------------------------
// What goes to Gladys, within its limits: 300 states and 300 scene events per
// minute.
//
// - push(): the current value of a feature (temperature, setpoint, mode…). The
//   last one wins; unchanged values are skipped by publishChangedStates and
//   sent again every 30 minutes.
// - pushEvent(): a value that must reach Gladys even when equal to the last
//   one (the value a command just set, read back). Queued and all sent
//   (publishStates).
// - pushSceneEvent(): a scene trigger. Queued and all sent, never merged.
// Everything left over (budget spent, Gladys unreachable) waits for the next
// flush, every second.
// -----------------------------------------------------------------------------

import { LIMITS, TIMINGS } from './constants.js';

const MINUTE = 60_000;

/**
 * Gladys refused the event itself (undeclared key, invalid data, the SDK's own
 * check before any request): retrying will not help.
 */
const refusedForGood = (err) =>
  (err?.status !== undefined && err.status !== 429 && err.status < 500) ||
  /^publishSceneEvent:/.test(String(err?.message));

export class StatePublisher {
  constructor({
    gladys,
    logger,
    now = Date.now,
    timers = globalThis,
    statesPerMinute = LIMITS.statesPerMinute,
    sceneEventsPerMinute = LIMITS.sceneEventsPerMinute,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.statesPerMinute = statesPerMinute;
    this.sceneEventsPerMinute = sceneEventsPerMinute;
    /** featureId -> { state } | { text } */
    this.pending = new Map();
    /** Dated states, in order. */
    this.events = [];
    /** Scene events, in order: { key, data }. */
    this.sceneEvents = [];
    /** Send times of the last minute. */
    this.stateWindow = [];
    this.sceneWindow = [];
    this.timer = undefined;
    this.flushing = undefined;
  }

  start() {
    this.stop();
    this.timer = this.timers.setInterval(() => {
      this.flush().catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
    }, TIMINGS.flushInterval);
  }

  stop() {
    if (this.timer) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  push(featureId, value) {
    this.pending.set(featureId, value);
  }

  pushEvent(featureId, value) {
    this.events.push({ device_feature_external_id: featureId, ...value });
    if (this.events.length > LIMITS.queuedEvents) {
      this.events.shift();
    }
  }

  pushSceneEvent(key, data) {
    this.sceneEvents.push({ key, data });
    if (this.sceneEvents.length > LIMITS.queuedEvents) {
      this.sceneEvents.shift();
    }
  }

  /** Forgets what is pending for a device (deleted): `ext:…:device:12` and its features. */
  forget(deviceId) {
    const owned = (id) => id === deviceId || id.startsWith(`${deviceId}:`);
    this.events = this.events.filter((e) => !owned(e.device_feature_external_id));
    for (const id of [...this.pending.keys()]) {
      if (owned(id)) {
        this.pending.delete(id);
      }
    }
  }

  get idle() {
    return this.pending.size === 0 && this.events.length === 0 && this.sceneEvents.length === 0;
  }

  flush() {
    if (!this.flushing) {
      this.flushing = this.doFlush().finally(() => {
        this.flushing = undefined;
      });
    }
    return this.flushing;
  }

  async doFlush() {
    await this.flushSceneEvents();
    await this.flushStates();
  }

  async flushSceneEvents() {
    const now = this.now();
    this.sceneWindow = this.sceneWindow.filter((t) => now - t < MINUTE);
    while (this.sceneEvents.length > 0 && this.sceneWindow.length < this.sceneEventsPerMinute) {
      const { key, data } = this.sceneEvents[0];
      try {
        await this.gladys.publishSceneEvent(key, data);
      } catch (err) {
        if (!refusedForGood(err)) {
          throw err;
        }
        this.logger.warn(`Gladys refused the scene event ${key}: ${err.message}`);
      }
      this.sceneEvents.shift();
      this.sceneWindow.push(now);
    }
  }

  async flushStates() {
    const now = this.now();
    this.stateWindow = this.stateWindow.filter((t) => now - t < MINUTE);
    let room = this.statesPerMinute - this.stateWindow.length;
    const spend = (count) => {
      for (let i = 0; i < count; i += 1) {
        this.stateWindow.push(now);
      }
      room -= count;
    };
    while (room > 0 && this.events.length > 0) {
      // publishStates, not publishChangedStates: equal values are distinct moments.
      const batch = this.events.splice(0, Math.min(room, LIMITS.statesPerRequest));
      try {
        await this.gladys.publishStates(batch);
      } catch (err) {
        this.events.unshift(...batch);
        throw err;
      }
      spend(batch.length);
    }
    if (room <= 0 || this.pending.size === 0) {
      return;
    }
    const batch = [];
    for (const [featureId, value] of this.pending) {
      if (batch.length >= room) {
        break;
      }
      this.pending.delete(featureId);
      batch.push({ device_feature_external_id: featureId, ...value });
    }
    try {
      const result = await this.gladys.publishChangedStates(batch, {
        heartbeat: TIMINGS.stateHeartbeat,
      });
      spend(result?.count ?? batch.length);
    } catch (err) {
      // Kept for the next round, unless a newer value arrived meanwhile.
      for (const { device_feature_external_id: id, ...value } of batch) {
        if (!this.pending.has(id)) {
          this.pending.set(id, value);
        }
      }
      throw err;
    }
  }
}
