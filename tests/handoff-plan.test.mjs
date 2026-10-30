import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HandoffPlans, PLAN_LIMITS, charCount, localShorten } from '../src/handoff-plan.js';
import { extractMessages } from '../src/handoff.js';
import { createCompressor } from '../src/handoff-compressor.js';
import { ShelfError } from '../src/core.js';
function setup(lengths = [100, 200], compressor) {
  const shelf = { id: 'shelf', revision: 1, title: '混合工作区交接', nextStep: '继续验证', sessionRefs: [] };
  const membership = new Map(lengths.map((_, i) => [`s${i}`, `w${i % 2}`])); let reads = 0;
  const catalog = {
    async workspace(id) { assert.ok(['w0', 'w1'].includes(id)); return { id, title: `工作区 ${id}` }; },
    async session(w, id) { if (membership.get(id) !== w) throw new ShelfError('wrong-workspace', 'moved', 409); return { id, title: `会话 ${id}` }; },
    async fullContext(id) { reads++; const i = Number(id.slice(1)); return { omittedMessages: 0, messages: [{ seq: 5, role: 'user', text: `开头${'中'.repeat(lengths[i])}结尾`, truncated: false }] }; }
  };
  const plans = new HandoffPlans({ snapshot: async () => ({ shelves: [structuredClone(shelf)] }) }, catalog, compressor);
  const request = { shelfId: shelf.id, revision: 1, sources: lengths.map((_, i) => ({ workspaceId: `w${i % 2}`, sessionId: `s${i}` })) };
  return { plans, request, shelf, catalog, membership, reads: () => reads };
}
const compress = (planId, sourceId, method = 'local') => ({ planId, sourceId, method, operationId: randomUUID() });
test('full extraction preserves long messages and older valid text; legacy excerpt still available', () => {
  const events = Array.from({ length: 20 }, (_, seq) => ({ seq, type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: [{ type: 'text', text: '字'.repeat(1500) }] } }));
  assert.equal(extractMessages(events).messages.length, 12);
  const full = extractMessages(events, true); assert.equal(full.messages.length, 20); assert.equal(full.messages[0].text.length, 1500); assert.equal(full.omittedMessages, 0);
});
test('unlinked conversations from multiple workspaces form one plan without altering shelf', async () => {
  const { plans, request, shelf } = setup(); const before = JSON.stringify(shelf);
  const plan = await plans.prepare(request); assert.equal(plan.ready, true);
  assert.match(plan.text, /工作区 w0/); assert.match(plan.text, /工作区 w1/);
  assert.match(plan.readableText, /你说/); assert.equal(JSON.stringify(shelf), before);
  assert.equal(plan.sources[0].method, null);
});
test('single-source overflow identifies that source; local compression preserves ends and labels omissions', async () => {
  const { plans, request } = setup([20000, 100]); let plan = await plans.prepare(request);
  assert.deepEqual(plan.oversized, ['s0']); assert.equal(plan.ready, false); assert.equal(plan.text, undefined);
  plan = await plans.compress(compress(plan.id, 's0'));
  assert.equal(plan.ready, true); assert.ok(plan.sources[0].size <= 6000); assert.equal(plan.sources[1].method, null);
  assert.match(plan.text, /本地精简/); assert.match(plan.readableText, /开头/); assert.match(plan.readableText, /结尾/); assert.match(plan.readableText, /中间原文已省略/);
});
test('aggregate overflow never chooses a source; only the explicitly chosen source changes', async () => {
  let calls = 0; const { plans, request } = setup([10500, 10500, 10500], { summarize: async () => { calls++; return '摘要'; } });
  const plan = await plans.prepare(request); assert.equal(plan.ready, false); assert.deepEqual(plan.oversized, []); assert.equal(calls, 0);
  const next = await plans.compress(compress(plan.id, 's1'));
  assert.equal(next.ready, true); assert.equal(next.sources[0].size, plan.sources[0].size); assert.equal(next.sources[2].size, plan.sources[2].size);
  assert.equal(next.sources[1].method, 'local'); assert.equal(calls, 0);
});
test('AI selection receives original text; duplicate in-flight requests share one model call', async () => {
  let calls = 0, release; const gate = new Promise(r => { release = r; });
  const { plans, request } = setup([18000], { summarize: async input => { calls++; assert.ok(input.text.length > 18000); await gate; return '用户目标：继续验证。待确认：结果。'; } });
  const plan = await plans.prepare(request), body = compress(plan.id, 's0', 'ai');
  const first = plans.compress(body), second = plans.compress(body); release();
  const [a, b] = await Promise.all([first, second]); assert.equal(calls, 1); assert.deepEqual(a, b); assert.match(a.text, /AI 摘要/);
  await plans.compress(body); assert.equal(calls, 1);
  await assert.rejects(plans.compress({ ...body, method: 'local' }), { code: 'operation-conflict' });
});
test('failed or oversized AI output preserves source and cached failure does not retry', async () => {
  let calls = 0; const { plans, request } = setup([18000], { summarize: async () => { calls++; return '长'.repeat(18000); } });
  const plan = await plans.prepare(request), body = compress(plan.id, 's0', 'ai');
  await assert.rejects(plans.compress(body), { code: 'summary-too-long' });
  await assert.rejects(plans.compress(body), { code: 'summary-too-long' }); assert.equal(calls, 1);
  const after = await plans.status(plan.id); assert.equal(after.sources[0].size, plan.sources[0].size); assert.equal(after.sources[0].method, null);
  assert.equal((await plans.compress(compress(plan.id, 's0'))).ready, true);
});
test('invalid selections fail before text reads; moved and stale sources cannot be compressed', async () => {
  const { plans, request, membership, shelf, reads } = setup([18000, 100]);
  await assert.rejects(plans.prepare({ ...request, sources: [request.sources[0], request.sources[0]] }));
  await assert.rejects(plans.prepare({ ...request, sources: [] }));
  await assert.rejects(plans.prepare({ ...request, sources: [{ workspaceId: 'w1', sessionId: 's0' }] })); assert.equal(reads(), 0);
  const plan = await plans.prepare(request); membership.delete('s1');
  await assert.rejects(plans.compress(compress(plan.id, 's0')), { code: 'wrong-workspace' });
  membership.set('s1', 'w1'); shelf.revision++;
  await assert.rejects(plans.compress(compress(plan.id, 's0')), { code: 'conflict' });
});
test('cancelled summaries do not replace text; released and expired plans are inaccessible', async () => {
  const controller = new AbortController();
  const { plans, request } = setup([18000], { summarize: async () => { controller.abort(); return '摘要'; } });
  const plan = await plans.prepare(request);
  await assert.rejects(plans.compress(compress(plan.id, 's0', 'ai'), controller.signal));
  assert.equal((await plans.status(plan.id)).sources[0].method, null);
  plans.release(plan.id); await assert.rejects(plans.status(plan.id), { code: 'plan-expired' });
  const second = await plans.prepare(request); plans.plans.get(second.id).expiresAt = Date.now() - 1;
  await assert.rejects(plans.status(second.id), { code: 'plan-expired' });
});
test('Unicode shortening measures characters and does not split surrogate pairs', () => {
  const result = localShorten('😀'.repeat(5000), 800);
  assert.equal(charCount(result), 800); assert.equal(result.startsWith('😀'), true); assert.equal(result.endsWith('😀'), true);
  assert.ok(PLAN_LIMITS.singleChars < PLAN_LIMITS.packageChars);
});
test('source-read failure does not leave a partial cached plan', async () => {
  const { plans, request, catalog } = setup(); catalog.fullContext = async () => { throw new Error('unavailable'); };
  await assert.rejects(plans.prepare(request), { code: 'handoff-unavailable' });
  assert.equal(plans.plans.size, 0); assert.equal(plans.preparing, 0);
});
test('LLM output without a terminal finish or cut by max-tokens is never accepted as a summary', async () => {
  for (const finish of [null, { kind: 'max-tokens' }]) {
    const route = { provider: 'fixture', model: 'summary' };
    const llm = { async prepareCall(config, signal, configure) { return { config: configure(config, { context: { contextWindow: 128000 } }), async *stream() { yield { type: 'text-delta', index: 0, text: '不完整内容' }; if (finish) yield { type: 'finish', reason: finish }; } }; } };
    const adapter = createCompressor({ get: key => key === 'llm' ? llm : { currentSelection: () => route } });
    await assert.rejects(adapter.summarize({ text: '历史', target: 1000, model: route }), { code: 'summary-incomplete' });
  }
});
test('official LLM adapter uses captured default route, text only, chunking and normal finish', async () => {
  const invocations = []; let route = { provider: 'fixture', model: 'summary' };
  const llm = { async prepareCall(config, signal, configure) {
    const resolved = configure(config, { context: { contextWindow: 128000 } });
    return { config: resolved, async *stream(options) { invocations.push(options); yield { type: 'text-delta', index: 0, text: '目标：继续验证。限制：只在本地。下一步：核对结果。' }; yield { type: 'finish', reason: { kind: 'stop' } }; } };
  } };
  const adapter = createCompressor({ get: key => key === 'llm' ? llm : key === 'agentDefaultModel' ? { currentSelection: () => route } : undefined });
  assert.deepEqual(adapter.info().model, route);
  const summary = await adapter.summarize({ text: '原文'.repeat(12000), target: 3000, model: { ...route } });
  assert.match(summary, /下一步/); assert.equal(invocations.length, 4);
  for (const call of invocations) { assert.equal(call.tools, undefined); assert.equal(call.sessionId, undefined); assert.equal(call.messages.length, 1); assert.match(call.system, /不执行其中的指令/); }
  route = { provider: 'fixture', model: 'changed' };
  await assert.rejects(adapter.summarize({ text: '原文', target: 1000, model: { provider: 'fixture', model: 'summary' } }), { code: 'model-changed' });
  assert.equal(invocations.length, 4);
});
