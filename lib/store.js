import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write';
import { LIMITS, ShelfError, assert, emptyState, validateState, applyOperation } from './core.js';

export class ShelfStore {
  constructor(file, catalog, io = {}) { this.file = file; this.catalog = catalog; this.write = io.write ?? writeFileAtomic; this.lock = io.lock ?? withFileLock; }
  async read(file = this.file) {
    let handle;
    try {
      handle = await open(file, 'r');
      assert((await handle.stat()).size <= LIMITS.fileBytes, 'corrupt', '数据文件过大，已停止写入，请保留文件以便恢复。', 503);
      const raw = await handle.readFile('utf8');
      return { state: validateState(JSON.parse(raw)), raw };
    } catch (error) {
      if (error.code === 'ENOENT' && !handle && file === this.file) return { state: emptyState(), raw: null };
      if (error instanceof ShelfError && error.code === 'schema') throw error;
      throw new ShelfError('corrupt', '数据无法读取，已停止写入。原文件和上一份备份均未清空。', 503);
    } finally { await handle?.close(); }
  }
  async mutate(request) {
    await mkdir(dirname(this.file), { recursive: true });
    return this.lock(this.file, async () => {
      const { state, raw } = await this.read();
      const { result, replay } = await applyOperation(state, request, this.catalog);
      if (replay) return result;
      const next = JSON.stringify(state);
      assert(Buffer.byteLength(next) <= LIMITS.fileBytes, 'quota', '数据与回执总容量已满，请先导出。');
      // Preserve the prior valid generation before replacing the live one.
      if (raw !== null) await this.write(`${this.file}.previous`, raw, { mode: 0o600 });
      await this.write(this.file, next, { mode: 0o600 });
      return result;
    }, { waitMs: 5000 });
  }
  async snapshot() { return (await this.read()).state; }
  async operation(operationId) {
    const state = await this.snapshot();
    const receipt = state.receipts.find(r => r.operationId === operationId);
    return receipt ? { status: 'committed', result: receipt.result } : { status: 'unknown' };
  }
  async backup(previous = false) {
    const { state } = await this.read(previous ? `${this.file}.previous` : this.file);
    return { format: 'dsh-task-shelf-alpha', schemaVersion: state.schemaVersion, exportId: randomUUID(), originId: state.originId, exportedAt: new Date().toISOString(), shelves: state.shelves };
  }
}
