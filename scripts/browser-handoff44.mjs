import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium, request: requests } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { url } = JSON.parse(await readFile('.dev/server.json', 'utf8'));
const f = JSON.parse(await readFile('.dev/fixture.json', 'utf8')), base = new URL(url).origin;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1200 } }), page = await context.newPage();
const results = [], errors = [], compressionRequests = [];
page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
page.on('request', r => { if (r.url().endsWith('/handoff-compress')) compressionRequests.push(r.postDataJSON()); });
const check = label => { results.push(label); console.log('PASS', label); };
const get = async route => (await context.request.get(`${base}/api/task-shelf/${route}`)).json();
const workspace = id => page.locator(`.ts-handoff-workspace[data-workspace-id="${id}"]`);
async function select(id, title, value = true) {
  const block = workspace(id), toggle = block.locator('.ts-workspace-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await block.locator('label.ts-source-option').filter({ hasText: title }).getByRole('checkbox').setChecked(value);
}
async function clear() { while (await page.locator('.ts-selected-row').count()) await page.locator('.ts-selected-row').first().getByRole('button', { name: '移除', exact: true }).click(); }
async function generate() {
  const response = page.waitForResponse(r => r.url().endsWith('/handoff-plan') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '生成交接包', exact: true }).click();
  const value = await (await response).json(); assert.equal(value.ok, true, JSON.stringify(value));
  await page.getByRole('button', { name: '生成交接包', exact: true }).waitFor();
  return (await get(`handoff-status?id=${value.plan.id}`)).plan;
}
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '任务资料夹', exact: true }).waitFor(); await page.waitForTimeout(700);
  const welcome = page.getByRole('button', { name: '继续', exact: true }); if (await welcome.isVisible()) await welcome.click();
  await page.addLocatorHandler(page.getByRole('button', { name: /^(关闭|Close)$/ }).last(), async locator => locator.click());
  const title = `4.4 合并与压缩验收 ${Date.now()}`;
  const created = await (await context.request.post(`${base}/api/task-shelf/mutate`, { data: { operationId: randomUUID(), issuedAt: Date.now(), action: 'create', workspaceId: f.workspaceId, title } })).json();
  assert.equal(created.ok, true); const shelfId = created.result.shelfId;
  await page.getByRole('button', { name: '任务资料夹', exact: true }).click();
  await page.getByLabel('工作区', { exact: true }).selectOption(f.workspaceId);
  await page.locator('.ts-card').filter({ hasText: title }).click();
  assert.equal(await page.locator('.ts-session').count(), 0);
  await select(f.workspaceId, '任务资料夹 · 合成讨论'); await select(f.foreignWorkspaceId, '任务资料夹 · 跨区合成讨论');
  assert.equal(await page.locator('.ts-selected-row').count(), 2);
  await workspace(f.workspaceId).locator('.ts-workspace-toggle').click();
  await page.getByLabel('筛选交接来源工作区', { exact: true }).fill('不存在的工作区');
  assert.equal(await page.locator('.ts-selected-row').count(), 2);
  await page.getByLabel('筛选交接来源工作区', { exact: true }).fill('');
  let plan = await generate(); assert.equal(plan.ready, true); assert.equal(compressionRequests.length, 0);
  assert.match(plan.readableText, /另一工作区的合成讨论/); assert.match(plan.text, /这是一条本地合成会话/);
  assert.equal((await get(`shelves?id=${shelfId}`)).shelf.sessionRefs.length, 0);
  check('Workspace tree directly selects unlinked conversations; collapse and filtering retain cross-workspace selection; one package includes both');

  await clear(); const long = f.compressionSessions[0]; await select(long.workspaceId, long.title);
  plan = await generate(); assert.equal(plan.ready, true); assert.equal(compressionRequests.length, 1);
  assert.equal(plan.sources[0].method, 'local'); assert.ok(plan.sources[0].originalSize > 12000); assert.ok(plan.sources[0].size <= 6000);
  assert.match(plan.readableText, /本地精简/); assert.match(plan.readableText, /中间原文已省略/); assert.match(plan.readableText, /结尾：下一步核对/);
  check('Single oversized conversation automatically uses selected local compression and visibly retains beginning/end with omission notice');

  await clear(); for (const item of f.compressionSessions.slice(1)) await select(item.workspaceId, item.title);
  const beforeCount = compressionRequests.length; plan = await generate();
  assert.equal(plan.ready, false); assert.deepEqual(plan.oversized, []); assert.ok(plan.size > 30000);
  assert.equal(compressionRequests.length, beforeCount); assert.equal(await page.getByRole('button', { name: '带入新会话草稿', exact: true }).isDisabled(), true);
  await page.getByText('合计超限。请自行选择下列任意一段压缩，不会自动压缩其他会话。', { exact: true }).waitFor();
  await mkdir('docs/screenshots', { recursive: true });
  await page.locator('.ts-handoff-heading').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/handoff-4.4-select.png' });
  await page.locator('.ts-compression-budget').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/handoff-4.4-overflow.png' });
  const chosen = f.compressionSessions[2];
  const completed = page.waitForResponse(r => r.url().endsWith('/handoff-compress'));
  await page.locator('.ts-budget-row').filter({ hasText: chosen.title }).getByRole('button').click();
  const next = (await (await completed).json()).plan;
  await page.getByRole('button', { name: '生成交接包', exact: true }).waitFor();
  assert.equal(next.ready, true); assert.equal(compressionRequests.at(-1).sourceId, chosen.sessionId);
  for (const source of next.sources) assert.equal(source.method, source.key === chosen.sessionId ? 'local' : null);
  check('Aggregate-only overflow waits for the user; pressing one source compresses only that source and unblocks delivery');

  await clear(); await select(long.workspaceId, long.title);
  await page.route('**/api/task-shelf/handoff-options', route => route.fulfill({ json: { ok: true, model: null } }));
  await page.getByRole('radio', { name: /^AI 摘要/ }).check();
  const refreshed = page.waitForResponse(r => r.url().endsWith('/handoff-options'));
  await page.getByRole('button', { name: '刷新模型信息', exact: true }).click(); await refreshed;
  plan = await generate(); assert.equal(plan.ready, false); assert.equal(plan.sources[0].method, null);
  await page.getByText(/DSH 默认模型未配置或已变化/).waitFor();
  await page.getByRole('radio', { name: /^本地精简/ }).check();
  const recovered = page.waitForResponse(r => r.url().endsWith('/handoff-compress'));
  await page.locator('.ts-budget-row').getByRole('button').click(); assert.equal((await (await recovered).json()).plan.ready, true);
  await page.getByRole('button', { name: '生成交接包', exact: true }).waitFor(); await page.unroute('**/api/task-shelf/handoff-options');
  check('AI option explains cost and tradeoffs; unavailable/default-route mismatch preserves originals until user explicitly selects local compression');

  await clear(); await select(f.workspaceId, '任务资料夹 · 合成讨论'); await select(f.foreignWorkspaceId, '任务资料夹 · 跨区合成讨论');
  for (const item of f.compressionSessions.slice(0, 3)) await select(item.workspaceId, item.title);
  const sixth = f.compressionSessions[3];
  assert.equal(await workspace(sixth.workspaceId).locator('label.ts-source-option').filter({ hasText: sixth.title }).getByRole('checkbox').isDisabled(), true);
  await page.locator('.ts-selected-row').filter({ hasText: long.title }).getByRole('button').click();
  assert.equal(await workspace(sixth.workspaceId).locator('label.ts-source-option').filter({ hasText: sixth.title }).getByRole('checkbox').isDisabled(), false);
  check('Selection limit is global across workspaces and removing a selected source immediately frees capacity');

  await clear(); await select(f.workspaceId, '任务资料夹 · 合成讨论'); await select(f.foreignWorkspaceId, '任务资料夹 · 跨区合成讨论');
  plan = await generate();
  await page.setViewportSize({ width: 650, height: 1100 });
  assert.equal(await page.locator('.ts-root').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  await page.setViewportSize({ width: 1500, height: 1200 });
  await page.getByLabel('交接目标工作区', { exact: true }).selectOption(f.targetWorkspaceId);
  await page.getByRole('button', { name: '带入新会话草稿', exact: true }).click(); await page.locator('.ts-root').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => [...document.querySelectorAll('textarea,[contenteditable=true]')].some(el => (el.value ?? el.textContent).includes('另一工作区的合成讨论')));
  await page.getByText('跨工作区交接目标', { exact: true }).last().waitFor();
  check('Combined package enters workspace C native draft; narrow layout has no horizontal overflow');
  const anonymous = await requests.newContext();
  for (const route of ['handoff-plan', 'handoff-compress', 'handoff-release']) assert.equal((await anonymous.post(`${base}/api/task-shelf/${route}`, { data: {} })).status(), 401);
  assert.equal((await anonymous.get(`${base}/api/task-shelf/handoff-options`)).status(), 401); await anonymous.dispose();
  assert.deepEqual(errors, []); check('All new endpoints require host authentication and no uncaught UI errors occurred');
  await writeFile('.dev/handoff44-results.json', JSON.stringify({ testedAt: new Date().toISOString(), results, errors, liveAiRequests: 0 }, null, 2));
} catch(e) { await page.screenshot({ path: '.dev/handoff44-failure.png' }); console.error((await page.locator('body').innerText()).slice(-5500)); throw e; }
finally { await browser.close(); }
