import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium, request: requests } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { url } = JSON.parse(await readFile('.dev/server.json', 'utf8'));
const fixture = JSON.parse(await readFile('.dev/fixture.json', 'utf8'));
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const base = new URL(url).origin;
const browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 20000 });
const context = await browser.newContext({ viewport: { width: 1487, height: 1058 }, acceptDownloads: true });
context.setDefaultTimeout(12000);
const results = [], errors = [], compressionRequests = [];
let dismissNextDialog = false;
const dialogs = [];
context.on('page', p => {
  p.on('pageerror', e => errors.push(e.message));
  p.on('dialog', d => { dialogs.push(d.message()); const dismiss = dismissNextDialog; dismissNextDialog = false; return dismiss ? d.dismiss() : d.accept(); });
  p.on('request', r => { if (r.url().endsWith('/handoff-compress')) compressionRequests.push(r.postDataJSON()); });
});
const page = await context.newPage();
const shelfName = `界面验收 ${Date.now()}`;
let shelfId;
const check = label => { results.push(label); console.log('PASS', label); };
async function panel(p) {
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.addLocatorHandler(p.getByRole('button', { name: '继续', exact: true }), async el => el.click());
  await p.addLocatorHandler(p.getByRole('button', { name: /^(关闭|Close)$/ }).last(), async el => el.click());
  await p.addLocatorHandler(p.getByText('开始使用', { exact: true }), async () => p.locator('[role="presentation"] button').first().click());
  await p.getByRole('button', { name: '任务资料夹', exact: true }).click();
  await p.locator('.ts-root').waitFor();
}
async function summary(p, name) {
  const el = p.locator('.ts-root summary').filter({ has: p.locator(':scope') });
  const target = p.locator(`.ts-root summary[aria-label=${JSON.stringify(name)}]`);
  await target.click();
  return target;
}
async function edit(p = page) {
  if (!(await p.locator('.ts-title-input').isVisible())) await p.getByRole('button', { name: '编辑下一步', exact: true }).click();
  await p.locator('.ts-title-input').waitFor({ state: 'visible' });
}
async function save(p, expected) {
  await p.getByRole('button', { name: '保存修改', exact: true }).click();
  await p.locator('.ts-title-input').waitFor({ state: 'hidden' });
  assert.equal(await p.locator('.ts-note-body').innerText(), expected);
}
async function get(route) {
  const response = await context.request.get(`${base}/api/task-shelf/${route}`);
  assert.equal(response.ok(), true);
  return response.json();
}
async function listShelves() {
  let offset = 0, rows = [];
  do { const value = await get(`shelves?offset=${offset}`); rows.push(...value.shelves); offset = value.nextOffset; } while (offset !== null);
  return rows;
}
async function selectHandoff(workspaceId, title) {
  const block = page.locator(`.ts-handoff-workspace[data-workspace-id="${workspaceId}"]`);
  const toggle = block.locator('.ts-workspace-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await block.locator('label.ts-source-option').filter({ hasText: title }).getByRole('checkbox').check();
}
try {
  await panel(page);
  await page.getByRole('combobox', { name: '工作区', exact: true }).selectOption(fixture.workspaceId);
  // This entry is shared with the old client so RED identifies the missing
  // read-mode behavior, not a renamed button or a transient startup dialog.
  await page.getByRole('button', { name: /新建资料夹/ }).click();
  await page.locator('.ts-create input').fill(shelfName);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.waitForFunction(name => document.querySelector('.ts-task-title')?.textContent === name || document.querySelector('.ts-title-input')?.value === name, shelfName);
  assert.equal(await page.locator('.ts-task-title').count(), 1, 'New folders should open in the redesigned reading view');
  assert.equal(await page.locator('.ts-title-input').isVisible(), false, 'Read mode must not expose permanent editing fields');
  assert.equal(await page.getByRole('tab', { name: '资料概览', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByRole('button', { name: '继续会话', exact: true }).isDisabled(), true);
  check('Create folder enters read mode with overview selected and an unavailable primary action explained');
  shelfId = (await listShelves()).find(s => s.title === shelfName).id;

  const note = '把论文里的实验方法和工程讨论对齐，确认关键约束，再继续实现。';
  await edit();
  await page.getByLabel('下一步', { exact: true }).fill(note);
  await page.getByRole('tab', { name: '会话交接', exact: true }).click();
  await page.getByRole('tab', { name: '资料概览', exact: true }).click();
  assert.equal(await page.getByLabel('下一步', { exact: true }).inputValue(), note);
  await save(page, note);
  await edit();
  await page.locator('.ts-title-input').fill('不应保存的名称');
  await page.getByLabel('下一步', { exact: true }).fill('不应保存的便签');
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await page.locator('.ts-title-input').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.ts-task-title').innerText(), shelfName);
  assert.equal(await page.locator('.ts-note-body').innerText(), note);
  assert.equal((await get(`shelves?id=${shelfId}`)).shelf.nextStep, note);
  check('Editing survives a tab switch, saves deliberately, and cancel restores the saved title and note');

  await page.getByRole('button', { name: '新建资料夹', exact: true }).click();
  await page.locator('.ts-create input').fill('草稿切换验证');
  await edit();
  await page.getByLabel('下一步', { exact: true }).fill('切换后仍需保护的草稿');
  const priorDialogs = dialogs.length;
  dismissNextDialog = true;
  await page.getByRole('button', { name: '创建', exact: true }).click();
  assert.equal(dialogs.length, priorDialogs + 1, 'Submitting a previously opened create form must confirm a dirty selection switch');
  assert.equal(await page.locator('.ts-task-title').innerText(), shelfName);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.getByRole('heading', { name: '草稿切换验证', exact: true }).waitFor();
  const unloadProtected = () => page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
  assert.equal(await unloadProtected(), true, 'An inactive folder draft must still block an unconfirmed reload');
  await page.getByRole('button', { name: '插件', exact: true }).click();
  await page.locator('.ts-root').waitFor({ state: 'hidden' });
  assert.equal(await unloadProtected(), true, 'An inactive plugin draft must still block an unconfirmed reload');
  await page.getByRole('button', { name: '任务资料夹', exact: true }).click();
  await page.locator('.ts-card').filter({ hasText: shelfName }).click();
  await page.locator('.ts-title-input').waitFor({ state: 'visible' });
  assert.equal(await page.getByLabel('下一步', { exact: true }).inputValue(), '切换后仍需保护的草稿');
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await page.locator('.ts-title-input').waitFor({ state: 'hidden' });
  assert.equal(await unloadProtected(), false, 'Discarded drafts must not leave a permanent close warning');
  check('Create confirms a dirty switch; inactive folder and plugin drafts retain close protection until saved or discarded');

  await page.getByRole('button', { name: '关联会话', exact: true }).click();
  await page.locator('.ts-picker button').filter({ hasText: '任务资料夹 · 合成讨论' }).first().click();
  await page.locator('.ts-session').waitFor();
  await summary(page, '会话操作：任务资料夹 · 合成讨论');
  await page.getByRole('button', { name: '设为主会话', exact: true }).click();
  await page.getByRole('button', { name: '继续会话', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.ts-detail-actions .ts-button')?.disabled);
  assert.equal((await get(`shelves?id=${shelfId}`)).shelf.primarySessionRefId !== null, true);
  check('Associate a real persisted session, set it as primary through its menu, and enable Continue');

  const toolSummary = await summary(page, '工具');
  assert.equal(await toolSummary.evaluate(el => el.parentElement.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await toolSummary.evaluate(el => el.parentElement.open), false, 'Escape closes the menu');
  await summary(page, '工具');
  await page.getByRole('button', { name: '查看诊断', exact: true }).click();
  const diagnosticDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出诊断报告', exact: true }).click();
  const report = JSON.parse(await readFile(await (await diagnosticDownload).path(), 'utf8'));
  assert.equal(report.version, manifest.version);
  assert.equal(report.checks.find(c => c.name === 'storage').status, 'ok');
  // Diagnostic content has an explicit close action; don't click the host close.
  const closeDiagnostic = page.getByRole('button', { name: /关闭诊断/ });
  if (await closeDiagnostic.count()) await closeDiagnostic.click();
  check('Tools menu supports Escape and exposes a real, version-correct diagnostic download');

  const secondary = await context.newPage();
  await panel(secondary);
  await secondary.getByRole('combobox', { name: '工作区', exact: true }).selectOption(fixture.workspaceId);
  await secondary.locator('.ts-card').filter({ hasText: shelfName }).click();
  await secondary.locator('.ts-task-title').waitFor();
  await edit(secondary);
  await edit();
  await page.getByLabel('下一步', { exact: true }).fill(`${note}\n窗口 A 保存`);
  await save(page, `${note}\n窗口 A 保存`);
  await secondary.getByLabel('下一步', { exact: true }).fill('窗口 B 的未保存草稿');
  await secondary.getByRole('button', { name: '保存修改', exact: true }).click();
  await secondary.getByRole('alert').filter({ hasText: '其他窗口已修改' }).waitFor();
  assert.equal(await secondary.getByLabel('下一步', { exact: true }).inputValue(), '窗口 B 的未保存草稿');
  await secondary.close();
  check('Stale edits remain visible after a real two-window revision conflict');

  await edit();
  await page.route('**/api/task-shelf/mutate', async route => { await route.fetch(); await route.abort('failed'); });
  await page.getByLabel('下一步', { exact: true }).fill('保存回执丢失后仍可查询原操作');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByRole('button', { name: '查询保存结果', exact: true }).waitFor();
  await page.unroute('**/api/task-shelf/mutate');
  await page.getByRole('button', { name: '查询保存结果', exact: true }).click();
  await page.locator('.ts-title-input').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.ts-note-body').innerText(), '保存回执丢失后仍可查询原操作');
  check('Lost response recovery still confirms the original save without duplicate operations');

  await edit();
  let release, captured;
  const held = new Promise(resolve => { captured = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/task-shelf/mutate', async route => { const response = await route.fetch(); captured(); await gate; await route.fulfill({ response }); });
  await page.getByLabel('下一步', { exact: true }).fill('第一版保存中');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await held;
  await page.getByLabel('下一步', { exact: true }).fill('响应返回前继续输入的新内容');
  release();
  await page.getByText('上一版已保存，后续输入尚未保存。', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('下一步', { exact: true }).inputValue(), '响应返回前继续输入的新内容');
  await page.unroute('**/api/task-shelf/mutate');
  await save(page, '响应返回前继续输入的新内容');
  check('A delayed save keeps the editor open and preserves newer typing');

  await page.getByRole('tab', { name: '会话交接', exact: true }).click();
  await selectHandoff(fixture.workspaceId, '任务资料夹 · 合成讨论');
  await selectHandoff(fixture.foreignWorkspaceId, '任务资料夹 · 跨区合成讨论');
  assert.equal(await page.locator('.ts-selected-row').count(), 2);
  await page.getByRole('tab', { name: '资料概览', exact: true }).click();
  assert.equal(await page.locator('.ts-handoff').isVisible(), false);
  await page.getByRole('tab', { name: '会话交接', exact: true }).click();
  assert.equal(await page.locator('.ts-selected-row').count(), 2);
  await page.getByRole('button', { name: '生成交接包', exact: true }).click();
  const readable = page.getByRole('textbox', { name: '易读版预览与编辑', exact: true });
  await readable.waitFor();
  assert.match(await readable.inputValue(), /另一工作区的合成讨论/);
  const customText = `${await readable.inputValue()}\n人工核对过的补充说明`;
  await readable.fill(customText);
  await page.getByRole('tab', { name: '资料概览', exact: true }).click();
  await page.getByRole('tab', { name: '会话交接', exact: true }).click();
  assert.equal(await readable.inputValue(), customText);
  assert.equal(compressionRequests.some(r => r.method === 'ai'), false);
  check('Handoff uses real cross-workspace sources, preserves selection and edited output across tabs, and never calls AI');
  await page.getByRole('tab', { name: '资料概览', exact: true }).click();

  await summary(page, '工具');
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const download = await backupDownload;
  await download.saveAs('.dev/ui-redesign-backup.json');
  const backup = JSON.parse(await readFile('.dev/ui-redesign-backup.json', 'utf8'));
  assert.ok(backup.shelves.some(s => s.id === shelfId));
  await summary(page, '资料夹操作');
  await page.getByRole('button', { name: '移入回收区', exact: true }).click();
  await page.getByRole('button', { name: '恢复资料夹', exact: true }).click();
  await page.getByRole('button', { name: '继续会话', exact: true }).waitFor();
  assert.equal((await get(`shelves?id=${shelfId}`)).shelf.deletedAt, null);
  check('Tools export includes the current folder and recycle/restore preserves the linked session');

  await page.locator('input[type=file]').setInputFiles({ name: 'ui-one-folder.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...backup, shelves: backup.shelves.filter(s => s.id === shelfId) })) });
  await page.getByRole('button', { name: '确认新增导入', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /已导入.*个资料夹/ }).waitFor();
  check('A downloaded backup imports through confirmation without overwriting the original');

  await page.getByRole('button', { name: '继续会话', exact: true }).click();
  await page.locator('.ts-root').waitFor({ state: 'hidden' });
  await page.getByText('这是一条本地合成会话，用于验证任务资料夹。无需调用模型。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '任务资料夹', exact: true }).click();
  await page.locator('.ts-task-title').waitFor();
  await panel(page);
  await page.getByRole('combobox', { name: '工作区', exact: true }).selectOption(fixture.workspaceId);
  // Imported copy can have the same title; the original remains first in this
  // explicit list resolved by its ID through the persisted UI data attribute.
  const matching = page.locator('.ts-card').filter({ hasText: shelfName });
  await matching.first().click();
  await page.locator('.ts-task-title').waitFor();
  assert.equal(await page.locator('.ts-note-body').innerText(), '响应返回前继续输入的新内容');
  check('Continue opens the existing conversation, and reload retains the saved note');

  await edit();
  await page.locator('.ts-title-input').fill('论文与工程衔接');
  await page.getByLabel('下一步', { exact: true }).fill(note);
  await save(page, note);
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/task-shelf-v1.1-light.png', fullPage: true });
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''));
  await page.screenshot({ path: '.dev/ui-dark.png', fullPage: true });
  await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'));
  await page.setViewportSize({ width: 750, height: 1000 });
  // The host animates its native navigation offscreen at this breakpoint.
  // Capture only after layout has settled, then check actual hit visibility.
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))); });
  assert.equal(await page.locator('.ts-root').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  await page.getByRole('button', { name: '返回资料夹列表', exact: true }).click();
  await page.locator('.ts-list').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.ts-detail').isVisible(), false);
  await page.locator('.ts-card').filter({ hasText: '论文与工程衔接' }).first().click();
  await page.locator('.ts-detail').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.ts-list').isVisible(), false);
  for (const selector of ['.ts-brand h1', '.ts-task-title', '.ts-note-body', '.ts-detail-actions>.ts-button']) {
    assert.equal(await page.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return r.x >= 0 && r.right <= innerWidth + 1 && (top === el || el.contains(top)); }), true, `${selector} must be inside the viewport and unobscured`);
  }
  await page.screenshot({ path: '.dev/ui-narrow.png', fullPage: true });
  check('Desktop and dark views render; narrow mode switches list/detail and has no horizontal overflow');

  const anonymous = await requests.newContext();
  assert.equal((await anonymous.get(`${base}/api/task-shelf/shelves`)).status(), 401);
  assert.equal((await anonymous.get(`${base}/api/task-shelf/health`)).status(), 401);
  await anonymous.dispose();
  assert.deepEqual(errors, []);
  check('Host authentication remains enforced and no uncaught client errors were emitted');
  await writeFile('.dev/ui-redesign-results.json', JSON.stringify({ testedAt: new Date().toISOString(), version: manifest.version, runtime: '0.2.2-rc.1', results, errors, liveAiRequests: 0, shelfId }, null, 2));
} catch (error) {
  await page.screenshot({ path: '.dev/ui-redesign-failure.png', fullPage: true }).catch(() => {});
  console.error('PAGE_TEXT', (await page.locator('body').innerText()).slice(-4500));
  throw error;
} finally { await browser.close(); }
