import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium, request: requests } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { url } = JSON.parse(await readFile('.dev/server.json', 'utf8'));
const f = JSON.parse(await readFile('.dev/fixture.json', 'utf8')), base = new URL(url).origin;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
const page = await context.newPage(), results = [], errors = [];
page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
const check = label => { results.push(label); console.log('PASS', label); };
const get = async path => (await context.request.get(`${base}/api/task-shelf/${path}`)).json();
async function mutate(body) {
  const value = await (await context.request.post(`${base}/api/task-shelf/mutate`, { data: { operationId: randomUUID(), issuedAt: Date.now(), ...body } })).json();
  assert.equal(value.ok, true, JSON.stringify(value)); return value.result;
}
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '任务资料夹', exact: true }).waitFor(); await page.waitForTimeout(700);
  const welcome = page.getByRole('button', { name: '继续', exact: true }); if (await welcome.isVisible()) await welcome.click();
  const close = page.getByRole('button', { name: /^(关闭|Close)$/ }); if (await close.count()) await close.last().click();
  const title = `跨工作区验收 ${Date.now()}`;
  const { shelfId } = await mutate({ action: 'create', workspaceId: f.workspaceId, title });
  await mutate({ action: 'addSession', shelfId, revision: 1, sessionId: f.sessionId });
  await page.getByRole('button', { name: '任务资料夹', exact: true }).click();
  await page.getByLabel('工作区', { exact: true }).selectOption(f.workspaceId);
  await page.locator('.ts-card').filter({ hasText: title }).click();
  await page.getByRole('button', { name: '＋ 关联会话', exact: true }).click();
  await page.getByLabel('会话来源工作区', { exact: true }).selectOption(f.foreignWorkspaceId);
  await page.locator('.ts-picker button').filter({ hasText: '任务资料夹 · 跨区合成讨论' }).click();
  await page.locator('.ts-session').filter({ hasText: '任务资料夹 · 跨区合成讨论' }).waitFor();
  assert.equal(await page.locator('.ts-session').count(), 2);
  let shelf = (await get(`shelves?id=${shelfId}`)).shelf;
  assert.equal(shelf.sessionRefs[1].workspaceId, f.foreignWorkspaceId);
  assert.equal(shelf.workspaceId, f.workspaceId);
  check('Source workspace picker links a foreign session while keeping the folder in its original workspace');

  // A delayed old-workspace response must never populate the new workspace picker.
  await page.getByRole('button', { name: '＋ 关联会话', exact: true }).click();
  await page.locator('.ts-picker button').filter({ hasText: '任务资料夹 · 合成讨论' }).waitFor();
  let release, captured; const gate = new Promise(r => { release = r; }), held = new Promise(r => { captured = r; });
  await page.route('**/api/task-shelf/catalog?*', async route => {
    if (new URL(route.request().url()).searchParams.get('workspaceId') !== f.foreignWorkspaceId) return route.continue();
    const response = await route.fetch(); captured(); await gate; await route.fulfill({ response });
  });
  await page.getByLabel('会话来源工作区', { exact: true }).selectOption(f.foreignWorkspaceId); await held;
  await page.getByLabel('会话来源工作区', { exact: true }).selectOption(f.workspaceId);
  await page.locator('.ts-picker button').filter({ hasText: '任务资料夹 · 合成讨论' }).waitFor();
  release(); await page.waitForTimeout(250); await page.unroute('**/api/task-shelf/catalog?*');
  assert.equal(await page.locator('.ts-picker button').filter({ hasText: '跨区合成讨论' }).count(), 0);
  await page.getByRole('button', { name: '收起选择', exact: true }).click();
  check('Rapid source-workspace switching discards a late response from the previous workspace');

  const foreignRow = page.locator('.ts-session').filter({ hasText: '任务资料夹 · 跨区合成讨论' });
  await foreignRow.getByRole('button', { name: '设为主会话', exact: true }).click();
  await page.getByText('主会话 · 继续任务将打开这里', { exact: true }).waitFor();
  await page.getByRole('button', { name: '继续任务 ↗', exact: true }).click();
  await page.locator('.ts-root').waitFor({ state: 'hidden' });
  await page.getByText('另一工作区的合成讨论：交接时保留来源工作区，不移动原会话。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '任务资料夹', exact: true }).click();
  check('A foreign primary conversation opens through the native DSH session view');
  const checks = page.locator('.ts-handoff input[type=checkbox]'); await checks.first().check(); await checks.last().check();
  await page.getByRole('button', { name: '生成交接包', exact: true }).click();
  const raw = page.getByLabel('交接包预览与编辑', { exact: true }), human = page.getByLabel('易读版预览与编辑', { exact: true });
  await human.waitFor(); const rawText = await raw.inputValue(), humanText = await human.inputValue();
  for (const text of [rawText, humanText]) for (const part of ['插件试用项目', '跨工作区来源项目', '这是一条本地合成会话', '另一工作区的合成讨论']) assert.ok(text.includes(part));
  assert.ok(rawText.includes(f.foreignWorkspaceId)); assert.ok(!humanText.includes(f.foreignWorkspaceId));
  check('Both handoff versions combine two workspaces and retain readable source provenance');
  await page.getByLabel('交接目标工作区', { exact: true }).selectOption(f.targetWorkspaceId);
  assert.equal(await raw.inputValue(), rawText); assert.equal(await human.inputValue(), humanText);
  await mkdir('docs/screenshots', { recursive: true }); await page.locator('.ts-handoff').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/handoff-cross-workspace-alpha.4.png' });
  await page.setViewportSize({ width: 650, height: 1100 });
  assert.equal(await page.locator('.ts-root').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  await page.setViewportSize({ width: 1500, height: 1200 });
  const targetBefore = (await get(`catalog?workspaceId=${encodeURIComponent(f.targetWorkspaceId)}`)).items.map(s => s.id);
  await page.getByRole('button', { name: '带入新会话草稿', exact: true }).click();
  await page.locator('.ts-root').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => [...document.querySelectorAll('textarea,[contenteditable=true]')].some(el => (el.value ?? el.textContent).includes('另一工作区的合成讨论')));
  const targetAfter = (await get(`catalog?workspaceId=${encodeURIComponent(f.targetWorkspaceId)}`)).items;
  // DSH may create an empty C session on initial navigation and reuse it here.
  assert.ok(targetAfter.length >= Math.max(1, targetBefore.length), 'target workspace must retain its blank session');
  await page.getByText('跨工作区交接目标', { exact: true }).last().waitFor();
  await page.screenshot({ path: '.dev/cross-workspace-native-draft.png' });
  for (const [workspace, session] of [[f.workspaceId, f.sessionId], [f.foreignWorkspaceId, f.foreignSessionId]]) {
    assert.ok((await get(`catalog?workspaceId=${encodeURIComponent(workspace)}`)).items.some(s => s.id === session));
    assert.ok(!targetAfter.some(s => s.id === session), 'source conversations must not move');
  }
  check('A+B handoff enters a native blank-session draft in workspace C; source sessions stay in place; narrow layout fits');
  // This isolated profile has no model credentials; the host may show a delayed welcome dialog.
  await page.addLocatorHandler(page.getByRole('button', { name: /^(关闭|Close)$/ }).last(), async locator => locator.click());
  await page.getByRole('button', { name: '任务资料夹', exact: true }).click();
  await page.getByLabel('交接目标工作区', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('交接目标工作区', { exact: true }).inputValue(), f.targetWorkspaceId);
  const backup = await get('export'); backup.shelves = backup.shelves.filter(s => s.id === shelfId);
  assert.equal(backup.schemaVersion, 2);
  await page.locator('input[type=file]').setInputFiles({ name: 'cross-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.getByRole('button', { name: '确认新增导入', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已导入 1 个资料夹' }).waitFor();
  assert.equal(await page.locator('.ts-session').count(), 2);
  assert.match(await page.locator('.ts-session').last().innerText(), /跨工作区来源项目/);
  check('Target choice persists across panel switches; UI imports schema-2 backup with cross-workspace references');
  const anonymous = await requests.newContext();
  assert.equal((await anonymous.get(`${base}/api/task-shelf/destination?workspaceId=${f.targetWorkspaceId}`)).status(), 401); await anonymous.dispose();
  assert.deepEqual(errors, []); check('Destination validation uses host authentication and no uncaught page errors occurred');
  await writeFile('.dev/cross-workspace-results.json', JSON.stringify({ testedAt: new Date().toISOString(), results, errors }, null, 2));
} catch(e) {
  await page.screenshot({ path: '.dev/cross-workspace-failure.png' }); console.error((await page.locator('body').innerText()).slice(-5000)); throw e;
} finally { await browser.close(); }
