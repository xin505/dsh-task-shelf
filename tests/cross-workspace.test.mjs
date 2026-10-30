import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ShelfStore } from '../src/store.js';
import { ShelfError } from '../src/core.js';
import { createHandler } from '../src/index.js';
import { createHandoff } from '../src/handoff.js';
const op = fields => ({ operationId: randomUUID(), issuedAt: Date.now(), ...fields });
async function setup(t) {
  await mkdir('.dev/tests', { recursive: true }); const dir = await mkdtemp(resolve('.dev/tests/cross-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const workspaces = new Map([['a', { id: 'a', title: '工作区 A', sessions: ['first'] }], ['b', { id: 'b', title: '工作区 B', sessions: ['second'] }], ['c', { id: 'c', title: '交接目标 C', sessions: [] }]]), reads = [];
  const catalog = {
    async workspace(id) { if (!workspaces.has(id)) throw new ShelfError('workspace-missing', 'missing', 409); return workspaces.get(id); },
    async session(w, id) { const workspace = await this.workspace(w); if (!workspace.sessions.includes(id)) throw new ShelfError('wrong-workspace', 'moved', 409); return { id, title: `讨论 ${id}` }; },
    async context(id) { reads.push(id); return { messages: [{ role: 'user', seq: 0, text: `${id} 原文`, truncated: false }], omittedMessages: 0 }; }
  };
  const file = join(dir, 'state.json'), store = new ShelfStore(file, catalog);
  const created = await store.mutate(op({ action: 'create', workspaceId: 'a', title: '跨区任务' }));
  const mutate = fields => store.mutate(op({ shelfId: created.shelfId, ...fields }));
  await mutate({ action: 'addSession', revision: 1, sessionId: 'first' });
  return { store, file, catalog, workspaces, reads, mutate, created };
}
test('legacy data survives cross-workspace upgrade, restart, primary navigation and backup import', async t => {
  const { store, file, catalog, mutate, created } = await setup(t);
  assert.equal((await store.snapshot()).schemaVersion, 1);
  const legacy = await store.backup();
  await mutate({ action: 'addSession', revision: 2, workspaceId: 'b', sessionId: 'second' });
  const restarted = new ShelfStore(file, catalog), state = await restarted.snapshot(), shelf = state.shelves[0];
  assert.equal(state.schemaVersion, 2); assert.equal(shelf.sessionRefs[0].workspaceId, undefined);
  assert.equal(shelf.sessionRefs[1].workspaceTitle, '工作区 B');
  await mutate({ action: 'primary', revision: 3, refId: shelf.sessionRefs[1].id });
  const handler = createHandler(restarted, catalog);
  const opened = await (await handler(new Request(`http://localhost/api/task-shelf/open?id=${created.shelfId}`))).json();
  assert.equal(opened.session.id, 'second');
  const backup = await store.backup(); assert.equal(backup.schemaVersion, 2);
  await store.mutate(op({ action: 'import', backup }));
  await store.mutate(op({ action: 'import', backup: legacy }));
  const copies = (await store.snapshot()).shelves;
  assert.equal(copies.length, 3); assert.equal(copies[1].sessionRefs[1].workspaceId, 'b');
  assert.equal(copies[1].primarySessionRefId, copies[1].sessionRefs[1].id);
  assert.notEqual(copies[1].sessionRefs[1].id, shelf.sessionRefs[1].id);
  assert.equal(copies[2].sessionRefs.length, 1);
});
test('claimed workspace and duplicate cross-workspace links are checked without changing saved state', async t => {
  const { store, file, mutate } = await setup(t);
  const before = await readFile(file, 'utf8');
  await assert.rejects(mutate({ action: 'addSession', revision: 2, workspaceId: 'a', sessionId: 'second' }), { code: 'wrong-workspace' });
  assert.equal(await readFile(file, 'utf8'), before);
  await mutate({ action: 'addSession', revision: 2, workspaceId: 'b', sessionId: 'second' });
  await assert.rejects(mutate({ action: 'addSession', revision: 3, workspaceId: 'b', sessionId: 'second' }), { code: 'duplicate' });
  assert.equal((await store.snapshot()).shelves[0].sessionRefs.length, 2);
});
test('handoff uses each source membership, shows provenance in both versions and validates destination', async t => {
  const { store, catalog, reads, mutate } = await setup(t);
  await mutate({ action: 'addSession', revision: 2, workspaceId: 'b', sessionId: 'second' });
  const shelf = (await store.snapshot()).shelves[0];
  const handoff = await createHandoff(store, catalog, { shelfId: shelf.id, revision: shelf.revision, refIds: shelf.sessionRefs.map(r => r.id) });
  assert.deepEqual(reads, ['first', 'second']);
  for (const text of [handoff.text, handoff.readableText]) for (const part of ['工作区 A', '工作区 B', 'first 原文', 'second 原文']) assert.ok(text.includes(part));
  const handler = createHandler(store, catalog);
  assert.equal((await handler(new Request('http://localhost/api/task-shelf/destination?workspaceId=c'))).status, 200);
  assert.equal((await handler(new Request('http://localhost/api/task-shelf/destination?workspaceId=removed'))).status, 409);
});
test('removed or moved source rejects complete handoff, opening and entire import without content read', async t => {
  const { store, file, catalog, workspaces, reads, mutate } = await setup(t);
  await mutate({ action: 'addSession', revision: 2, workspaceId: 'b', sessionId: 'second' });
  const shelf = (await store.snapshot()).shelves[0], backup = await store.backup(), before = await readFile(file, 'utf8');
  workspaces.get('b').sessions = [];
  await assert.rejects(createHandoff(store, catalog, { shelfId: shelf.id, revision: shelf.revision, refIds: shelf.sessionRefs.map(r => r.id) }), { code: 'wrong-workspace' });
  assert.deepEqual(reads, []);
  const handler = createHandler(store, catalog);
  assert.equal((await handler(new Request(`http://localhost/api/task-shelf/open?id=${shelf.id}&refId=${shelf.sessionRefs[1].id}`))).status, 409);
  await assert.rejects(store.mutate(op({ action: 'import', backup })), { code: 'wrong-workspace' });
  workspaces.delete('b');
  await assert.rejects(createHandoff(store, catalog, { shelfId: shelf.id, revision: shelf.revision, refIds: shelf.sessionRefs.map(r => r.id) }), { code: 'workspace-missing' });
  assert.equal(await readFile(file, 'utf8'), before);
});
test('membership lost while another source is read refuses an incomplete handoff', async t => {
  const { store, catalog, workspaces, mutate } = await setup(t);
  await mutate({ action: 'addSession', revision: 2, workspaceId: 'b', sessionId: 'second' });
  const original = catalog.context; catalog.context = async id => { if (id === 'second') workspaces.get('a').sessions = []; return original(id); };
  const shelf = (await store.snapshot()).shelves[0];
  await assert.rejects(createHandoff(store, catalog, { shelfId: shelf.id, revision: shelf.revision, refIds: shelf.sessionRefs.map(r => r.id) }), { code: 'wrong-workspace' });
});
