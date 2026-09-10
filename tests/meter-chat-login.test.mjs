import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MOVING_HOLD_TICKS,
  shouldAccrueMeterMoving,
} from '../lib/meterMotionPolicy.ts';
import {
  createInitialMeter,
  tickMeterWithGps,
} from '../lib/meterTick.ts';
import { shouldAlertIncomingDispatcherChat } from '../lib/chatReadPolicy.ts';
import { shouldAcceptLiveChatSnap } from '../lib/chatLivePolicy.ts';

const tariff = {
  id: 't1',
  name: 'Test',
  flagFall: 3,
  ratePerKm: 2,
  waitingPerMin: 60,
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('poor GPS while already moving does not flip to waiting', () => {
  assert.equal(
    shouldAccrueMeterMoving({
      prevMode: 'moving',
      speedMs: 0,
      distanceDeltaM: 0,
      dtMs: 2000,
      accuracyBlocked: true,
      samePositionRepeat: false,
      movingHoldTicks: 0,
    }),
    true,
  );
  assert.equal(
    shouldAccrueMeterMoving({
      prevMode: 'waiting',
      speedMs: 0,
      distanceDeltaM: 0,
      dtMs: 2000,
      accuracyBlocked: true,
      samePositionRepeat: false,
      movingHoldTicks: 0,
    }),
    false,
  );
});

test('repeated GPS sample while moving holds moving then allows wait', () => {
  assert.equal(
    shouldAccrueMeterMoving({
      prevMode: 'moving',
      speedMs: 0,
      distanceDeltaM: 0,
      dtMs: 2000,
      accuracyBlocked: false,
      samePositionRepeat: true,
      movingHoldTicks: 0,
    }),
    true,
  );
  assert.equal(
    shouldAccrueMeterMoving({
      prevMode: 'moving',
      speedMs: 0,
      distanceDeltaM: 0,
      dtMs: 2000,
      accuracyBlocked: false,
      samePositionRepeat: true,
      movingHoldTicks: MOVING_HOLD_TICKS,
    }),
    false,
  );
});

test('tickMeterWithGps keeps moving through noisy GPS after a real move', () => {
  let meter = createInitialMeter(tariff);
  meter = tickMeterWithGps(meter, tariff, -36.84, 174.76, 8, 12).meter;
  meter = tickMeterWithGps(meter, tariff, -36.8403, 174.76, 8, 12).meter;
  assert.equal(meter.mode, 'moving');
  const waitBefore = meter.waitingMs;
  meter = tickMeterWithGps(meter, tariff, -36.8403, 174.76, 0, 160, {
    samePositionRepeat: true,
    movingHoldTicks: 0,
  }).meter;
  assert.equal(meter.mode, 'moving');
  assert.equal(meter.waitingMs, waitBefore);
});

test('already-read leftover chat node does not alert on login', () => {
  assert.equal(
    shouldAlertIncomingDispatcherChat({
      messageTimestamp: 1_000,
      lastReadTimestamp: 5_000,
      alertKey: 'msg-1',
    }),
    false,
  );
  assert.equal(
    shouldAlertIncomingDispatcherChat({
      messageTimestamp: 9_000,
      lastReadTimestamp: 5_000,
      alertKey: 'msg-2',
    }),
    true,
  );
  assert.equal(
    shouldAlertIncomingDispatcherChat({
      messageTimestamp: 9_000,
      lastReadTimestamp: 5_000,
      lastAlertKey: 'msg-2',
      alertKey: 'msg-2',
    }),
    false,
  );
});

test('live chat accepts a new payload even when console omits timestamp', () => {
  assert.equal(
    shouldAcceptLiveChatSnap({
      primed: false,
      ignoreInitial: true,
      ts: 1_000,
      minTs: 0,
      lastStamp: 0,
      fingerprint: 'old|hello|You have New Message|1000',
      lastFingerprint: '',
    }),
    'skip-initial',
  );
  assert.equal(
    shouldAcceptLiveChatSnap({
      primed: true,
      ignoreInitial: true,
      ts: 0,
      minTs: 0,
      lastStamp: 1_000,
      fingerprint: 'new|reply|You have New Message|',
      lastFingerprint: 'old|hello|You have New Message|1000',
    }),
    'accept',
  );
  assert.equal(
    shouldAcceptLiveChatSnap({
      primed: true,
      ts: 0,
      minTs: 0,
      lastStamp: 1_000,
      fingerprint: 'old|hello|You have New Message|1000',
      lastFingerprint: 'old|hello|You have New Message|1000',
    }),
    'skip-dup',
  );
});

test('meter engine clocks from the interval only; chat thread listens live', () => {
  const engine = readFileSync(join(root, 'services/meterEngine.ts'), 'utf8');
  assert.match(engine, /GPS only refreshes the sample/);
  assert.doesNotMatch(
    engine,
    /watchPositionAsync\([\s\S]*runMeterTick\(/,
  );
  const chat = readFileSync(join(root, 'lib/chatService.ts'), 'utf8');
  assert.match(chat, /ignoreInitial/);
  assert.match(chat, /minTimestamp/);
  assert.match(chat, /subscribeChatThread/);
  assert.match(chat, /messages\/\$\{companyId\}\/\$\{driverId\}/);
  const ctx = readFileSync(join(root, 'context/DriverContext.tsx'), 'utf8');
  assert.match(ctx, /shouldAlertIncomingDispatcherChat/);
  assert.match(ctx, /chatLastReadStorageKey/);
  const panel = readFileSync(join(root, 'components/ChatPanel.tsx'), 'utf8');
  assert.match(panel, /subscribeChatThread/);
  assert.match(panel, /ignoreInitial:\s*true/);
});
