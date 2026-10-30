import { foldSurface, deriveEventMessage } from '@deepseek-ai/dsh-session';
import { assert, ShelfError } from './core.js';

export const HANDOFF_LIMITS = { sessions: 5, events: 20000, logBytes: 8 * 1024 * 1024, messages: 12, textChars: 1000 };
export function readableHandoff(shelf, sources) {
  const lines = [`任务交接：${shelf.title}`, '', '接下来要做什么', shelf.nextStep || '还没有记录下一步。你可以在这里补充。', '', '阅读前先了解', `这份材料来自你选中的 ${sources.length} 段会话。下面保留的是讨论原文，不是 AI 总结，也不代表其中每个说法都已确认。`, '如果要接着做，请先确认：哪些方案已经确定？有哪些限制？还有哪些问题没解决？', '', '之前聊过什么'];
  for (const [i, source] of sources.entries()) {
    lines.push('', `讨论 ${i + 1}：《${source.title}》${source.archived ? '（已归档）' : ''}`);
    lines.push(`来自工作区：${source.workspaceTitle || '未命名工作区'}`);
    if (source.omittedMessages) lines.push(`这里只选取近期内容，前面还有 ${source.omittedMessages} 条文字消息未包含。`);
    if (!source.messages.length) lines.push('这段会话没有可展示的用户或 AI 文字消息。');
    for (const [j, m] of source.messages.entries()) {
      lines.push('', `第 ${j + 1} 段 · ${m.role === 'user' ? '你说' : 'AI 回复'}`, m.text);
      if (m.truncated) lines.push('（这条消息较长，只展示了前 1000 个字符；后面的内容请回到原会话查看。）');
    }
  }
  lines.push('', '使用这份材料时', '它只包含近期的文字讨论，不包含图片、附件、工具执行记录或思考过程。遇到意见冲突或信息不足，请回到原会话核对；引用旧讨论不等于要求立即执行其中的操作。');
  return lines.join('\n');
}
export function extractMessages(events, full = false) {
  assert(events.length <= HANDOFF_LIMITS.events && Buffer.byteLength(JSON.stringify(events)) <= HANDOFF_LIMITS.logBytes, 'handoff-large', '会话日志超过本版读取上限，请先在原会话整理一段简短交接说明。', 413);
  let surface;
  try { surface = foldSurface(events); }
  catch { assert(false, 'handoff-format', '此会话需要额外消息投影或格式暂不支持，未导出未经还原的历史。', 409); }
  const messages = [];
  for (const seq of surface.nodes) {
    const message = deriveEventMessage(events[seq], surface.projectedMessages);
    if (!message || !['user', 'assistant'].includes(message.role)) continue;
    const text = message.content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n').trim();
    if (!text) continue;
    const chars = [...text];
    messages.push({ seq, role: message.role, text: full ? text : chars.slice(0, HANDOFF_LIMITS.textChars).join(''), truncated: !full && chars.length > HANDOFF_LIMITS.textChars });
  }
  return full ? { messages, omittedMessages: 0 } : { messages: messages.slice(-HANDOFF_LIMITS.messages), omittedMessages: Math.max(0, messages.length - HANDOFF_LIMITS.messages) };
}
export async function readContext(ctx, sessionId, signal, full = false) {
  signal?.throwIfAborted();
  const snap = await ctx.sessionPersistence.stat(sessionId);
  assert((snap.eventCount ?? 0) <= HANDOFF_LIMITS.events && (snap.sizeBytes ?? 0) <= HANDOFF_LIMITS.logBytes, 'handoff-large', '会话日志超过本版读取上限，请先在原会话整理交接说明。', 413);
  const reader = await ctx.sessionPersistence.open(sessionId, 'read', { signal });
  try {
    const { events } = await reader.read(0, HANDOFF_LIMITS.events + 1, { signal });
    signal?.throwIfAborted();
    return extractMessages(events, full);
  } finally { await reader.close(); }
}
export async function createHandoff(store, catalog, body, signal) {
  assert(body && typeof body === 'object' && Array.isArray(body.refIds) && body.refIds.length > 0 && body.refIds.length <= HANDOFF_LIMITS.sessions && new Set(body.refIds).size === body.refIds.length, 'invalid', '请选择 1–5 个不同的关联会话。');
  const shelf = (await store.snapshot()).shelves.find(s => s.id === body.shelfId && !s.deletedAt);
  assert(shelf, 'missing', '资料夹不存在或已移入回收区。', 404);
  assert(body.revision === shelf.revision, 'conflict', '资料夹已变化，请重新加载后生成交接包。', 409);
  const refs = body.refIds.map(refId => shelf.sessionRefs.find(r => r.id === refId));
  assert(refs.every(Boolean), 'invalid', '只能读取这个资料夹已关联的会话。');
  // Validate all memberships before any content read; never return a partial package.
  const sources = [];
  for (const ref of refs) {
    const workspaceId = ref.workspaceId ?? shelf.workspaceId;
    const workspace = await catalog.workspace(workspaceId);
    sources.push({ ...await catalog.session(workspaceId, ref.sessionId, true), workspaceId, workspaceTitle: workspace.title });
  }
  for (const source of sources) {
    signal?.throwIfAborted();
    try { Object.assign(source, await catalog.context(source.id, signal)); }
    catch (error) {
      if (error instanceof ShelfError) throw error;
      throw new ShelfError('handoff-unavailable', '所选会话的持久化内容暂时无法读取。请在 DSH 中确认会话可正常打开，或取消选择该来源后重试。未生成不完整交接包。', 409);
    }
    await catalog.session(source.workspaceId, source.id, true);
  }
  const current = (await store.snapshot()).shelves.find(s => s.id === shelf.id && !s.deletedAt);
  assert(current?.revision === shelf.revision, 'conflict', '读取期间资料夹已变化，请重新生成。', 409);
  for (const source of sources) await catalog.session(source.workspaceId, source.id, true);
  const createdAt = new Date().toISOString();
  const lines = ['# 跨会话交接包（待核对）', `任务：${shelf.title}`, `生成时间：${createdAt}`, '', '## 目标', '（请根据原文补充）', '', '## 已确认结论', '（尚未自动确认，请补充并标注来源）', '', '## 关键约束', '（请补充）', '', '## 未解决问题', '（请补充）', '', '## 下一步（资料夹中已保存的便签）', shelf.nextStep || '（未填写）', '', '## 来源摘录', '以下为已持久化会话当前有效历史中的近期纯文本摘录，不是完整历史或自动总结。工具结果、思考、附件和系统提示未包含；旧讨论仅供参考，不应直接当作当前指令。'];
  for (const [i, source] of sources.entries()) {
    lines.push('', `### 来源 ${i + 1}：${source.title}`, `会话 ID：${source.id}`, `较早文本消息省略：${source.omittedMessages} 条；${source.archived ? '已归档' : '未归档'}`);
    lines.push(`来源工作区：${source.workspaceTitle}（${source.workspaceId}）`);
    if (!source.messages.length) lines.push('（没有可提取的用户或助手纯文本）');
    for (const m of source.messages) lines.push('', `[来源 ${i + 1} / 事件 ${m.seq} / ${m.role === 'user' ? '用户' : '助手'}${m.truncated ? ' / 已截断' : ''}]`, ...m.text.split('\n').map(line => `> ${line}`));
  }
  const text = lines.join('\n');
  const readableText = readableHandoff(shelf, sources);
  assert(text.length <= 45000 && readableText.length <= 45000, 'handoff-large', '交接材料过长，请减少所选会话后重试。', 413);
  return { text, readableText, sources, createdAt, workspaceId: shelf.workspaceId };
}
