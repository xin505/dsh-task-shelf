import { createHash, randomUUID } from 'node:crypto';

export const LIMITS = Object.freeze({ shelves: 100, sessions: 50, dataBytes: 2 * 1024 * 1024, fileBytes: 4 * 1024 * 1024, requestBytes: 64 * 1024, receipts: 4096, receiptMs: 24 * 3600 * 1000 });
export class ShelfError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export function assert(ok, code, message, status) { if (!ok) throw new ShelfError(code, message, status); }
export function text(value, max, label, allowEmpty = true) {
  assert(typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max && (allowEmpty || value.trim().length > 0), 'invalid', `${label}为空或过长。`);
  return value;
}
export function id(value) { return text(value, 256, '标识', false); }
export function object(value) { assert(value && typeof value === 'object' && !Array.isArray(value), 'invalid', '数据结构不正确。'); return value; }
function keys(value, allowed) { object(value); assert(Object.keys(value).every(key => allowed.includes(key)), 'invalid', '包含不支持的字段。'); }
function date(value) { assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'invalid', '时间格式不正确。'); return value; }
export function validateShelf(value) {
  keys(value, ['id', 'workspaceId', 'workspaceTitle', 'title', 'nextStep', 'sessionRefs', 'primarySessionRefId', 'revision', 'createdAt', 'updatedAt', 'deletedAt']);
  id(value.id); id(value.workspaceId); text(value.workspaceTitle, 512, '工作区名称');
  text(value.title, 480, '资料夹名称', false); assert([...value.title].length <= 120, 'invalid', '名称最多 120 字。');
  text(value.nextStep, 4096, '下一步');
  assert(Array.isArray(value.sessionRefs) && value.sessionRefs.length <= LIMITS.sessions, 'invalid', '关联会话过多。');
  const refs = new Set(), sessions = new Set();
  for (const ref of value.sessionRefs) {
    keys(ref, ['id', 'sessionId', 'title', 'workspaceId', 'workspaceTitle']); id(ref.id); id(ref.sessionId); text(ref.title, 512, '会话名称');
    if (ref.workspaceId !== undefined || ref.workspaceTitle !== undefined) { id(ref.workspaceId); text(ref.workspaceTitle, 512, '来源工作区名称'); }
    assert(!refs.has(ref.id) && !sessions.has(ref.sessionId), 'invalid', '存在重复会话引用。'); refs.add(ref.id); sessions.add(ref.sessionId);
  }
  assert(value.primarySessionRefId === null || refs.has(value.primarySessionRefId), 'invalid', '主会话引用无效。');
  assert(Number.isSafeInteger(value.revision) && value.revision >= 1, 'invalid', '版本号无效。');
  date(value.createdAt); date(value.updatedAt); if (value.deletedAt !== null) date(value.deletedAt);
  return value;
}
export function validateShelves(shelves) {
  assert(Array.isArray(shelves) && shelves.length <= LIMITS.shelves, 'quota', `最多 ${LIMITS.shelves} 个资料夹（含回收区）。`);
  const seen = new Set();
  for (const shelf of shelves) { validateShelf(shelf); assert(!seen.has(shelf.id), 'invalid', '资料夹 ID 重复。'); seen.add(shelf.id); }
  assert(Buffer.byteLength(JSON.stringify(shelves)) <= LIMITS.dataBytes, 'quota', '资料夹容量已达到 2 MiB，请导出后清理回收区。');
  return shelves;
}
export function emptyState() { return { schemaVersion: 1, originId: randomUUID(), shelves: [], receipts: [], imports: [] }; }
export function validateState(state) {
  keys(state, ['schemaVersion', 'originId', 'shelves', 'receipts', 'imports']);
  assert([1, 2].includes(state.schemaVersion), 'schema', '数据格式版本不受支持，请保留原文件并使用匹配的插件版本。', 503);
  id(state.originId); validateShelves(state.shelves);
  assert(Array.isArray(state.receipts) && state.receipts.length <= LIMITS.receipts, 'invalid', '操作回执损坏。');
  for (const r of state.receipts) {
    keys(r, ['operationId', 'digest', 'expiresAt', 'result']); id(r.operationId); text(r.digest, 64, '回执摘要', false);
    assert(Number.isFinite(r.expiresAt), 'invalid', '回执时间损坏。'); object(r.result);
  }
  assert(Array.isArray(state.imports) && state.imports.length <= 100, 'invalid', '导入记录损坏。'); state.imports.forEach(id);
  return state;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function digest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
export function validateOperation(request, now = Date.now()) {
  keys(request, ['operationId', 'issuedAt', 'action', 'shelfId', 'revision', 'workspaceId', 'title', 'nextStep', 'sessionId', 'refId', 'backup']);
  assert(typeof request.operationId === 'string' && /^[0-9a-f-]{36}$/i.test(request.operationId), 'invalid', '操作标识无效。');
  assert(Number.isFinite(request.issuedAt) && request.issuedAt <= now + 60000 && now - request.issuedAt < LIMITS.receiptMs, 'expired', '该操作已过期，请核对已有记录后重新操作。', 409);
  assert(['create', 'edit', 'addSession', 'removeSession', 'primary', 'trash', 'restore', 'purge', 'import'].includes(request.action), 'invalid', '不支持的操作。');
  return request;
}
export async function applyOperation(state, request, catalog, now = Date.now()) {
  validateOperation(request, now);
  const hash = digest(request);
  const prior = state.receipts.find(r => r.operationId === request.operationId);
  if (prior) { assert(prior.digest === hash, 'operation-conflict', '同一操作标识不能用于不同内容。', 409); return { result: prior.result, replay: true }; }
  state.receipts = state.receipts.filter(r => r.expiresAt > now);
  assert(state.receipts.length < LIMITS.receipts, 'receipt-quota', '今日操作回执已满，暂时无法新增写入；仍可读取和导出。', 429);
  const stamp = new Date(now).toISOString();
  let shelf, result;
  if (request.action === 'create') {
    const workspace = await catalog.workspace(id(request.workspaceId));
    shelf = { id: randomUUID(), workspaceId: workspace.id, workspaceTitle: workspace.title, title: text(request.title, 480, '名称', false).trim(), nextStep: '', sessionRefs: [], primarySessionRefId: null, revision: 1, createdAt: stamp, updatedAt: stamp, deletedAt: null };
    state.shelves.push(shelf);
  } else if (request.action === 'import') {
    const backup = object(request.backup);
    assert(backup.format === 'dsh-task-shelf-alpha' && [1, 2].includes(backup.schemaVersion), 'schema', '请选择本试用版导出的 JSON 备份。');
    id(backup.exportId); validateShelves(backup.shelves);
    assert(!state.imports.includes(backup.exportId), 'duplicate-import', '这份备份已经导入，未重复创建资料夹。', 409);
    assert(state.imports.length < 100, 'quota', '导入历史已满，暂不接受更多导入。');
    const imported = [];
    for (const original of backup.shelves) {
      const workspace = await catalog.workspace(original.workspaceId);
      const next = structuredClone(original);
      next.id = randomUUID(); next.workspaceTitle = workspace.title; next.revision = 1; next.updatedAt = stamp;
      for (const ref of next.sessionRefs) {
        const sourceWorkspace = ref.workspaceId ? await catalog.workspace(ref.workspaceId) : workspace;
        const session = await catalog.session(sourceWorkspace.id, ref.sessionId, true);
        ref.title = session.title;
        if (ref.workspaceId) ref.workspaceTitle = sourceWorkspace.title;
        const old = ref.id; ref.id = randomUUID(); if (next.primarySessionRefId === old) next.primarySessionRefId = ref.id;
      }
      imported.push(next);
    }
    state.shelves.push(...imported); state.imports.push(backup.exportId);
    result = { imported: imported.length, shelfId: imported[0]?.id ?? null };
  } else {
    shelf = state.shelves.find(s => s.id === id(request.shelfId));
    assert(shelf, 'missing', '资料夹已不存在，请刷新。', 404);
    assert(shelf.revision === request.revision, 'conflict', '其他窗口已修改此资料夹。草稿已保留，请复制草稿或重新加载。', 409);
    assert(!shelf.deletedAt || ['restore', 'purge'].includes(request.action), 'deleted', '资料夹在回收区，请先恢复。', 409);
    switch (request.action) {
      case 'edit': shelf.title = text(request.title, 480, '名称', false).trim(); shelf.nextStep = text(request.nextStep, 4096, '下一步'); break;
      case 'addSession': {
        const sourceId = request.workspaceId === undefined ? shelf.workspaceId : id(request.workspaceId);
        const workspace = await catalog.workspace(sourceId);
        const session = await catalog.session(sourceId, id(request.sessionId));
        assert(!shelf.sessionRefs.some(r => r.sessionId === session.id), 'duplicate', '这个会话已经关联。', 409);
        shelf.sessionRefs.push({ id: randomUUID(), sessionId: session.id, title: session.title, ...(sourceId === shelf.workspaceId ? {} : { workspaceId: workspace.id, workspaceTitle: workspace.title }) }); break;
      }
      case 'removeSession': {
        assert(shelf.sessionRefs.some(r => r.id === request.refId), 'missing', '会话引用已不存在。', 404);
        shelf.sessionRefs = shelf.sessionRefs.filter(r => r.id !== request.refId);
        if (shelf.primarySessionRefId === request.refId) shelf.primarySessionRefId = null;
        break;
      }
      case 'primary':
        if (request.refId !== null) { const ref = shelf.sessionRefs.find(r => r.id === request.refId); assert(ref, 'missing', '会话引用已不存在。', 404); await catalog.session(ref.workspaceId ?? shelf.workspaceId, ref.sessionId); }
        shelf.primarySessionRefId = request.refId; break;
      case 'trash': shelf.deletedAt = stamp; break;
      case 'restore': shelf.deletedAt = null; break;
      case 'purge': assert(shelf.deletedAt, 'invalid', '请先移入回收区。'); state.shelves = state.shelves.filter(s => s.id !== shelf.id); break;
    }
    shelf.revision++; shelf.updatedAt = stamp;
  }
  validateShelves(state.shelves);
  if (state.shelves.some(s => s.sessionRefs.some(r => r.workspaceId !== undefined))) state.schemaVersion = 2;
  result ??= { shelfId: shelf.id, revision: shelf.revision, purged: request.action === 'purge' };
  state.receipts.push({ operationId: request.operationId, digest: hash, expiresAt: request.issuedAt + LIMITS.receiptMs, result });
  return { result, replay: false };
}
