/**
 * Per-company chat kill-switch: hide the Chat tab entirely when disabled.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { driverChatTabHref, isCompanyChatEnabled } from '../lib/companyChatPolicy.ts';
import {
  chatHistoryRowToMessage,
  chatThreadDbPaths,
  chatThreadDriverIds,
  conversationSortMs,
  isDispatcherSenderId,
} from '../lib/chatThreadPaths.ts';

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
  assert.ok(chatThreadDriverIds('D001').includes('D001'));
  assert.ok(chatThreadDriverIds('1').includes('D001'));
  const paths = chatThreadDbPaths('860869', 'D001');
  assert.ok(paths.includes('chatMessages/860869/D001'));
  assert.ok(paths.includes('messages/860869/D001'));
  const svc = readFileSync(join(root, 'lib/chatService.ts'), 'utf8');
  assert.match(svc, /chatThreadDbPaths/);
  assert.match(svc, /mergeChatMessageLists/);
  const panel = readFileSync(join(root, 'components/ChatPanel.tsx'), 'utf8');
  assert.match(panel, /scrollToEnd/);
  assert.match(panel, /onContentSizeChange/);
});

test('conversation is a back-and-forth thread: driver right, dispatcher left, time order', () => {
  assert.equal(isDispatcherSenderId('Dispatcher'), true);
  assert.equal(isDispatcherSenderId('0'), true);
  assert.equal(isDispatcherSenderId('D001'), false);

  const hi = chatHistoryRowToMessage(
    'a',
    { senderId: 'D001', message: 'hi', date: '2026-09-11', time: '14:00', createdAt: 0 },
    'T201',
  );
  const reply = chatHistoryRowToMessage(
    'b',
    {
      senderId: 'Dispatcher',
      senderName: 'Dispatcher',
      message: 'hello',
      date: '2026-09-11',
      time: '14:01',
      createdAt: Date.parse('2026-09-11T14:01:00'),
    },
    'T201',
  );
  assert.equal(hi?.sender, 'driver');
  assert.equal(reply?.sender, 'dispatcher');
  assert.ok(hi && reply && hi.timestamp < reply.timestamp);

  const liveHi = {
    createdAt: Date.parse('2026-09-11T14:00:30'),
    Date: '2026-09-11',
    Time: '14:00',
    Id: 5,
  };
  const optimisticReply = { Date: '2026-09-11', Time: '14:01', Id: Date.now() };
  assert.ok(conversationSortMs(liveHi) < conversationSortMs(optimisticReply));
  const naiveFirst = [liveHi, optimisticReply].sort(
    (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.Id - b.Id,
  )[0];
  assert.equal(naiveFirst, optimisticReply);

  const panel = readFileSync(join(root, 'components/ChatPanel.tsx'), 'utf8');
  assert.match(panel, /styles\.rowMine/);
  assert.match(panel, /styles\.rowTheirs/);
  assert.match(panel, /alignItems: 'flex-end'/);
  assert.match(panel, /alignItems: 'flex-start'/);
  assert.match(panel, /width: '100%'/);
  const svc = readFileSync(join(root, 'lib/chatService.ts'), 'utf8');
  assert.match(svc, /chatHistoryRowToMessage/);
});
