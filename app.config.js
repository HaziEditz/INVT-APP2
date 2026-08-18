/**
 * Injects git commit + version into expo.extra so the driver app can show
 * a build label (login / Profile) without guessing which binary is installed.
 */
const { execSync } = require('node:child_process');
const appJson = require('./app.json');

function shortGitCommit() {
  const fromEnv = (
    process.env.EAS_BUILD_GIT_COMMIT_HASH ||
    process.env.EXPO_PUBLIC_GIT_COMMIT ||
    process.env.GITHUB_SHA ||
    ''
  ).trim();
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().slice(0, 7);
  } catch {
    return 'unknown';
  }
}

const gitCommit = shortGitCommit();
const expo = appJson.expo || {};

module.exports = {
  expo: {
    ...expo,
    extra: {
      ...(expo.extra || {}),
      appVersion: expo.version || '0.0.0',
      gitCommit,
      buildLabel: `v${expo.version || '0.0.0'} · ${gitCommit}`,
      // Default matches eas.json; ensures eas update embeds a location even without shell env.
      stripeTerminalLocationId:
        process.env.EXPO_PUBLIC_STRIPE_TERMINAL_LOCATION_ID || 'tml_GnUMTgohbETmrc',
    },
  },
};
