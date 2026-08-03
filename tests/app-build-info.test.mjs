import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('app.config.js injects short git commit into expo.extra', () => {
  const cfg = require('../app.config.js');
  const expo = cfg.expo || cfg;
  assert.ok(expo.extra?.gitCommit, 'extra.gitCommit missing');
  assert.match(String(expo.extra.gitCommit), /^[0-9a-f]{7,}$/i);
  assert.equal(expo.extra.appVersion, expo.version);
  assert.equal(expo.extra.buildLabel, `v${expo.version} · ${expo.extra.gitCommit}`);

  const head = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim().slice(0, 7);
  assert.equal(String(expo.extra.gitCommit).slice(0, 7), head);
});
