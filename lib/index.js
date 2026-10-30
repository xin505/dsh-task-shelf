import { join } from 'node:path';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { ShelfStore } from './store.js';
import { checkHealth } from './health.js';
import { createHandoff, readContext } from './handoff.js';
import { HandoffPlans } from './handoff-plan.js';
import { createCompressor } from './handoff-compressor.js';
import { LIMITS, ShelfError, assert, id } from './core.js';

export const name = 'dsh-task-shelf';
export const inject = ['connection', 'workspaceRegistry', 'sessionPersistence'];
const safeTitle = value => [...String(value || '未命名')].slice(0, 120).join('');
export function createCatalog(ctx) {
  return {
    context(sessionId, signal) { return readContext(ctx, sessionId, signal); },
    fullContext(sessionId, signal) { return readContext(ctx, sessionId, signal, true); },
    async workspace(workspaceId) {
      const workspace = ctx.workspaceRegistry.get(workspaceId);
      assert(workspace, 'workspace-missing', '工作区已移除，请先在 DSH 中恢复或选择有效工作区。', 409);
      return { id: workspace.id, title: safeTitle(workspace.title), sessionIds: workspace.sessionIds };
    },
    async session(workspaceId, sessionId, allowArchived = false) {
      const workspace = await this.workspace(workspaceId);
      assert(workspace.sessionIds.includes(sessionId), 'wrong-workspace', '会话不属于所选工作区，未进行关联或跳转。', 409);
      const archived = ctx.workspaceRegistry.archivedSessionIds.includes(sessionId);
      assert(allowArchived || !archived, 'archived', '会话已归档，请先在 DSH 中取消归档。', 409);
      const live = ctx.get('sessions')?.get(sessionId);
      let header = live?.header;
      if (!header) {
        try { header = (await ctx.sessionPersistence.stat(sessionId)).header; }
        catch { throw new ShelfError('session-unavailable', '暂时无法读取这个会话，请在 DSH 中确认它仍可打开。', 409); }
      }
      let title;
      try {
        const cache = ctx.get('sessionProjectionCache');
        const projection = live ? ctx.get('sessionProjections')?.cachedSnapshot(live) : cache?.cachedSnapshot(header) ?? cache?.cachedPredecessorTitle(header);
        title = projection?.values?.title;
      } catch { /* A missing title hint does not make a valid session inaccessible. */ }
      return { id: sessionId, title: safeTitle(title || sessionId), archived };
    },
    async workspaces() { return ctx.workspaceRegistry.list().map(w => ({ id: w.id, title: safeTitle(w.title) })); },
    async sessions(workspaceId, offset = 0) {
      const workspace = await this.workspace(workspaceId);
      const ids = workspace.sessionIds.slice(offset, offset + 30);
      const values = await Promise.all(ids.map(async sessionId => { try { return await this.session(workspaceId, sessionId, true); } catch { return { id: sessionId, title: sessionId, unavailable: true }; } }));
      return { items: values, nextOffset: offset + ids.length < workspace.sessionIds.length ? offset + ids.length : null };
    }
  };
}
export async function readJson(request, max) {
  assert((Number(request.headers.get('content-length')) || 0) <= max, 'too-large', '请求过大。', 413);
  assert(request.headers.get('content-type')?.split(';')[0].trim() === 'application/json', 'content-type', '需要 JSON 数据。', 415);
  const reader = request.body?.getReader(); assert(reader, 'invalid', '请求内容为空。');
  let size = 0; const chunks = [];
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; assert(size <= max, 'too-large', '请求过大。', 413); chunks.push(value); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ShelfError('invalid', 'JSON 格式不正确。'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function json(value, status = 200) { return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }); }
export function createHandler(store, catalog, compressor) {
  const plans = new HandoffPlans(store, catalog, compressor);
  return async request => {
    try {
      const url = new URL(request.url), route = url.pathname.split('/').at(-1);
      if (request.method === 'POST') {
        const body = await readJson(request, route === 'import' ? LIMITS.dataBytes + 65536 : LIMITS.requestBytes);
        if (route === 'handoff-plan') return json({ ok: true, plan: await plans.prepare(body, request.signal) });
        if (route === 'handoff-compress') return json({ ok: true, plan: await plans.compress(body, request.signal) });
        if (route === 'handoff-release') { plans.release(body.planId); return json({ ok: true }); }
        if (route === 'handoff') return json({ ok: true, handoff: await createHandoff(store, catalog, body, request.signal) });
        assert(route === 'import' ? body.action === 'import' : body.action !== 'import', 'invalid', '导入必须使用专用入口。');
        return json({ ok: true, result: await store.mutate(body) });
      }
      if (route === 'catalog') {
        const workspaceId = url.searchParams.get('workspaceId');
        if (!workspaceId) return json({ ok: true, workspaces: await catalog.workspaces() });
        const offset = Number(url.searchParams.get('offset') || 0); assert(Number.isSafeInteger(offset) && offset >= 0, 'invalid', '分页参数不正确。');
        return json({ ok: true, ...await catalog.sessions(id(workspaceId), offset) });
      }
      if (route === 'destination') return json({ ok: true, workspace: await catalog.workspace(id(url.searchParams.get('workspaceId'))) });
      if (route === 'handoff-options') return json({ ok: true, ...(compressor?.info() ?? { model: null }) });
      if (route === 'handoff-status') return json({ ok: true, plan: await plans.status(url.searchParams.get('id')) });
      if (route === 'operation') return json({ ok: true, ...await store.operation(id(url.searchParams.get('id'))) });
      if (route === 'export') return json(await store.backup(url.searchParams.get('previous') === '1'));
      const state = await store.snapshot();
      const shelfId = url.searchParams.get('id');
      if (route === 'open') {
        const shelf = state.shelves.find(s => s.id === shelfId && !s.deletedAt);
        assert(shelf, 'missing', '资料夹不存在或已移入回收区。', 404);
        const refId = url.searchParams.get('refId') || shelf.primarySessionRefId;
        const ref = shelf.sessionRefs.find(r => r.id === refId);
        assert(ref, 'no-primary', '请先关联会话并设为主会话。', 409);
        return json({ ok: true, session: await catalog.session(ref.workspaceId ?? shelf.workspaceId, ref.sessionId) });
      }
      if (shelfId) { const shelf = state.shelves.find(s => s.id === shelfId); assert(shelf, 'missing', '资料夹已不存在。', 404); return json({ ok: true, shelf }); }
      const offset = Number(url.searchParams.get('offset') || 0);
      assert(Number.isSafeInteger(offset) && offset >= 0, 'invalid', '分页参数不正确。');
      return json({ ok: true, shelves: state.shelves.slice(offset, offset + 20).map(({ sessionRefs, nextStep, ...s }) => ({ ...s, nextStep: [...nextStep].slice(0, 100).join(''), sessionCount: sessionRefs.length })), nextOffset: offset + 20 < state.shelves.length ? offset + 20 : null });
    } catch (error) {
      return json({ ok: false, code: error instanceof ShelfError ? error.code : 'storage', message: error instanceof ShelfError ? error.message : '操作未完成，请保留草稿并查询结果或稍后重试。' }, error instanceof ShelfError ? error.status : 503);
    }
  };
}
export function apply(ctx) {
  const catalog = createCatalog(ctx);
  const store = new ShelfStore(join(resolveDshHome(), 'task-shelf', 'state.json'), catalog);
  const handler = createHandler(store, catalog, createCompressor(ctx));
  const health = checkHealth(store).catch(() => ({ format: 'dsh-task-shelf-health', status: 'error', checkedAt: new Date().toISOString(), checks: [{ name: 'startup', status: 'error', message: '启动自检未完成，请查看 DSH 插件错误提示。' }] }));
  health.then(report => { if (report.status !== 'ok') console.warn('[dsh-task-shelf] Startup health:', JSON.stringify(report)); });
  // Connection owns authentication, owner-only admission, desktop IPC and disposal.
  ctx.connection.fetch.register({ path: '/api/task-shelf/health', methods: ['GET'], requestBody: 'buffered', fetch: async () => json({ ok: true, health: await health }) });
  for (const route of ['shelves', 'catalog', 'operation', 'export', 'open', 'destination', 'handoff-options', 'handoff-status']) ctx.connection.fetch.register({ path: `/api/task-shelf/${route}`, methods: ['GET'], requestBody: 'buffered', fetch: handler });
  for (const route of ['mutate', 'import', 'handoff', 'handoff-plan', 'handoff-compress', 'handoff-release']) ctx.connection.fetch.register({ path: `/api/task-shelf/${route}`, methods: ['POST'], requestBody: 'streaming', fetch: handler });
}
