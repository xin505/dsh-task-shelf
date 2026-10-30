import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ShelfStore } from '../src/store.js';
import { ShelfError } from '../src/core.js';
import { createHandler } from '../src/index.js';
import { mkdir } from 'node:fs/promises';

const catalog = {
  async workspace(id) { if (id !== 'workspace-a') throw new ShelfError('missing', 'workspace missing'); return { id, title: '合成项目' }; },
  async session(workspaceId, sessionId) { await this.workspace(workspaceId); if (sessionId !== 'session-a') throw new ShelfError('wrong-workspace', 'wrong workspace'); return { id: sessionId, title: '合成会话' }; },
  async workspaces() { return [{ id: 'workspace-a', title: '合成项目' }]; }
};
const op = fields => ({ operationId: randomUUID(), issuedAt: Date.now(), ...fields });
async function fixture(t, io) {
  await mkdir('.dev/tests', { recursive: true }); const dir = await mkdtemp(resolve('.dev/tests/store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new ShelfStore(join(dir, 'state.json'), catalog, io);
  const created = await store.mutate(op({ action: 'create', workspaceId: 'workspace-a', title: '测试任务' }));
  return { store, dir, created };
}
test('restart preserves data; replay does not create twice; altered replay rejected', async t => {
  const { store, dir } = await fixture(t);
  const request = op({ action: 'create', workspaceId: 'workspace-a', title: '第二个任务' });
  const a = await store.mutate(request);
  const restarted = new ShelfStore(join(dir, 'state.json'), catalog);
  assert.deepEqual(await restarted.mutate(request), a);
  assert.equal((await restarted.snapshot()).shelves.length, 2);
  await assert.rejects(restarted.mutate({ ...request, title: '篡改' }), { code: 'operation-conflict' });
});
test('independent stores serialize competing writes; stale revision cannot overwrite', async t => {
  const { store, dir, created } = await fixture(t);
  const other = new ShelfStore(join(dir, 'state.json'), catalog);
  const requests = ['A', 'B'].map(title => op({ action: 'edit', shelfId: created.shelfId, revision: 1, title, nextStep: title }));
  const results = await Promise.allSettled([store.mutate(requests[0]), other.mutate(requests[1])]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'conflict');
  assert.equal((await store.snapshot()).shelves[0].revision, 2);
});
test('foreign sessions rejected; removing primary clears pointer atomically', async t => {
  const { store, created } = await fixture(t);
  await assert.rejects(store.mutate(op({ action: 'addSession', shelfId: created.shelfId, revision: 1, sessionId: 'foreign' })), { code: 'wrong-workspace' });
  await store.mutate(op({ action: 'addSession', shelfId: created.shelfId, revision: 1, sessionId: 'session-a' }));
  const ref = (await store.snapshot()).shelves[0].sessionRefs[0].id;
  await store.mutate(op({ action: 'primary', shelfId: created.shelfId, revision: 2, refId: ref }));
  await store.mutate(op({ action: 'removeSession', shelfId: created.shelfId, revision: 3, refId: ref }));
  assert.equal((await store.snapshot()).shelves[0].primarySessionRefId, null);
});
test('trash, restore and explicit purge never touch the host session', async t => {
  const { store, created } = await fixture(t);
  await store.mutate(op({ action: 'trash', shelfId: created.shelfId, revision: 1 }));
  assert.ok((await store.snapshot()).shelves[0].deletedAt);
  await store.mutate(op({ action: 'restore', shelfId: created.shelfId, revision: 2 }));
  assert.equal((await store.snapshot()).shelves[0].deletedAt, null);
  await assert.rejects(store.mutate(op({ action: 'purge', shelfId: created.shelfId, revision: 3 })), { code: 'invalid' });
});
test('corrupt state is preserved; previous generation remains exportable', async t => {
  const { store, dir, created } = await fixture(t);
  await store.mutate(op({ action: 'edit', shelfId: created.shelfId, revision: 1, title: '新标题', nextStep: '新便签' }));
  await writeFile(join(dir, 'state.json'), '{broken');
  await assert.rejects(store.mutate(op({ action: 'create', workspaceId: 'workspace-a', title: '不能写入' })), { code: 'corrupt' });
  assert.equal(await readFile(join(dir, 'state.json'), 'utf8'), '{broken');
  assert.equal((await store.backup(true)).shelves[0].title, '测试任务');
});
test('failed replacement preserves old live data and receipt absence', async t => {
  const { store, dir, created } = await fixture(t);
  const fail = new ShelfStore(join(dir, 'state.json'), catalog, { write: async (file, value, options) => { if (file.endsWith('state.json')) throw new Error('disk-full'); return store.write(file, value, options); } });
  const request = op({ action: 'edit', shelfId: created.shelfId, revision: 1, title: '不会保存', nextStep: '' });
  await assert.rejects(fail.mutate(request), /disk-full/);
  assert.equal((await store.snapshot()).shelves[0].title, '测试任务');
  assert.equal((await store.operation(request.operationId)).status, 'unknown');
});
test('backup import remaps local IDs, preserves contents, blocks duplicate; invalid batch has zero effect', async t => {
  const { store, created } = await fixture(t);
  await store.mutate(op({ action: 'addSession', shelfId: created.shelfId, revision: 1, sessionId: 'session-a' }));
  const original = (await store.snapshot()).shelves[0];
  await store.mutate(op({ action: 'primary', shelfId: original.id, revision: 2, refId: original.sessionRefs[0].id }));
  const backup = await store.backup();
  await store.mutate(op({ action: 'import', backup }));
  const copied = (await store.snapshot()).shelves[1];
  assert.notEqual(copied.id, original.id); assert.notEqual(copied.sessionRefs[0].id, original.sessionRefs[0].id);
  assert.equal(copied.primarySessionRefId, copied.sessionRefs[0].id);
  await assert.rejects(store.mutate(op({ action: 'import', backup })), { code: 'duplicate-import' });
  const invalid = structuredClone(backup); invalid.exportId = randomUUID(); invalid.shelves[0].sessionRefs[0].sessionId = 'foreign';
  await assert.rejects(store.mutate(op({ action: 'import', backup: invalid })), { code: 'wrong-workspace' });
  assert.equal((await store.snapshot()).shelves.length, 2);
});
test('HTTP parser rejects oversized, polluted, expired or unknown-schema writes', async t => {
  const { store } = await fixture(t), handler = createHandler(store, catalog);
  const post = data => handler(new Request('http://localhost/api/task-shelf/mutate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: data }));
  assert.equal((await post(' '.repeat(65537))).status, 413);
  assert.equal((await post('{"__proto__":{"polluted":true}}')).status, 400);
  assert.equal({}.polluted, undefined);
  assert.equal((await post(JSON.stringify({ ...op({ action: 'create', workspaceId: 'workspace-a', title: 'x' }), issuedAt: Date.now() - 90000000 }))).status, 409);
});
