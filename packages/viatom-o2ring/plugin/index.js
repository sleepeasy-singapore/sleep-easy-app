const {
  withAndroidManifest,
  withInfoPlist,
  createRunOncePlugin,
} = require("@expo/config-plugins");

const IOS_BLUETOOTH_USAGE =
  "Sleep Easy uses Bluetooth to pair with your device.";

function addBluetoothPermissions(config) {
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // Ensure <manifest> has <uses-permission>
    const permissions = [
      "android.permission.BLUETOOTH",
      "android.permission.BLUETOOTH_ADMIN",
      "android.permission.BLUETOOTH_SCAN",
      "android.permission.BLUETOOTH_CONNECT",
      "android.permission.BLUETOOTH_ADVERTISE",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
    ];

    manifest["uses-permission"] = manifest["uses-permission"] || [];

    permissions.forEach((perm) => {
      if (
        !manifest["uses-permission"].some((p) => p.$["android:name"] === perm)
      ) {
        // BLUETOOTH_SCAN on Android 12+ should declare neverForLocation when used for non-location
        const attrs =
          perm === "android.permission.BLUETOOTH_SCAN"
            ? {
                "android:name": perm,
                "android:usesPermissionFlags": "neverForLocation",
              }
            : { "android:name": perm };
        manifest["uses-permission"].push({ $: attrs });
      }
    });

    return config;
  });

  config = withInfoPlist(config, (config) => {
    const plist = config.modResults;
    // Always include both keys per App Store review guidance.
    plist.NSBluetoothAlwaysUsageDescription =
      plist.NSBluetoothAlwaysUsageDescription || IOS_BLUETOOTH_USAGE;
    plist.NSBluetoothPeripheralUsageDescription =
      plist.NSBluetoothPeripheralUsageDescription || IOS_BLUETOOTH_USAGE;

    return config;
  });

  return config;
}

module.exports = createRunOncePlugin(
  addBluetoothPermissions,
  "viatom",
  "1.0.0"
);
