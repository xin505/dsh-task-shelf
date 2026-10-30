function HandoffWorkspace({ workspace, selected, onToggle, disabled, initiallyOpen }) {
  const [open, setOpen] = useState(initiallyOpen), [rows, setRows] = useState([]), [offset, setOffset] = useState(null);
  const [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const live = useRef(true), request = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  async function load(append = false) {
    const token = ++request.current; setLoading(true); setError('');
    try {
      const value = await api(`catalog?workspaceId=${encodeURIComponent(workspace.id)}&offset=${append ? offset : 0}`);
      if (!live.current || token !== request.current) return;
      setRows(old => append ? [...old, ...value.items] : value.items); setOffset(value.nextOffset); setLoaded(true);
    } catch(e) { if (live.current && token === request.current) setError(e.message); }
    finally { if (live.current && token === request.current) setLoading(false); }
  }
  useEffect(() => { if (open && !loaded) load(); }, [open]);
  const count = selected.filter(s => s.workspaceId === workspace.id).length;
  return h('section', { className: 'ts-handoff-workspace', 'data-workspace-id': workspace.id },
    h('button', { type: 'button', className: 'ts-workspace-toggle', 'aria-expanded': open, onClick: () => setOpen(v => !v) }, `${open ? '▾' : '▸'} ${workspace.title}${count ? ` · 已选 ${count}` : ''}`),
    open && h('div', { className: 'ts-workspace-sessions' },
      ...rows.map(row => {
        const checked = selected.some(s => s.sessionId === row.id);
        return h('label', { key: row.id, className: 'ts-source-option' },
          h('input', { type: 'checkbox', checked, disabled: disabled || row.unavailable || (!checked && selected.length >= 5), onChange: () => onToggle({ sessionId: row.id, title: row.title, workspaceId: workspace.id, workspaceTitle: workspace.title }) }),
          h('span', null, row.title, row.archived ? '（已归档）' : row.unavailable ? '（暂不可读）' : ''));
      }),
      loading && h('p', { className: 'ts-muted' }, '正在读取会话列表…'),
      !loading && loaded && !rows.length && h('p', { className: 'ts-muted' }, '这个工作区暂无会话。'),
      error && h('p', { role: 'alert' }, error),
      h('div', { className: 'ts-inline' }, h(Button, { secondary: true, disabled: loading || disabled, onClick: () => load(false) }, error ? '重试读取' : '刷新会话列表'), offset !== null && h(Button, { secondary: true, disabled: loading || disabled, onClick: () => load(true) }, '加载更多会话'))));
}
function HandoffSources({ workspaces, shelf, selected, onChange, disabled }) {
  const [filter, setFilter] = useState('');
  function toggle(source) {
    onChange(selected.some(s => s.sessionId === source.sessionId) ? selected.filter(s => s.sessionId !== source.sessionId) : selected.length < 5 ? [...selected, source] : selected);
  }
  const visible = workspaces.filter(w => w.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return h('div', { className: 'ts-handoff-source-tree' },
    h('p', { className: 'ts-muted' }, '展开工作区，直接勾选其中的会话；可从多个工作区合选，不必先关联到资料夹。'),
    h('input', { type: 'search', 'aria-label': '筛选交接来源工作区', placeholder: '筛选工作区…', value: filter, onChange: e => setFilter(e.target.value) }),
    h('div', { className: 'ts-workspace-tree' }, ...visible.map(w => h(HandoffWorkspace, { key: w.id, workspace: w, selected, onToggle: toggle, disabled, initiallyOpen: w.id === shelf.workspaceId }))),
    !visible.length && h('p', { className: 'ts-muted' }, '没有匹配的工作区。'),
    h('div', { className: 'ts-selected-sources' }, h('strong', null, `已选 ${selected.length} / 5 个会话`),
      ...selected.map(s => h('div', { className: 'ts-selected-row', key: s.sessionId }, h('span', null, s.title, h('small', { className: 'ts-source-workspace' }, `来源工作区：${s.workspaceTitle}`)), h(Button, { secondary: true, disabled, onClick: () => toggle(s) }, '移除'))),
      selected.length === 5 && h('p', { className: 'ts-muted' }, '已选满 5 个；可先移除某个来源再选择其他会话。')));
}
