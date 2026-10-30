import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandoff, extractMessages, readContext, readableHandoff } from '../src/handoff.js';
const event = (seq, text, role = 'user', surfaceOp = 'append') => ({ seq, type: `${role}/message`, surfaceOp, data: role === 'user' ? { role, content: [{ type: 'text', text }] } : { message: { role, content: [{ type: 'text', text }, { type: 'thinking', text: 'PRIVATE THOUGHT' }] } } });
const shelf = { id: 'shelf', revision: 1, title: '任务', workspaceId: 'work', nextStep: '验证部署', sessionRefs: [{ id: 'a', sessionId: 'first' }, { id: 'b', sessionId: 'second' }] };
const request = { shelfId: 'shelf', revision: 1, refIds: ['a', 'b'] };
const store = { snapshot: async () => ({ shelves: [shelf] }) };
function catalog() { return { workspace: async id => ({ id, title: '合成工作区' }), session: async (w, id) => ({ id, title: id }), context: async id => extractMessages([event(0, `${id} 内容`)]) }; }
test('current surface only: replaced content, system prompts and thinking are excluded', () => {
  const result = extractMessages([event(0, 'SECRET', 'system'), event(1, 'old'), { ...event(2, 'current', 'user', { op: 'replace', startSeq: 1, endSeq: 1 }), sourceEventSeqs: [1] }, event(3, 'answer', 'assistant')]);
  assert.deepEqual(result.messages.map(m => m.text), ['current', 'answer']);
  assert.deepEqual(result.messages.map(m => m.seq), [2, 3]);
});
test('excerpt limits explicitly report earlier messages and truncated Unicode text', () => {
  const result = extractMessages(Array.from({ length: 15 }, (_, i) => event(i, '😀'.repeat(1100))));
  assert.equal(result.omittedMessages, 3); assert.equal(result.messages.length, 12);
  assert.equal([...result.messages[0].text].length, 1000); assert.equal(result.messages[0].truncated, true);
});
test('two source package preserves citations and note, does not invent confirmed conclusions', async () => {
  const result = await createHandoff(store, catalog(), request);
  assert.equal(result.sources.length, 2); assert.match(result.text, /first 内容/); assert.match(result.text, /second 内容/);
  assert.match(result.text, /来源 2 \/ 事件 0/); assert.match(result.text, /尚未自动确认/); assert.match(result.text, /验证部署/);
  assert.match(result.readableText, /first 内容/); assert.match(result.readableText, /second 内容/);
  assert.match(result.readableText, /接下来要做什么\n验证部署/);
  assert.doesNotMatch(result.readableText, /会话 ID：|事件 0|##|> first/);
});
test('readable version preserves original words, role, omissions and truncation without claiming summary', () => {
  const text = readableHandoff(shelf, [{ id: 'PRIVATE-TECHNICAL-ID', title: '接口讨论', archived: true, omittedMessages: 8, messages: [{ seq: 97, role: 'user', text: '必须保留旧接口。', truncated: false }, { seq: 99, role: 'assistant', text: '建议先加适配层。', truncated: true }] }]);
  assert.match(text, /你说\n必须保留旧接口。/); assert.match(text, /AI 回复\n建议先加适配层。/);
  assert.match(text, /8 条文字消息未包含/); assert.match(text, /只展示了前 1000/);
  assert.match(text, /不是 AI 总结/); assert.match(text, /已归档/);
  assert.doesNotMatch(text, /PRIVATE-TECHNICAL-ID|事件 97/);
});
test('unlinked, duplicate, excess, stale and removed sources fail before reading content', async () => {
  const c = catalog(); let reads = 0; c.context = async () => { reads++; };
  for (const body of [{ ...request, refIds: ['foreign'] }, { ...request, refIds: ['a', 'a'] }, { ...request, refIds: ['a','b','c','d','e','f'] }, { ...request, revision: 0 }]) await assert.rejects(createHandoff(store, c, body));
  c.session = async (w, id) => { if (id === 'second') throw new Error('membership removed'); return { id }; };
  await assert.rejects(createHandoff(store, c, request)); assert.equal(reads, 0);
});
test('revision changing during read refuses a partial or stale package', async () => {
  let count = 0; const changing = { snapshot: async () => ({ shelves: [{ ...shelf, revision: ++count }] }) };
  await assert.rejects(createHandoff(changing, catalog(), request), { code: 'conflict' });
});
test('read-only handle closes on failure; oversized stat avoids opening', async () => {
  let closed = false, opened = 0;
  const ctx = { sessionPersistence: { stat: async () => ({ eventCount: 1 }), open: async (id, mode) => { assert.equal(mode, 'read'); opened++; return { read: async () => { throw new Error('failed'); }, close: async () => { closed = true; } }; } } };
  await assert.rejects(readContext(ctx, 'first')); assert.equal(closed, true);
  ctx.sessionPersistence.stat = async () => ({ eventCount: 30000 });
  await assert.rejects(readContext(ctx, 'first'), { code: 'handoff-large' }); assert.equal(opened, 1);
});
