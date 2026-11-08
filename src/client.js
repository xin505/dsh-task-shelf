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
function FolderIcon() { return h(Icon, { name: 'folder' }); }
function Button({ children, onClick, secondary, danger, className = '', ...props }) { return h('button', { type: 'button', className: `ts-button ${secondary ? 'ts-secondary' : ''} ${danger ? 'ts-danger' : ''} ${className}`, onClick, ...props }, children); }
function IconButton({ label, icon, ...props }) { return h(Button, { secondary: true, className: 'ts-icon-button', 'aria-label': label, title: label, ...props }, h(Icon, { name: icon, size: 18 })); }
function Menu({ label, children, icon = 'more-horizontal', className = '', text }) {
  const ref = useRef(null);
  useEffect(() => {
    const closeOutside = event => { if (ref.current?.open && !ref.current.contains(event.target)) ref.current.open = false; };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);
  return h('details', { ref, className: `ts-menu ${className}`,
    onToggle: event => { if (event.currentTarget.open) for (const other of document.querySelectorAll('.ts-root details.ts-menu[open]')) if (other !== event.currentTarget) other.open = false; },
    onKeyDown: event => { if (event.key === 'Escape' && ref.current?.open) { event.stopPropagation(); ref.current.open = false; ref.current.querySelector('summary').focus(); } }
  }, h('summary', { 'aria-label': label, title: label }, text, h(Icon, { name: icon, size: 18 })),
    h('div', { className: 'ts-menu-content', onClick: event => { if (event.target.closest('button') && ref.current) ref.current.open = false; } }, children));
}
function updatedLabel(value) {
  const date = new Date(value), now = new Date();
  if (!Number.isFinite(date.getTime())) return '时间未知';
  const age = now - date;
  if (age >= 0 && age < 60000) return '刚刚更新';
  if (date.toDateString() === now.toDateString()) return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}
function Panel({ ctx, memory }) {
  const [workspaces, setWorkspaces] = useState([]), [workspaceId, setWorkspaceId] = useState(memory.workspaceId || '');
  const [shelves, setShelves] = useState([]), [shelf, setShelf] = useState(null), [query, setQuery] = useState(''), [trash, setTrash] = useState(false);
  const [title, setTitle] = useState(''), [nextStep, setNextStep] = useState(''), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [creating, setCreating] = useState(false), [newTitle, setNewTitle] = useState('');
  const [savingText, setSavingText] = useState(false);
  const [editing, setEditing] = useState(false), [detailTab, setDetailTab] = useState('overview');
  const [showDetail, setShowDetail] = useState(false), [diagnostics, setDiagnostics] = useState(false);
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
    setPicker(false); setEditing(!!saved?.dirty); setShowDetail(true); draftVersion.current++;
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
    selectionVersion.current++; setWorkspaceId(value); setShelf(null); setPicker(false); setError(''); setNotice(''); setCreating(false); setShowDetail(false); setEditing(false); setDetailTab('overview');
  }
  async function chooseShelf(row) {
    if (!allowSwitch()) return;
    setError(''); setNotice(''); try { await loadShelf(row.id); setDetailTab('overview'); } catch(e) { setError(e.message); }
  }
  function setCurrentTask(row) { const next = { ...current, [row.workspaceId]: row.id }; setCurrent(next); memory.current = next; setNotice(`当前任务：${row.title}`); }
  function rememberPending(value) { memory.pending = value; setPending(value); }
  async function finish(request, result, version) {
    rememberPending(null);
    const refreshed = await refreshList();
    const hasNewEdits = request.action === 'edit' && version !== draftVersion.current;
    if (request.action === 'purge') { delete memory.drafts[request.shelfId]; setShelf(null); setShowDetail(false); memory.selectedId = null; }
    else if (result.shelfId) {
      if (request.action === 'edit') {
        // Update only the saved baseline. Never replace the current text with an
        // asynchronous detail fetch, including edits typed during refreshList.
        setShelf(old => old?.id === result.shelfId ? { ...old, title: request.title.trim(), nextStep: request.nextStep, revision: result.revision, updatedAt: refreshed.find(s => s.id === result.shelfId)?.updatedAt ?? old.updatedAt } : old);
        if (!hasNewEdits) { setTitle(request.title.trim()); setEditing(false); }
      } else { delete memory.drafts[result.shelfId]; await loadShelf(result.shelfId, false); }
    }
    if (request.action === 'trash') { setTrash(true); setDetailTab('overview'); }
    if (request.action === 'restore') setTrash(false);
    if (request.action === 'create') { setDetailTab('overview'); setCreating(false); setNewTitle(''); setCurrentTask({ id: result.shelfId, workspaceId: request.workspaceId, title: request.title }); }
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
  function beginEdit() { if (!blocked && shelf && !shelf.deletedAt) { setDetailTab('overview'); setEditing(true); } }
  function cancelEdit() {
    if (blocked || (dirty && !window.confirm('放弃这次尚未保存的修改？'))) return;
    draftVersion.current++; setTitle(shelf.title); setNextStep(shelf.nextStep); setEditing(false); setError(''); setNotice('');
  }
  function switchTrash(value) {
    if (!allowSwitch()) return;
    selectionVersion.current++; setTrash(value); setShelf(null); setPicker(false); setEditing(false); setCreating(false); setShowDetail(false); setDetailTab('overview'); setQuery(''); setError(''); setNotice('');
  }
  const rows = shelves.filter(s => s.workspaceId === workspaceId && !!s.deletedAt === trash && s.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  const options = [...workspaces]; for (const s of shelves) if (!options.some(w => w.id === s.workspaceId)) options.push({ id: s.workspaceId, title: `${s.workspaceTitle}（已移除）` });
  const blocked = busy || !!pending;
  const trashCount = shelves.filter(s => s.workspaceId === workspaceId && s.deletedAt).length;
  const saveState = pending ? '结果待确认' : busy ? '保存中…' : dirty ? '有未保存修改' : '已保存';
  const healthText = healthError ? '自检暂不可用' : !health ? '正在获取自检结果' : health.status === 'ok' ? '启动自检通过' : health.status === 'warning' ? '启动自检有提醒' : '启动自检异常';
  const noteBytes = new TextEncoder().encode(nextStep).length;
  const canSave = !blocked && dirty && !!title.trim() && noteBytes <= 4096;
  const menuButton = (label, onClick, disabled = blocked, danger = false) => h('button', { type: 'button', disabled, onClick, className: danger ? 'ts-danger-text' : '' }, label);
  const linkButton = (label, onClick, props = {}) => h(Button, { secondary: true, className: 'ts-link-button', onClick, ...props }, label);

  const editorView = shelf && editing && h('form', { className: 'ts-editor', onSubmit: event => { event.preventDefault(); if (canSave) execute({ action: 'edit', title, nextStep }); } },
    h('label', { className: 'ts-label' }, '资料夹名称', h('input', { autoFocus: true, className: 'ts-title-input', value: title, maxLength: 120, disabled: !!pending || (busy && !savingText), onChange: event => { draftVersion.current++; setTitle(event.target.value); } })),
    h('label', { className: 'ts-label', htmlFor: 'ts-next-step' }, '下一步'),
    h('textarea', { id: 'ts-next-step', value: nextStep, placeholder: '下次从哪里继续？', rows: 4, disabled: !!pending || (busy && !savingText), onChange: event => { draftVersion.current++; setNextStep(event.target.value); } }),
    h('div', { className: 'ts-edit-footer' }, h('span', { className: noteBytes > 4096 ? 'ts-danger-text' : 'ts-muted' }, `${noteBytes} / 4096 字节`),
      h('div', { className: 'ts-inline' }, h(Button, { secondary: true, disabled: blocked, onClick: cancelEdit }, '取消编辑'), h(Button, { type: 'submit', disabled: !canSave }, '保存修改'))),
    dirty && h('div', { className: 'ts-inline ts-draft-actions' },
      linkButton('复制草稿', async () => { try { await navigator.clipboard.writeText(`${title}\n\n${nextStep}`); setNotice('草稿已复制。'); } catch { download(`${title}\n\n${nextStep}`, 'txt', 'text/plain'); setNotice('草稿已下载。'); } }),
      linkButton('重新加载', async () => { if (window.confirm('重新加载会丢弃这里的未保存修改，是否继续？')) { delete memory.drafts[shelf.id]; try { await loadShelf(shelf.id, false); setError(''); } catch(e) { setError(e.message); } } }, { disabled: blocked })));

  const sessionsView = shelf && h('section', { className: 'ts-sessions' },
    h('div', { className: 'ts-section-heading' }, h('h3', null, '相关会话', h('span', { className: 'ts-count' }, shelf.sessionRefs.length)),
      !shelf.deletedAt && linkButton(h(React.Fragment, null, h(Icon, { name: picker ? 'x' : 'plus', size: 17 }), picker ? '收起选择' : '关联会话'), () => picker ? setPicker(false) : showSessions(false, shelf.workspaceId), { 'aria-label': picker ? '收起选择' : '关联会话', disabled: blocked || dirty })),
    dirty && h('p', { className: 'ts-muted' }, '先保存上面的修改，再调整会话关联。'),
    picker && h('div', { className: 'ts-picker' },
      h('label', { className: 'ts-label' }, '会话来源工作区', h('select', { 'aria-label': '会话来源工作区', value: sourceWorkspaceId, disabled: blocked, onChange: event => showSessions(false, event.target.value) }, !workspaces.some(w => w.id === sourceWorkspaceId) && h('option', { value: sourceWorkspaceId, disabled: true }, '原工作区已移除，请重新选择'), ...workspaces.map(w => h('option', { key: w.id, value: w.id }, w.title)))),
      h('p', { className: 'ts-muted' }, '可切换工作区选择会话。关联不会移动原会话。'),
      sourceLoading ? h('p', null, '正在读取会话…') : sessions.length ? sessions.map(session => h('button', { key: session.id, type: 'button', disabled: blocked || session.archived || session.unavailable || shelf.sessionRefs.some(r => r.sessionId === session.id), onClick: () => execute({ action: 'addSession', workspaceId: sourceWorkspaceId, sessionId: session.id }) },
        h('span', null, session.title), h('small', null, session.archived ? '已归档' : session.unavailable ? '暂不可用' : shelf.sessionRefs.some(r => r.sessionId === session.id) ? '已关联' : '关联'))) : h('p', null, '这个工作区没有可显示的会话；读取失败时可切换工作区重试。'),
      sessionOffset !== null && h(Button, { secondary: true, disabled: blocked || sourceLoading, onClick: () => showSessions(true) }, '加载更多')),
    shelf.sessionRefs.length ? shelf.sessionRefs.map(ref => h('div', { className: 'ts-session', key: ref.id },
      h(Icon, { name: 'message-square' }),
      h('div', { className: 'ts-session-info' }, h('strong', null, ref.title, ref.id === shelf.primarySessionRefId && h('span', { className: 'ts-badge' }, '主会话')), h('small', null, ref.workspaceTitle ?? shelf.workspaceTitle)),
      !shelf.deletedAt && h('div', { className: 'ts-session-actions' },
        h(IconButton, { label: `打开会话：${ref.title}`, icon: 'arrow-right', disabled: blocked, onClick: () => openSession(ref.id) }),
        h(Menu, { label: `会话操作：${ref.title}` },
          menuButton(ref.id === shelf.primarySessionRefId ? '取消主会话' : '设为主会话', () => execute({ action: 'primary', refId: ref.id === shelf.primarySessionRefId ? null : ref.id }), blocked || dirty),
          menuButton('取消关联', () => execute({ action: 'removeSession', refId: ref.id }), blocked || dirty)))))
      : h('div', { className: 'ts-empty-sessions' }, h(Icon, { name: 'message-square', size: 26 }), h('p', null, '还没有关联会话'), h('small', null, '把相关讨论收在这里，原会话仍由 DSH 保存。')));

  const overviewView = shelf && h('div', { id: 'ts-overview-panel', role: 'tabpanel', 'aria-labelledby': 'ts-overview-tab', hidden: detailTab !== 'overview', className: 'ts-overview' },
    editing ? editorView : h('section', { className: 'ts-next' },
      h('div', { className: 'ts-note-heading' }, h('h3', null, '下一步'), !shelf.deletedAt && linkButton('编辑', beginEdit, { 'aria-label': '编辑下一步', disabled: blocked })),
      h('p', { className: `ts-note-body ${nextStep ? '' : 'ts-muted'}` }, nextStep || '写下下一步，下次回来就知道从哪里继续。')),
    sessionsView,
    !shelf.deletedAt && h('button', { type: 'button', className: 'ts-handoff-entry', onClick: () => setDetailTab('handoff') }, h(Icon, { name: 'folder' }), h('span', null, '把讨论带到新的工作区'), h('strong', null, '整理交接包'), h(Icon, { name: 'arrow-right', size: 18 })));

  const detailView = shelf ? h(React.Fragment, null,
    h('header', { className: 'ts-detail-heading' },
      h('div', { className: 'ts-kicker' }, h(Icon, { name: 'folder', size: 17 }), shelf.workspaceTitle),
      h('div', { className: 'ts-title-row' },
        h('div', { className: 'ts-title-group' }, h('h2', { className: 'ts-task-title' }, shelf.title), !shelf.deletedAt && h(IconButton, { label: '编辑资料夹', icon: 'edit-3', disabled: blocked, onClick: beginEdit })),
        !shelf.deletedAt && h('div', { className: 'ts-detail-actions' }, h(Button, { 'aria-label': '继续会话', disabled: blocked || !shelf.primarySessionRefId, title: shelf.primarySessionRefId ? '打开主会话' : '关联会话并设为主会话后可继续', onClick: () => openSession() }, '继续会话', h(Icon, { name: 'arrow-up-right', size: 17 })),
          h(Menu, { label: '资料夹操作' }, menuButton('编辑资料夹', beginEdit), menuButton(current[shelf.workspaceId] === shelf.id ? '当前任务' : '设为当前任务', () => setCurrentTask(shelf), blocked || current[shelf.workspaceId] === shelf.id), menuButton('移入回收区', () => execute({ action: 'trash' }), blocked || dirty, true)))),
      h('div', { className: 'ts-meta' }, (shelf.deletedAt || current[shelf.workspaceId] === shelf.id) && h('span', { className: 'ts-badge' }, shelf.deletedAt ? '回收区' : '当前任务'), h('span', null, `${shelf.sessionRefs.length} 个关联会话 · ${updatedLabel(shelf.updatedAt)}`)),
      !shelf.deletedAt && !shelf.primarySessionRefId && h('p', { className: 'ts-muted ts-primary-hint' }, '关联会话后，在会话操作中设为主会话，即可从这里继续。')),
    !shelf.deletedAt && h('div', { className: 'ts-detail-tabs', role: 'tablist', 'aria-label': '资料夹视图', onKeyDown: event => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']; if (!keys.includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'handoff' : detailTab === 'overview' ? 'handoff' : 'overview';
      setDetailTab(next); event.currentTarget.querySelector(`#ts-${next}-tab`).focus();
    } }, ...[['overview', '资料概览'], ['handoff', '会话交接']].map(([value, label]) => h('button', { key: value, type: 'button', id: `ts-${value}-tab`, role: 'tab', 'aria-controls': `ts-${value}-panel`, 'aria-selected': detailTab === value, tabIndex: detailTab === value ? 0 : -1, className: detailTab === value ? 'active' : '', onClick: () => setDetailTab(value) }, label))),
    overviewView,
    !shelf.deletedAt && h('div', { id: 'ts-handoff-panel', role: 'tabpanel', 'aria-labelledby': 'ts-handoff-tab', hidden: detailTab !== 'handoff' },
      dirty && h('p', { className: 'ts-banner ts-warning', role: 'status' }, '资料概览中有未保存修改，请先保存后再生成交接包。'),
      h(Handoff, { key: shelf.id, ctx, shelf, memory, workspaces, blocked: blocked || dirty })),
    shelf.deletedAt && h('div', { className: 'ts-trash-actions' }, h('p', { className: 'ts-muted' }, '资料夹在回收区中。恢复后可继续编辑，原会话没有删除。'), h('div', { className: 'ts-inline' }, h(Button, { disabled: blocked, onClick: () => execute({ action: 'restore' }) }, '恢复资料夹'), h(Button, { secondary: true, className: 'ts-danger-text', disabled: blocked, onClick: () => { if (window.confirm('永久删除这个资料夹及便签？关联的 DSH 会话不会删除。')) execute({ action: 'purge' }); } }, '永久删除'))))
    : h('div', { className: 'ts-welcome' }, h('div', { className: 'ts-welcome-icon' }, h(Icon, { name: 'folder', size: 36 })), h('h2', null, trash ? '回收区' : '从一项工作开始'), h('p', null, trash ? '选择一个资料夹，查看内容或恢复。' : '选择左侧资料夹，或者新建一个。\n把下一步和相关讨论放在一起。'));

  return h('div', { className: `ts-root ${shelf ? 'ts-has-selection' : ''} ${showDetail && shelf ? 'ts-detail-visible' : ''}` },
    h('header', { className: 'ts-header' }, h('div', { className: 'ts-brand' }, h(FolderIcon), h('h1', null, '任务资料夹'), h('small', null, 'Task Shelf')),
      h(Menu, { label: '工具', text: '工具', icon: 'chevron-down', className: 'ts-tools' }, menuButton('导出备份', () => exportBackup(), false), menuButton('导入备份', () => fileInput.current.click()), menuButton('查看诊断', () => setDiagnostics(true), false)),
      h('input', { ref: fileInput, type: 'file', accept: '.json,application/json', hidden: true, onChange: previewImport })),
    diagnostics && h('section', { className: 'ts-diagnostics', 'aria-label': '诊断与版本' }, h('div', { className: 'ts-section-heading' }, h('h2', null, '诊断与版本'), h(IconButton, { label: '关闭诊断', icon: 'x', onClick: () => setDiagnostics(false) })),
      h('p', null, `DSH Task Shelf 1.1.0 · ${healthText}`), health && h(React.Fragment, null, h('p', { className: 'ts-muted' }, `构建 ${health.build} · 检查于 ${new Date(health.checkedAt).toLocaleString()}`), ...health.checks.map(check => h('p', { key: check.name }, `${({ ok: '通过', info: '说明', warning: '提醒', error: '异常' })[check.status]}：${check.message}`)),
        h('p', { className: 'ts-muted' }, '这是本次插件加载时的检查结果，不代表持续监控。报告不含聊天、便签和文件路径。'), h(Button, { secondary: true, onClick: () => download(JSON.stringify(health, null, 2), 'json', 'application/json') }, '导出诊断报告'))),
    (healthError || (health && health.status !== 'ok')) && h('div', { className: `ts-banner ${health?.status === 'error' ? 'ts-error' : 'ts-warning'}`, role: 'alert' }, healthError || healthText, linkButton('查看诊断', () => setDiagnostics(true))),
    error && h('div', { className: 'ts-banner ts-error', role: 'alert' }, error, h('div', { className: 'ts-inline' }, h(Button, { secondary: true, disabled: busy, onClick: async () => { try { await refreshList(); setError(''); } catch(e) { setError(e.message); } } }, '刷新列表'), h(Button, { secondary: true, onClick: () => exportBackup(true) }, '导出上一份备份'))),
    pending && h('div', { className: 'ts-banner ts-warning', role: 'status' }, '有一项操作的结果待确认。', h('div', { className: 'ts-inline' }, h(Button, { disabled: busy, onClick: confirmPending }, '查询保存结果'), h(Button, { secondary: true, disabled: busy, onClick: () => execute(pending.request, true) }, '重试原操作'))),
    importPreview && h('section', { className: 'ts-import' }, h('h2', null, '确认导入'), h('p', null, `将新增 ${importPreview.shelves.length} 个资料夹，保留现有内容。只支持当前 DSH 中仍存在的工作区与会话；引用失效时整批拒绝。`), h('p', { className: 'ts-muted' }, '备份中的便签和回收区也会恢复。不会覆盖同名资料夹，也不会自动发送消息。'), h('div', { className: 'ts-inline' }, h(Button, { disabled: blocked, onClick: () => execute({ action: 'import', backup: importPreview }) }, '确认新增导入'), h(Button, { secondary: true, disabled: blocked, onClick: () => setImportPreview(null) }, '取消'))),
    h('div', { className: 'ts-layout' },
      h('aside', { className: 'ts-list', 'aria-label': '资料夹列表' },
        h('label', { className: 'ts-label' }, '工作区', h('select', { value: workspaceId, disabled: blocked, onChange: event => chooseWorkspace(event.target.value), 'aria-label': '工作区' }, !options.length && h('option', { value: '' }, '请先在 DSH 添加工作区'), ...options.map(w => h('option', { key: w.id, value: w.id }, w.title)))),
        h('div', { className: 'ts-search-field' }, h(Icon, { name: 'search', size: 17 }), h('input', { className: 'ts-search', placeholder: '搜索资料夹…', value: query, onChange: event => setQuery(event.target.value), 'aria-label': '搜索资料夹' })),
        h('div', { className: 'ts-list-heading' }, h('span', null, trash ? '回收区' : '资料夹', h('small', { className: 'ts-count' }, rows.length)),
          !trash && linkButton(h(React.Fragment, null, h(Icon, { name: 'plus', size: 16 }), '新建'), () => { if (allowSwitch()) { setCreating(true); setNewTitle(''); } }, { 'aria-label': '新建资料夹', disabled: blocked || !workspaces.some(w => w.id === workspaceId) })),
        creating && h('form', { className: 'ts-create', onSubmit: event => { event.preventDefault(); if (newTitle.trim() && !blocked && allowSwitch()) execute({ action: 'create', workspaceId, title: newTitle }); } }, h('label', { className: 'ts-label' }, '资料夹名称', h('input', { autoFocus: true, value: newTitle, maxLength: 120, placeholder: '例如：登录异常排查', onChange: event => setNewTitle(event.target.value) })), h('div', { className: 'ts-inline' }, h(Button, { type: 'submit', disabled: blocked || !newTitle.trim() }, '创建'), h(Button, { secondary: true, disabled: blocked, onClick: () => setCreating(false) }, '取消'))),
        h('div', { className: 'ts-card-list' }, loading ? h('p', { className: 'ts-muted' }, '正在读取…') : rows.length ? rows.map(row => h('button', { key: row.id, type: 'button', className: `ts-card ${shelf?.id === row.id ? 'selected' : ''}`, 'aria-current': shelf?.id === row.id ? 'true' : undefined, onClick: () => chooseShelf(row), disabled: blocked }, h('strong', null, row.title), h('small', null, `${row.sessionCount} 个会话 · ${updatedLabel(row.updatedAt)}`))) : h('div', { className: 'ts-list-empty' }, trash ? '回收区为空' : query ? '没有匹配的资料夹' : '这里还没有资料夹。点击新建开始整理。')),
        h('div', { className: 'ts-list-bottom' }, linkButton(h(React.Fragment, null, h(Icon, { name: trash ? 'arrow-left' : 'trash-2', size: 18 }), trash ? '返回资料夹' : '回收区', !trash && h('span', { className: 'ts-count' }, trashCount)), () => switchTrash(!trash), { 'aria-label': trash ? '资料夹列表' : '回收区', disabled: blocked }))),
      h('main', { className: 'ts-detail', 'aria-label': '资料夹详情' },
        linkButton(h(React.Fragment, null, h(Icon, { name: 'arrow-left', size: 18 }), '返回资料夹列表'), () => setShowDetail(false), { className: 'ts-link-button ts-back', 'aria-label': '返回资料夹列表' }),
        detailView,
        h('footer', { className: 'ts-statusbar' }, h('span', { className: 'ts-save-state', role: 'status', 'aria-live': 'polite' }, h(Icon, { name: dirty || pending ? 'info' : 'check', size: 16 }), shelf ? saveState : '准备就绪'),
          h('span', { className: 'ts-notice', role: 'status', 'aria-live': 'polite' }, notice && notice !== '已保存' ? notice : ''),
          linkButton(healthText, () => setDiagnostics(true), { className: 'ts-link-button ts-health-link', title: '查看版本和启动自检报告' })))));
}

function apply(ctx) {
  const memory = { current: {}, drafts: {}, handoffs: {}, pending: null };
  ctx.effect(() => {
    const warn = event => { if (memory.pending || Object.values(memory.drafts).some(draft => draft.dirty)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, 'task-shelf draft protection');
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.pluginCss = PANEL; style.textContent = CSS; document.head.append(style); return () => style.remove(); }, 'task-shelf styles');
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, () => h(Panel, { ctx, memory })));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 80, label: '任务资料夹' }, FolderIcon));
}
