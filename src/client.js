const { createElement: h, useState, useEffect, useRef, useCallback } = React;
const PANEL = 'dsh-task-shelf';
const inject = ['slots', 'uiWorkspace'];
function uuid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
async function api(route, payload, timeoutMs = 10000) {
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const send = window.__DSH_TRANSPORT__?.fetch ?? ((...args) => window.fetch(...args));
    const response = await send(`api/task-shelf/${route}`, { method: payload ? 'POST' : 'GET', headers: payload ? { 'content-type': 'application/json' } : {}, ...(payload ? { body: JSON.stringify(payload) } : {}), signal: abort.signal });
    const value = await response.json();
    if (!response.ok || value.ok === false) { const error = new Error(value.message || `请求失败（${response.status}）`); error.definite = response.status >= 400 && response.status < 500; error.code = value.code; throw error; }
    return value;
  } finally { clearTimeout(timer); }
}
function download(value, extension, type) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `task-shelf-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function FolderIcon() { return h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true }, h('path', { d: 'M3 6h6l2 3h10v11H3z' }), h('path', { d: 'M7 13h10M7 16h7' })); }
function Button({ children, onClick, secondary, danger, ...props }) { return h('button', { type: 'button', className: `ts-button ${secondary ? 'ts-secondary' : ''} ${danger ? 'ts-danger' : ''}`, onClick, ...props }, children); }
function Panel({ ctx, memory }) {
  const [workspaces, setWorkspaces] = useState([]), [workspaceId, setWorkspaceId] = useState(memory.workspaceId || '');
  const [shelves, setShelves] = useState([]), [shelf, setShelf] = useState(null), [query, setQuery] = useState(''), [trash, setTrash] = useState(false);
  const [title, setTitle] = useState(''), [nextStep, setNextStep] = useState(''), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [creating, setCreating] = useState(false), [newTitle, setNewTitle] = useState('');
  const [savingText, setSavingText] = useState(false);
  const [health, setHealth] = useState(null), [healthError, setHealthError] = useState('');
  const [sessions, setSessions] = useState([]), [picker, setPicker] = useState(false), [sessionOffset, setSessionOffset] = useState(null);
  const [sourceWorkspaceId, setSourceWorkspaceId] = useState(''), [sourceLoading, setSourceLoading] = useState(false);
  const sourceVersion = useRef(0);
  const [pending, setPending] = useState(memory.pending || null), [importPreview, setImportPreview] = useState(null);
  const [current, setCurrent] = useState({ ...memory.current });
  const draftVersion = useRef(0), selectionVersion = useRef(0), lock = useRef(false), fileInput = useRef(null), live = useRef(true);
  const dirty = !!shelf && (title !== shelf.title || nextStep !== shelf.nextStep);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    api('health').then(value => { if (live.current) setHealth(value.health); }).catch(() => { if (live.current) setHealthError('无法取得启动自检结果，请检查插件是否已更新并启用。'); });
  }, []);
  useEffect(() => { memory.workspaceId = workspaceId; }, [workspaceId]);
  useEffect(() => { memory.pending = pending; }, [pending]);
  useEffect(() => {
    const warn = event => { if (dirty || pending) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, pending]);
  // Keep a window-local draft if the host changes panels outside this plugin.
  useEffect(() => { if (shelf) memory.drafts[shelf.id] = { title, nextStep, revision: shelf.revision, dirty }; }, [shelf, title, nextStep, dirty]);
  const refreshList = useCallback(async () => {
    let offset = 0, rows = [];
    do { const result = await api(`shelves?offset=${offset}`); rows.push(...result.shelves); offset = result.nextOffset; } while (offset !== null);
    if (live.current) setShelves(rows); return rows;
  }, []);
  const loadShelf = useCallback(async (shelfId, preserveDraft = true) => {
    const token = ++selectionVersion.current;
    const result = await api(`shelves?id=${encodeURIComponent(shelfId)}`);
    if (!live.current || token !== selectionVersion.current) return;
    setShelf(result.shelf); memory.selectedId = shelfId;
    const saved = preserveDraft ? memory.drafts[shelfId] : null;
    setTitle(saved?.dirty ? saved.title : result.shelf.title); setNextStep(saved?.dirty ? saved.nextStep : result.shelf.nextStep);
    if (saved?.dirty && saved.revision !== result.shelf.revision) {
      setShelf({ ...result.shelf, revision: saved.revision });
      setError('此处有未保存草稿，服务端版本已变化。请先复制草稿或重新加载，保存时会检查冲突。');
    }
    setPicker(false); draftVersion.current++;
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const [catalog, rows] = await Promise.all([api('catalog'), refreshList()]);
        if (!live.current) return;
        setWorkspaces(catalog.workspaces);
        const preferred = memory.workspaceId || catalog.workspaces[0]?.id || rows[0]?.workspaceId || '';
        setWorkspaceId(preferred);
        const selected = rows.find(s => s.id === memory.selectedId && s.workspaceId === preferred && !s.deletedAt);
        if (selected) await loadShelf(selected.id);
      } catch (e) { if (live.current) setError(e.message); }
      finally { if (live.current) setLoading(false); }
    })();
  }, []);
  function allowSwitch() { return !busy && !pending && (!dirty || window.confirm('当前草稿尚未保存。切换后草稿仍保留在此窗口，是否继续？')); }
  function chooseWorkspace(value) {
    if (!allowSwitch()) return;
    selectionVersion.current++; setWorkspaceId(value); setShelf(null); setPicker(false); setError(''); setNotice(''); setCreating(false);
  }
  async function chooseShelf(row) {
    if (!allowSwitch()) return;
    setError(''); setNotice(''); try { await loadShelf(row.id); } catch(e) { setError(e.message); }
  }
  function setCurrentTask(row) { const next = { ...current, [row.workspaceId]: row.id }; setCurrent(next); memory.current = next; setNotice(`当前任务：${row.title}`); }
  function rememberPending(value) { memory.pending = value; setPending(value); }
  async function finish(request, result, version) {
    rememberPending(null);
    const refreshed = await refreshList();
    const hasNewEdits = request.action === 'edit' && version !== draftVersion.current;
    if (request.action === 'purge') { delete memory.drafts[request.shelfId]; setShelf(null); memory.selectedId = null; }
    else if (result.shelfId) {
      if (request.action === 'edit') {
        // Update only the saved baseline. Never replace the current text with an
        // asynchronous detail fetch, including edits typed during refreshList.
        setShelf(old => old?.id === result.shelfId ? { ...old, title: request.title.trim(), nextStep: request.nextStep, revision: result.revision, updatedAt: refreshed.find(s => s.id === result.shelfId)?.updatedAt ?? old.updatedAt } : old);
        if (!hasNewEdits) setTitle(request.title.trim());
      } else { delete memory.drafts[result.shelfId]; await loadShelf(result.shelfId, false); }
    }
    if (request.action === 'create') { setCreating(false); setNewTitle(''); setCurrentTask({ id: result.shelfId, workspaceId: request.workspaceId, title: request.title }); }
    if (['trash', 'purge'].includes(request.action)) {
      const next = { ...memory.current }; for (const key of Object.keys(next)) if (next[key] === request.shelfId) delete next[key]; memory.current = next; setCurrent(next);
    }
    if (request.action === 'import') { setImportPreview(null); setNotice(`已导入 ${result.imported} 个资料夹，原有内容保留。`); }
    else setNotice(hasNewEdits ? '上一版已保存，后续输入尚未保存。' : '已保存');
  }
  async function execute(fields, retry = false) {
    if (lock.current || (pending && !retry)) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    const version = retry ? (pending?.version ?? draftVersion.current) : draftVersion.current;
    const request = retry ? fields : { operationId: uuid(), issuedAt: Date.now(), ...(shelf ? { shelfId: shelf.id, revision: shelf.revision } : {}), ...fields };
    setSavingText(request.action === 'edit');
    let committed = false;
    try {
      const value = await api(request.action === 'import' ? 'import' : 'mutate', request);
      committed = true;
      await finish(request, value.result, version);
    } catch (e) {
      if (!committed && !e.definite) { rememberPending({ request, version }); setError('尚未确认是否保存。草稿保留，请查询结果；重试会复用同一操作标识。'); }
      else { if (e.definite) rememberPending(null); setError(committed ? '保存已成功，但刷新失败。请刷新列表；不要重复创建。' : e.message); }
    } finally { lock.current = false; if (live.current) { setBusy(false); setSavingText(false); } }
  }
  async function confirmPending() {
    if (!pending || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const value = await api(`operation?id=${encodeURIComponent(pending.request.operationId)}`);
      if (value.status === 'committed') await finish(pending.request, value.result, pending.version);
      else setError('尚未查到提交回执。24 小时内可用原操作重试；请勿另建重复任务。');
    } catch(e) { setError(e.message); } finally { lock.current = false; setBusy(false); }
  }
  async function showSessions(append = false, sourceId = sourceWorkspaceId || shelf.workspaceId) {
    const token = ++sourceVersion.current, selection = selectionVersion.current;
    setError(''); setPicker(true); setSourceLoading(true); setSourceWorkspaceId(sourceId);
    if (!append) { setSessions([]); setSessionOffset(null); }
    try {
      const result = await api(`catalog?workspaceId=${encodeURIComponent(sourceId)}&offset=${append ? sessionOffset : 0}`);
      if (!live.current || token !== sourceVersion.current || selection !== selectionVersion.current) return;
      setSessions(old => append ? [...old, ...result.items] : result.items); setSessionOffset(result.nextOffset);
    } catch(e) { if (live.current && token === sourceVersion.current && selection === selectionVersion.current) setError(e.message); }
    finally { if (live.current && token === sourceVersion.current) setSourceLoading(false); }
  }
  async function openSession(refId) {
    if (!allowSwitch()) return;
    setError('');
    try { const result = await api(`open?id=${encodeURIComponent(shelf.id)}${refId ? `&refId=${encodeURIComponent(refId)}` : ''}`); ctx.uiWorkspace.openSession(result.session.id); }
    catch(e) { setError(e.message); }
  }
  async function exportBackup(previous = false) {
    try { const backup = await api(`export${previous ? '?previous=1' : ''}`); download(JSON.stringify(backup), 'json', 'application/json'); setNotice(previous ? '已导出上一份有效备份。' : '已导出全部资料夹，含回收区、便签和会话引用。'); } catch(e) { setError(e.message); }
  }
  async function previewImport(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024 + 32768) throw new Error('备份超过试用版导入上限。');
      const backup = JSON.parse(await file.text());
      if (backup.format !== 'dsh-task-shelf-alpha' || ![1, 2].includes(backup.schemaVersion) || !Array.isArray(backup.shelves)) throw new Error('请选择本试用版导出的 JSON 备份。');
      setImportPreview(backup); setError('');
    } catch(e) { setError(e.message); }
  }
  const rows = shelves.filter(s => s.workspaceId === workspaceId && !!s.deletedAt === trash && s.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  const options = [...workspaces]; for (const s of shelves) if (!options.some(w => w.id === s.workspaceId)) options.push({ id: s.workspaceId, title: `${s.workspaceTitle}（已移除）` });
  const blocked = busy || !!pending;
  return h('div', { className: 'ts-root' },
    h('header', { className: 'ts-header' }, h('img', { className: 'ts-header-art', src: FISH_ARTWORK, alt: '', 'aria-hidden': true, draggable: false }), h('div', { className: 'ts-header-copy' }, h('div', { className: 'ts-eyebrow' }, 'DSH TASK SHELF 1 · 大肥鱼的天空'), h('h1', null, '任务资料夹'), h('p', null, '把散落的想法收好，下次接着做。')),
      h('div', { className: 'ts-toolbar' }, h(Button, { secondary: true, onClick: () => exportBackup() }, '导出备份'), h(Button, { secondary: true, disabled: blocked, onClick: () => fileInput.current.click() }, '导入备份'), h('input', { ref: fileInput, type: 'file', accept: '.json,application/json', hidden: true, onChange: previewImport }))),
    h('details', { className: `ts-banner ${health?.status === 'error' ? 'ts-error' : health?.status === 'warning' || healthError ? 'ts-warning' : ''}` },
      h('summary', null, healthError || (health ? `启动自检：${health.status === 'ok' ? '通过' : health.status === 'warning' ? '有提醒' : '发现异常'} · ${new Date(health.checkedAt).toLocaleString()}` : '正在获取启动自检结果…')),
      health && h(React.Fragment, null, ...health.checks.map(check => h('p', { key: check.name }, `${({ ok: '通过', info: '说明', warning: '提醒', error: '异常' })[check.status]}：${check.message}`)),
        h('p', { className: 'ts-muted' }, '这是本次插件加载时的检查结果，不代表持续监控。报告不含聊天、便签和文件路径。'),
        h(Button, { secondary: true, onClick: () => download(JSON.stringify(health, null, 2), 'json', 'application/json') }, '导出诊断报告'))),
    (error || notice) && h('div', { className: `ts-banner ${error ? 'ts-error' : ''}`, role: error ? 'alert' : 'status' }, error || notice,
      error && h('div', { className: 'ts-inline' }, h(Button, { secondary: true, disabled: busy, onClick: async () => { try { await refreshList(); setError(''); } catch(e) { setError(e.message); } } }, '刷新列表'), h(Button, { secondary: true, onClick: () => exportBackup(true) }, '导出上一份备份'))),
    pending && h('div', { className: 'ts-banner ts-warning', role: 'status' }, '有一项操作的结果待确认。', h('div', { className: 'ts-inline' }, h(Button, { disabled: busy, onClick: confirmPending }, '查询保存结果'), h(Button, { secondary: true, disabled: busy, onClick: () => execute(pending.request, true) }, '重试原操作'))),
    importPreview && h('section', { className: 'ts-import' }, h('h2', null, '确认导入'), h('p', null, `将新增 ${importPreview.shelves.length} 个资料夹，保留现有内容。只支持当前 DSH 中仍存在的工作区与会话；引用失效时整批拒绝。`), h('p', { className: 'ts-muted' }, '备份中的便签和回收区也会恢复。不会覆盖同名资料夹，也不会自动发送消息。'), h('div', { className: 'ts-inline' }, h(Button, { disabled: blocked, onClick: () => execute({ action: 'import', backup: importPreview }) }, '确认新增导入'), h(Button, { secondary: true, disabled: blocked, onClick: () => setImportPreview(null) }, '取消'))),
    h('div', { className: 'ts-layout' },
      h('aside', { className: 'ts-list' },
        h('label', { className: 'ts-label' }, '工作区', h('select', { value: workspaceId, disabled: blocked, onChange: e => chooseWorkspace(e.target.value), 'aria-label': '工作区' }, !options.length && h('option', { value: '' }, '请先在 DSH 添加工作区'), ...options.map(w => h('option', { key: w.id, value: w.id }, w.title)))),
        h('div', { className: 'ts-tabs' }, ...[[false, '进行中'], [true, '回收区']].map(([value, label]) => h('button', { key: label, type: 'button', className: trash === value ? 'active' : '', disabled: blocked, onClick: () => { if (allowSwitch()) { setTrash(value); setShelf(null); selectionVersion.current++; } } }, label))),
        h('input', { className: 'ts-search', placeholder: '搜索资料夹…', value: query, onChange: e => setQuery(e.target.value), 'aria-label': '搜索资料夹' }),
        !trash && h(Button, { disabled: blocked || !workspaces.some(w => w.id === workspaceId), onClick: () => { if (allowSwitch()) { setCreating(true); setNewTitle(''); } } }, '＋ 新建资料夹'),
        creating && h('form', { className: 'ts-create', onSubmit: e => { e.preventDefault(); execute({ action: 'create', workspaceId, title: newTitle }); } }, h('label', { className: 'ts-label' }, '资料夹名称', h('input', { autoFocus: true, value: newTitle, maxLength: 120, placeholder: '例如：登录异常排查', onChange: e => setNewTitle(e.target.value) })), h('div', { className: 'ts-inline' }, h('button', { className: 'ts-button', type: 'submit', disabled: blocked || !newTitle.trim() }, '创建'), h(Button, { secondary: true, disabled: blocked, onClick: () => setCreating(false) }, '取消'))),
        h('div', { className: 'ts-card-list' }, loading ? h('p', { className: 'ts-muted' }, '正在读取…') : rows.length ? rows.map(row => h('button', { key: row.id, type: 'button', className: `ts-card ${shelf?.id === row.id ? 'selected' : ''}`, onClick: () => chooseShelf(row), disabled: blocked }, h('div', { className: 'ts-card-top' }, h(FolderIcon), current[row.workspaceId] === row.id && h('span', { className: 'ts-badge' }, '当前')), h('strong', null, row.title), h('p', null, row.nextStep || '还没有记录下一步'), h('small', null, `${row.sessionCount} 个会话 · ${new Date(row.updatedAt).toLocaleDateString()}`))) : h('div', { className: 'ts-list-empty' }, trash ? '回收区为空' : query ? '没有匹配的资料夹' : '新建一个资料夹，开始整理当前工作。'))),
      h('main', { className: 'ts-detail' }, shelf ? h(React.Fragment, null,
        h('div', { className: 'ts-detail-top' }, h('span', { className: 'ts-kicker' }, shelf.workspaceTitle), h('span', { className: 'ts-save-state', role: 'status' }, pending ? '结果待确认' : busy ? '保存中…' : dirty ? '有未保存修改' : '已保存')),
        h('label', { className: 'ts-label' }, '资料夹名称', h('input', { className: 'ts-title-input', value: title, maxLength: 120, disabled: !!shelf.deletedAt || !!pending || (busy && !savingText), onChange: e => { draftVersion.current++; setTitle(e.target.value); } })),
        !shelf.deletedAt && h('div', { className: 'ts-inline ts-detail-actions' }, h(Button, { disabled: blocked || !shelf.primarySessionRefId, onClick: () => openSession() }, '继续任务 ↗'), h(Button, { secondary: true, disabled: blocked, onClick: () => setCurrentTask(shelf) }, current[shelf.workspaceId] === shelf.id ? '✓ 当前任务' : '设为当前任务')),
        h('section', { className: 'ts-next' }, h('label', { className: 'ts-label', htmlFor: 'ts-next-step' }, '下一步'), h('p', { className: 'ts-muted' }, '留一句话，让下次打开时知道从哪里继续。'), h('textarea', { id: 'ts-next-step', value: nextStep, placeholder: '下一步要验证什么？还有哪个问题没有解决？', rows: 6, disabled: !!shelf.deletedAt || !!pending || (busy && !savingText), onChange: e => { draftVersion.current++; setNextStep(e.target.value); } }), h('div', { className: 'ts-edit-footer' }, h('span', { className: 'ts-muted' }, `${new TextEncoder().encode(nextStep).length} / 4096 字节`), !shelf.deletedAt && h(Button, { disabled: blocked || !dirty || !title.trim() || new TextEncoder().encode(nextStep).length > 4096, onClick: () => execute({ action: 'edit', title, nextStep }) }, '保存修改'))),
        dirty && h('div', { className: 'ts-inline ts-draft-actions' }, h(Button, { secondary: true, onClick: async () => { try { await navigator.clipboard.writeText(`${title}\n\n${nextStep}`); setNotice('草稿已复制。'); } catch { download(`${title}\n\n${nextStep}`, 'txt', 'text/plain'); setNotice('草稿已下载。'); } } }, '复制草稿'), h(Button, { secondary: true, disabled: blocked, onClick: async () => { if (window.confirm('重新加载会丢弃这里的未保存修改，是否继续？')) { delete memory.drafts[shelf.id]; try { await loadShelf(shelf.id, false); setError(''); } catch(e) { setError(e.message); } } } }, '重新加载')),
        h('section', { className: 'ts-sessions' }, h('div', { className: 'ts-section-heading' }, h('h2', null, '相关会话'), !shelf.deletedAt && h(Button, { secondary: true, disabled: blocked || dirty, onClick: () => picker ? setPicker(false) : showSessions(false, shelf.workspaceId) }, picker ? '收起选择' : '＋ 关联会话')),
          dirty && h('p', { className: 'ts-muted' }, '先保存上面的修改，再调整会话关联。'),
          picker && h('div', { className: 'ts-picker' },
            h('label', { className: 'ts-label' }, '会话来源工作区', h('select', { 'aria-label': '会话来源工作区', value: sourceWorkspaceId, disabled: blocked, onChange: e => showSessions(false, e.target.value) }, !workspaces.some(w => w.id === sourceWorkspaceId) && h('option', { value: sourceWorkspaceId, disabled: true }, '原工作区已移除，请重新选择'), ...workspaces.map(w => h('option', { key: w.id, value: w.id }, w.title)))),
            h('p', { className: 'ts-muted' }, '可切换工作区选择会话。关联不会移动原会话。'),
            sourceLoading ? h('p', null, '正在读取会话…') : sessions.length ? sessions.map(session => h('button', { key: session.id, type: 'button', disabled: blocked || session.archived || session.unavailable || shelf.sessionRefs.some(r => r.sessionId === session.id), onClick: () => execute({ action: 'addSession', workspaceId: sourceWorkspaceId, sessionId: session.id }) }, h('span', null, session.title), h('small', null, session.archived ? '已归档' : session.unavailable ? '暂不可用' : shelf.sessionRefs.some(r => r.sessionId === session.id) ? '已关联' : '关联 ＋'))) : h('p', null, '这个工作区没有可显示的会话；读取失败时可切换工作区重试。'), sessionOffset !== null && h(Button, { secondary: true, disabled: blocked || sourceLoading, onClick: () => showSessions(true) }, '加载更多')),
          shelf.sessionRefs.length ? shelf.sessionRefs.map(ref => h('div', { className: 'ts-session', key: ref.id }, h('div', { className: 'ts-session-info' }, h('strong', null, ref.title), h('small', null, `来源工作区：${ref.workspaceTitle ?? shelf.workspaceTitle}`), h('small', null, ref.id === shelf.primarySessionRefId ? '主会话 · 继续任务将打开这里' : '已关联会话')), !shelf.deletedAt && h('div', { className: 'ts-session-actions' }, h(Button, { secondary: true, disabled: blocked, onClick: () => openSession(ref.id) }, '打开'), h(Button, { secondary: true, disabled: blocked || dirty, onClick: () => execute({ action: 'primary', refId: ref.id === shelf.primarySessionRefId ? null : ref.id }) }, ref.id === shelf.primarySessionRefId ? '取消主会话' : '设为主会话'), h(Button, { secondary: true, disabled: blocked || dirty, onClick: () => execute({ action: 'removeSession', refId: ref.id }) }, '取消关联')))) : h('div', { className: 'ts-empty-sessions' }, '把相关讨论关联到这里。会话原文仍由 DSH 保存。')),
        !shelf.deletedAt && h(Handoff, { key: shelf.id, ctx, shelf, memory, workspaces, blocked: blocked || dirty }),
        h('footer', { className: 'ts-detail-footer' }, h('small', null, `最近更新 ${new Date(shelf.updatedAt).toLocaleString()}`), shelf.deletedAt ? h('div', { className: 'ts-inline' }, h(Button, { secondary: true, disabled: blocked, onClick: () => execute({ action: 'restore' }) }, '恢复资料夹'), h(Button, { danger: true, disabled: blocked, onClick: () => { if (window.confirm('永久删除这个资料夹及便签？关联的 DSH 会话不会删除。')) execute({ action: 'purge' }); } }, '永久删除')) : h(Button, { secondary: true, disabled: blocked || dirty, onClick: () => execute({ action: 'trash' }) }, '移入回收区')))
        : h('div', { className: 'ts-welcome' }, h('div', { className: 'ts-welcome-icon' }, h(FolderIcon)), h('h2', null, '下次回来，接着做。'), h('p', null, '为一项工作建一个资料夹。\n关联讨论，写下下一步，随时继续。'), h('div', { className: 'ts-steps' }, h('span', null, '01 选择工作区'), h('span', null, '02 新建资料夹'), h('span', null, '03 关联会话与下一步'))))),
    h('div', { className: 'ts-bottom-note' }, 'DSH Task Shelf 1 · 1.0.2 大肥鱼主题 · 试用版 · AI 摘要会调用模型，本地精简不调用模型'));
}
function apply(ctx) {
  const memory = { current: {}, drafts: {}, handoffs: {}, pending: null };
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.pluginCss = PANEL; style.textContent = CSS; document.head.append(style); return () => style.remove(); }, 'task-shelf styles');
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, () => h(Panel, { ctx, memory })));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 80, label: '任务资料夹' }, FolderIcon));
}
