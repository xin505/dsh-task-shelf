import { mkdir, readFile, unlink, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';

export const PLUGIN_VERSION = '1.0.1';
// Reports deliberately contain no paths, titles, IDs, notes or raw exceptions.
export async function checkHealth(store, io = {}) {
  const report = { format: 'dsh-task-shelf-health', version: PLUGIN_VERSION, build: '1.0.1-fat-fish-sky', checkedAt: new Date().toISOString(), trigger: 'plugin-start', checks: [] };
  const add = (name, status, message) => report.checks.push({ name, status, message });
  const directory = dirname(store.file);
  try {
    const { raw } = await store.read();
    add('state', 'ok', raw === null ? '首次使用，尚无数据文件。' : '数据文件可读取，格式校验通过。');
  } catch {
    add('state', 'error', '数据无法读取或格式不兼容。请保留原文件，查看 DSH 插件错误提示，不要清空数据。');
  }
  try {
    await stat(`${store.file}.previous`);
    await store.read(`${store.file}.previous`);
    add('backup', 'ok', '上一份备份可读取，格式校验通过。');
  } catch (error) {
    add('backup', error.code === 'ENOENT' ? 'info' : 'warning', error.code === 'ENOENT' ? '尚无上一份备份，首次使用或仅保存一次时正常。' : '上一份备份无法读取或格式不兼容，请先导出当前有效数据。');
  }
  const probe = join(directory, `.health-probe-${randomUUID()}`);
  let probeFailed = false;
  try {
    await mkdir(directory, { recursive: true });
    await (io.write ?? writeFileAtomic)(probe, 'task-shelf-health', { mode: 0o600 });
    if (await readFile(probe, 'utf8') !== 'task-shelf-health') throw new Error('probe mismatch');
  } catch { probeFailed = true; }
  finally {
    try { await unlink(probe); } catch (error) { if (error.code !== 'ENOENT') probeFailed = true; }
  }
  add('storage', probeFailed ? 'error' : 'ok', probeFailed ? '临时文件写入、读回或清理失败，请检查数据目录权限和剩余空间。' : '临时文件写入、读回与清理通过。');
  report.status = report.checks.some(c => c.status === 'error') ? 'error' : report.checks.some(c => c.status === 'warning') ? 'warning' : 'ok';
  try {
    await (io.writeReport ?? writeFileAtomic)(join(directory, 'health-latest.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  } catch {
    add('report', 'warning', '诊断报告无法写入本地；仍可从界面导出本次报告。');
    if (report.status === 'ok') report.status = 'warning';
  }
  return report;
}
