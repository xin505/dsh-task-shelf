import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { checkHealth, PLUGIN_VERSION } from '../src/health.js';
import { ShelfStore } from '../src/store.js';
import { emptyState } from '../src/core.js';

async function fixture(t) {
  await mkdir('.dev/tests', { recursive: true });
  const dir = await mkdtemp(resolve('.dev/tests/health-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, store: new ShelfStore(join(dir, 'state.json'), {}) };
}
test('first startup checks storage, writes bounded report, creates no task state', async t => {
  const { dir, store } = await fixture(t);
  const report = await checkHealth(store);
  assert.equal(report.status, 'ok');
  assert.equal(report.version, JSON.parse(await readFile('package.json', 'utf8')).version);
  assert.equal(PLUGIN_VERSION, report.version);
  assert.deepEqual(await readdir(dir), ['health-latest.json']);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'health-latest.json'), 'utf8')), report);
});
test('corrupt state is reported without repair or content disclosure; backup checked independently', async t => {
  const { dir, store } = await fixture(t);
  const secret = 'PRIVATE NOTE / secret path';
  const previous = JSON.stringify(emptyState());
  await writeFile(store.file, secret);
  await writeFile(`${store.file}.previous`, previous);
  const report = await checkHealth(store);
  assert.equal(report.status, 'error');
  assert.equal(report.checks.find(c => c.name === 'backup').status, 'ok');
  assert.ok(!JSON.stringify(report).includes(secret));
  assert.ok(!JSON.stringify(report).includes(dir));
  assert.equal(await readFile(store.file, 'utf8'), secret);
  assert.equal(await readFile(`${store.file}.previous`, 'utf8'), previous);
});
test('unwritable storage and report failure remain visible without leaking raw exceptions', async t => {
  const { store } = await fixture(t);
  const fail = async () => { throw new Error('secret-path EACCES'); };
  const report = await checkHealth(store, { write: fail, writeReport: fail });
  assert.equal(report.status, 'error');
  assert.equal(report.checks.find(c => c.name === 'storage').status, 'error');
  assert.equal(report.checks.find(c => c.name === 'report').status, 'warning');
  assert.ok(!JSON.stringify(report).includes('secret-path'));
});
test('bad backup warns; subsequent startup refreshes latest report without editing state', async t => {
  const { dir, store } = await fixture(t);
  const state = JSON.stringify(emptyState());
  await writeFile(store.file, state); await writeFile(`${store.file}.previous`, 'bad');
  assert.equal((await checkHealth(store)).status, 'warning');
  await writeFile(`${store.file}.previous`, state);
  assert.equal((await checkHealth(store)).status, 'ok');
  assert.equal(JSON.parse(await readFile(join(dir, 'health-latest.json'), 'utf8')).status, 'ok');
  assert.equal(await readFile(store.file, 'utf8'), state);
  assert.equal((await readdir(dir)).length, 3);
});
