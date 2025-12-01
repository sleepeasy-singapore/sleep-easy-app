// app.plugin.js
const {
  withAppBuildGradle,
  withSettingsGradle,
  createRunOncePlugin,
} = require("@expo/config-plugins");

const LIVE_EVENTBUS_PROJECT = `
include ':liveeventbus-x'
project(':liveeventbus-x').projectDir = new File(rootProject.projectDir, '../packages/live-event-bus-x/branchs/live-event-bus-x/liveeventbus-x')
`;

const EXTRA_DEPS = [
  'implementation project(":liveeventbus-x")',
  'implementation "io.getstream:stream-log-android:1.1.4"',
  'implementation "io.getstream:stream-log-android-file:1.1.4"',
  'implementation "no.nordicsemi.android:ble:2.7.2"',
];

const ensureLines = (text, block) =>
  block
    .split("\n")
    .reduce(
      (t, line) => (line && !t.includes(line) ? t + "\n" + line : t),
      text
    );

const withViatomSettings = (config) =>
  withSettingsGradle(config, (config) => {
    config.modResults.contents = ensureLines(
      config.modResults.contents,
      LIVE_EVENTBUS_PROJECT
    );
    return config;
  });

const withViatomDeps = (config) =>
  withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents ?? "";

    const depsBlock = EXTRA_DEPS.join("\n    ");

    // only add once
    if (!contents.includes('implementation project(":liveeventbus-x")')) {
      contents = contents.replace(
        /dependencies\s*{/,
        (match) => `${match}\n    ${depsBlock}\n`
      );
    }

    config.modResults.contents = contents;
    return config;
  });

const plugin = (config) => {
  config = withViatomSettings(config);
  config = withViatomDeps(config);
  return config;
};

module.exports = createRunOncePlugin(plugin, "viatom-deps");
