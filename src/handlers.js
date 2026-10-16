// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the end-to-end
// tests, so the tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS, SCENE_ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // Discovery: the system, zones and hot water of the location.
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onDeviceUpdated((device) => app.deviceCreated(device));
  gladys.onDeviceDeleted((device) => app.deviceDeleted(device));

  // System mode, zone setpoints and modes, hot water.
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // Configuration screen button.
  gladys.onAction(ACTIONS.TEST_CONNECTION, () => app.testConnection());

  // Scene editor.
  gladys.onSceneAction(SCENE_ACTIONS.SET_SYSTEM_MODE, (fields) => app.sceneSystemMode(fields));
  gladys.onSceneAction(SCENE_ACTIONS.SET_ZONE_SETPOINT, (fields) => app.sceneZoneSetpoint(fields));
  gladys.onSceneAction(SCENE_ACTIONS.CLEAR_ZONE_OVERRIDE, (fields) =>
    app.sceneClearOverride(fields),
  );
  gladys.onSceneAction(SCENE_ACTIONS.SET_HOT_WATER, (fields) => app.sceneHotWater(fields));

  // Configuration changed by the user.
  gladys.onConfigUpdated((config) => app.configUpdated(config));

  // Connection lifecycle: the first connection starts, a reconnection resends.
  gladys.on('connected', async () => {
    try {
      await app.connected(await gladys.getConfig());
    } catch (err) {
      logger?.error('Start failed', err);
    }
  });
}
