/**
 * Per-company chat kill-switch: hide the Chat tab entirely when disabled.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { driverChatTabHref, isCompanyChatEnabled } from '../lib/companyChatPolicy.ts';
import { chatThreadDbPaths, chatThreadDriverIds } from '../lib/chatThreadPaths.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('chat defaults on; only explicit false hides it', () => {
  assert.equal(isCompanyChatEnabled(null), true);
  assert.equal(isCompanyChatEnabled({}), true);
  assert.equal(isCompanyChatEnabled({ features: { tmEnabled: true } }), true);
  assert.equal(isCompanyChatEnabled({ chatEnabled: true }), true);
  assert.equal(isCompanyChatEnabled({ features: { chatEnabled: true } }), true);
  assert.equal(isCompanyChatEnabled({ chatEnabled: false }), false);
  assert.equal(isCompanyChatEnabled({ features: { chatEnabled: false } }), false);
  assert.equal(isCompanyChatEnabled({ chatEnabled: true, features: { chatEnabled: false } }), false);
});

test('disabled chat tab uses href:null so Expo Router omits it', () => {
  assert.equal(driverChatTabHref(true), undefined);
  assert.equal(driverChatTabHref(false), null);
});

test('tab layout hides Chat instead of greying it out', () => {
  const layout = readFileSync(join(root, 'app/(tabs)/_layout.tsx'), 'utf8');
  assert.match(layout, /chatEnabled/);
  assert.match(layout, /driverChatTabHref\(chatEnabled\)/);
  assert.doesNotMatch(layout, /opacity:\s*0\.[0-9]/);
});

test('chat screens redirect away when the company has chat off', () => {
  const tab = readFileSync(join(root, 'app/(tabs)/chat.tsx'), 'utf8');
  assert.match(tab, /chatEnabled/);
  assert.match(tab, /Redirect/);
  const stack = readFileSync(join(root, 'app/chat.tsx'), 'utf8');
  assert.match(stack, /chatEnabled/);
  assert.match(stack, /Redirect/);
});

test('driver chat listeners and banners are skipped when chat is off', () => {
  const ctx = readFileSync(join(root, 'context/DriverContext.tsx'), 'utf8');
  assert.match(ctx, /chatEnabled/);
  assert.match(ctx, /isCompanyChatEnabled/);
  assert.match(ctx, /!chatEnabled/);
  assert.match(ctx, /fetchCompanyChatEnabled/);
  assert.match(ctx, /ignoreInitial:\s*true/);
  assert.doesNotMatch(ctx, /company chat flag[\s\S]{0,80}setChatEnabled\(true\)/);
  const api = readFileSync(join(root, 'lib/dispatchApi.ts'), 'utf8');
  assert.match(api, /\/api\/driver\/company-chat/);
});

test('live thread listens on chatMessages (readable today) and messages', () => {
  assert.deepEqual(chatThreadDriverIds('D001'), ['D001']);
  const paths = chatThreadDbPaths('860869', 'D001');
  assert.ok(paths.includes('chatMessages/860869/D001'));
  assert.ok(paths.includes('messages/860869/D001'));
  const svc = readFileSync(join(root, 'lib/chatService.ts'), 'utf8');
  assert.match(svc, /chatThreadDbPaths/);
  assert.match(svc, /mergeChatMessageLists/);
});
