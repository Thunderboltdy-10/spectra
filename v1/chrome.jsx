// Top bar, atlas strip, minimap (hover-teleport), tray, floating widgets, command bar, spotlight.
const { useState: useS2, useRef: useR2, useEffect: useE2 } = React;

// ─── Top rail: breadcrumb + view modes + search + tools ──────────
const TopRail = ({ workspace, onHome, zoom, onAtlas, trayCount, onOpenTray, onSpotlight,
                   viewMode, onViewMode, widgetsHidden, onToggleWidgets, onAddWidget }) => {
  const inWs = workspace && workspace.id !== 'atlas';
  const modes = [
    { id:'spatial',  label:'Spatial',  icon:'layout'   },
    { id:'type',     label:'By type',  icon:'grid'     },
    { id:'topic',    label:'By topic', icon:'topic'    },
    { id:'timeline', label:'Timeline', icon:'timeline' },
  ];
  return (
    <div className="absolute top-0 left-0 right-0 h-14 flex items-center justify-between px-5 z-30 pointer-events-none">
      <div className="flex items-center gap-3 pointer-events-auto">
        <button onClick={onHome} className="w-8 h-8 rounded-full border border-line bg-paper/80 backdrop-blur flex items-center justify-center text-ink-300 hover:text-accent hover:border-accent/40 transition-colors">
          <div className="w-2 h-2 rounded-full" style={{ background:'linear-gradient(135deg,#0e8ee8,#20b8b2)' }}/>
        </button>
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">Spectra</div>
        <span className="text-ink-400">·</span>
        <button onClick={onAtlas} className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-300 hover:text-accent transition-colors">Atlas</button>
        {inWs && (<>
          <Icon name="chevron" size={12} className="text-ink-400" />
          <div className="flex items-center gap-1.5">
            <span className="font-display text-[14px]" style={{ color:workspace.color }}>{workspace.glyph}</span>
            <span className="font-display text-[17px] text-ink-100">{workspace.name}</span>
            <span className="text-[11px] text-ink-400 font-mono ml-2">{workspace.subtitle}</span>
          </div>
        </>)}
      </div>

      <div className="flex items-center gap-2 pointer-events-auto">
        {inWs && (
          <div className="flex items-center p-0.5 bg-paper/80 backdrop-blur border border-line rounded-full">
            {modes.map(m => (
              <button key={m.id} onClick={() => onViewMode(m.id)}
                      className={`px-2.5 h-7 rounded-full flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.1em] transition-colors ${viewMode === m.id ? 'bg-accent text-white' : 'text-ink-300 hover:text-ink-100'}`}
                      title={`${m.label} (press ${['1','2','3','4'][modes.indexOf(m)]})`}>
                <Icon name={m.icon} size={11} />
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        )}
        <button onClick={onToggleWidgets} className={`h-8 px-3 rounded-full border flex items-center gap-1.5 transition-colors ${widgetsHidden ? 'border-line bg-paper/80 text-ink-300' : 'border-accent/40 bg-paper text-accent'}`} title="Toggle floating widgets (W)">
          <Icon name="widget" size={12} />
          <span className="text-[10.5px] font-mono uppercase tracking-[0.12em]">Widgets</span>
        </button>
        <button onClick={onSpotlight} className="flex items-center gap-2 px-3 h-8 rounded-full border border-line bg-paper/80 backdrop-blur hover:border-accent/40 transition-colors">
          <Icon name="search" size={13} className="text-ink-400" />
          <span className="text-[12px] text-ink-300">Jump to anything</span>
          <span className="kbd">⌘K</span>
        </button>
        <button onClick={onOpenTray} className="relative h-8 px-3 rounded-full border border-line bg-paper/80 backdrop-blur flex items-center gap-2 hover:border-accent/40">
          <Icon name="tray" size={13} className="text-ink-400" />
          <span className="text-[11px] font-mono uppercase tracking-[0.12em] text-ink-300">Tray</span>
          {trayCount > 0 && <span className="font-mono text-[10px] text-accent">{trayCount}</span>}
        </button>
        <div className="h-8 px-3 rounded-full border border-line bg-paper/80 backdrop-blur flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-ink-400">zoom</span>
          <span className="font-mono text-[10.5px] text-ink-100 tabular-nums">{Math.round(zoom*100)}%</span>
        </div>
      </div>
    </div>
  );
};

// ─── Atlas strip ─────────────────────────────────────────────────
const AtlasStrip = ({ workspaces, current, onPick }) => (
  <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
    <div className="flex items-center gap-1 p-1 bg-paper/80 backdrop-blur border border-line rounded-full">
      {workspaces.filter(w => w.id !== 'atlas').map(w => (
        <button key={w.id} onClick={() => onPick(w.id)}
                className={`atlas-tile px-3 py-1.5 rounded-full border flex items-center gap-1.5 ${current === w.id ? 'active border-accent/60' : 'border-transparent'}`}>
          <span className="font-display text-[13px]" style={{ color:w.color }}>{w.glyph}</span>
          <span className="text-[11px] font-medium text-ink-200">{w.name}</span>
        </button>
      ))}
      <div className="w-px h-5 bg-line mx-0.5" />
      <button className="px-2 py-1.5 rounded-full text-ink-400 hover:text-accent"><Icon name="plus" size={13}/></button>
    </div>
  </div>
);

// ─── Minimap — hover-teleports, drag-teleports ───────────────────
const Minimap = ({ workspaces, items, viewport, worldSize, onLensMove, onWorkspaceClick }) => {
  const W = 220, H = 140;
  const scale = Math.min(W / worldSize.w, H / worldSize.h);
  const ox = W/2, oy = H/2;

  const dragRef = useR2(null);
  const move = (e, el) => {
    const rect = (el || dragRef.current?.rect);
    if (!rect) return;
    const mx = e.clientX - rect.left - ox;
    const my = e.clientY - rect.top - oy;
    onLensMove(mx / scale, my / scale);
  };
  const onMouseDown = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = { rect };
    move(e, rect);
  };
  const onMouseMoveInner = (e) => {
    if (dragRef.current) move(e);
  };
  const onMouseUp = () => { dragRef.current = null; };
  useE2(() => {
    window.addEventListener('mousemove', onMouseMoveInner);
    window.addEventListener('mouseup', onMouseUp);
    return () => { window.removeEventListener('mousemove', onMouseMoveInner); window.removeEventListener('mouseup', onMouseUp); };
  }, []);

  return (
    <div className="absolute bottom-5 right-5 z-30 pointer-events-auto">
      <div className="bg-paper/94 backdrop-blur border border-line rounded-xl p-2 shadow-soft">
        <div className="flex items-center justify-between mb-1.5 px-1">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-400">Map · drag to fly</span>
          <span className="font-mono text-[9px] text-ink-400">{items.length} items</span>
        </div>
        <div className="relative" style={{ width:W, height:H, background:'#ede9e3', borderRadius:6, cursor:'crosshair' }}
             onMouseDown={onMouseDown}>
          {workspaces.filter(w => w.id !== 'atlas').map(w => (
            <div key={w.id}
                 onClick={(e) => { e.stopPropagation(); onWorkspaceClick(w.id); }}
                 className="absolute rounded-sm cursor-pointer hover:opacity-80 transition-opacity"
                 style={{
                   left: ox + (w.cx - w.w/2) * scale, top: oy + (w.cy - w.h/2) * scale,
                   width: w.w * scale, height: w.h * scale,
                   background: w.color, opacity: 0.16,
                   border: `1px solid ${w.color}60`,
                 }}>
              <div className="absolute top-0.5 left-1 font-display text-[8px]" style={{ color:w.color }}>{w.name}</div>
            </div>
          ))}
          {items.map(it => (
            <div key={it.id} className="absolute rounded-full"
                 style={{ left: ox + it.x * scale - 1, top: oy + it.y * scale - 1, width:2, height:2, background:it.color }}/>
          ))}
          <div className="absolute lens-pulse pointer-events-none" style={{
            left: ox + viewport.x * scale - (viewport.w*scale)/2,
            top:  oy + viewport.y * scale - (viewport.h*scale)/2,
            width:  Math.max(20, viewport.w * scale),
            height: Math.max(14, viewport.h * scale),
            border:'1.5px solid #0e8ee8', borderRadius:3,
            background:'rgba(14,142,232,0.07)',
          }}/>
        </div>
      </div>
    </div>
  );
};

// ─── Tray (no widgets here anymore — they float) ─────────────────
const Tray = ({ open, items, pinned, onClose, onRemove, onAction }) => {
  if (!open) return null;
  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-24 z-30 pointer-events-auto tray-in">
      <div className="bg-paper/94 backdrop-blur border border-line rounded-2xl shadow-soft px-3 py-3 min-w-[620px] max-w-[85vw]">
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-2">
            <Icon name="tray" size={13} className="text-ink-300" />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-300">Working tray</span>
            <span className="font-mono text-[10px] text-ink-400">{items.length + pinned.length} queued</span>
          </div>
          <button onClick={onClose} className="w-5 h-5 rounded-full flex items-center justify-center text-ink-400 hover:text-ink-100"><Icon name="close" size={11}/></button>
        </div>

        {items.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {items.map(it => (
                <div key={it.id} className="group flex items-center gap-2 pl-2 pr-1.5 py-1 bg-bg2/60 border border-line rounded-full">
                  <span style={{ color:it.color }}><Icon name={it.kind} size={10}/></span>
                  <span className="text-[11.5px] text-ink-200 max-w-[140px] truncate">{it.title}</span>
                  <button onClick={() => onRemove(it.id)} className="w-4 h-4 rounded-full flex items-center justify-center text-ink-400 hover:text-coral"><Icon name="close" size={9}/></button>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <button onClick={() => onAction('bloom')} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-paper border border-line rounded-lg hover:border-accent/50 hover:text-accent">
                <Icon name="layout" size={12}/><span className="text-[11px] font-mono uppercase tracking-[0.1em]">Open side-by-side</span>
              </button>
              <button onClick={() => onAction('compare')} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-paper border border-line rounded-lg hover:border-accent/50 hover:text-accent">
                <Icon name="compare" size={12}/><span className="text-[11px] font-mono uppercase tracking-[0.1em]">Compare</span>
              </button>
              <button onClick={() => onAction('merge')} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-paper border border-line rounded-lg hover:border-accent/50 hover:text-accent">
                <Icon name="merge" size={12}/><span className="text-[11px] font-mono uppercase tracking-[0.1em]">Merge</span>
              </button>
              <button onClick={() => onAction('quiz')} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-paper border border-line rounded-lg hover:border-accent/50 hover:text-accent">
                <Icon name="quiz-me" size={12}/><span className="text-[11px] font-mono uppercase tracking-[0.1em]">Quiz me</span>
              </button>
              <button onClick={() => onAction('link')} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-paper border border-line rounded-lg hover:border-accent/50 hover:text-accent">
                <Icon name="link" size={12}/><span className="text-[11px] font-mono uppercase tracking-[0.1em]">Link</span>
              </button>
              <button onClick={() => onAction('ask')} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-accent text-white border border-accent rounded-lg hover:bg-accent/90">
                <Icon name="sparkle" size={12}/><span className="text-[11px] font-mono uppercase tracking-[0.1em]">Ask about these</span>
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 border-t border-line/60">
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-400">Pinned</span>
          {pinned.length === 0 && <span className="font-mono text-[10px] text-ink-400 italic">none yet — pin items to keep them across workspaces</span>}
          {pinned.map(p => (
            <div key={p.id} className="flex items-center gap-1.5 px-2 py-1 rounded-full border border-line bg-paper">
              <span style={{color:p.color}}><Icon name={p.kind} size={10}/></span>
              <span className="text-[11px] text-ink-200 truncate max-w-[100px]">{p.title}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Floating widgets (draggable hub surfaces) ───────────────────
const FloatingWidget = ({ widget, onMove, onClose, onTimerToggle, onTimerReset, aiTouched, onAsk }) => {
  const dragRef = useR2(null);
  const onDown = (e) => {
    if (e.target.closest('[data-nodrag]')) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: widget.x, oy: widget.y };
    const move = (ev) => {
      const d = dragRef.current; if (!d) return;
      onMove(widget.id, d.ox + (ev.clientX - d.sx), d.oy + (ev.clientY - d.sy));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div data-widget
         className={`absolute z-20 pointer-events-auto bg-paper/95 backdrop-blur border rounded-xl shadow-soft overflow-hidden drift-in ${aiTouched ? 'ai-touched' : 'border-line'}`}
         style={{ left:widget.x, top:widget.y, width:widget.w, height:widget.h }}
         onMouseDown={e => e.stopPropagation()}>
      <div onMouseDown={onDown} className="cursor-grab active:cursor-grabbing flex items-center justify-between px-3 py-2 border-b border-line/60 bg-bg2/40">
        <div className="flex items-center gap-2">
          <Icon name={widget.kind === 'timer' ? 'timer' : widget.kind === 'planner' ? 'planner' : widget.kind === 'today' ? 'schedule' : widget.kind === 'scratch' ? 'note' : widget.kind === 'library' ? 'reading' : 'widget'} size={11} className="text-ink-300" />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-300">
            {{ timer:'Focus timer', planner:'This week', today:"Today's queue", scratch:'Scratchpad', library:'Library', calendar:'Calendar' }[widget.kind] || widget.kind}
          </span>
        </div>
        <button data-nodrag onClick={() => onClose(widget.id)} className="text-ink-400 hover:text-coral"><Icon name="close" size={10}/></button>
      </div>
      <div className="p-3">
        {widget.kind === 'timer' && <TimerWidget w={widget} onToggle={onTimerToggle} onReset={onTimerReset}/>}
        {widget.kind === 'planner' && <PlannerWidget onAsk={onAsk}/>}
        {widget.kind === 'today' && <TodayWidget onAsk={onAsk}/>}
        {widget.kind === 'scratch' && <ScratchpadWidget/>}
        {widget.kind === 'library' && <LibraryWidget/>}
        {widget.kind === 'calendar' && <CalendarWidget/>}
      </div>
    </div>
  );
};

const TimerWidget = ({ w, onToggle, onReset }) => {
  const s = w.state.secs;
  const mm = String(Math.floor(s/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col">
        <div className="font-display text-[32px] text-ink-100 tabular-nums leading-none">{mm}:{ss}</div>
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-400 mt-1">
          {w.state.running ? 'focus in progress' : 'Pomodoro · 25/5'}
        </div>
      </div>
      <div data-nodrag className="flex items-center gap-1">
        <button onClick={() => onReset(25*60)} className="w-7 h-7 rounded-full border border-line text-ink-400 hover:text-ink-100 flex items-center justify-center" title="Reset">
          <Icon name="undo" size={11}/>
        </button>
        <button onClick={onToggle} className="h-8 px-3 rounded-full text-[11px] font-mono uppercase tracking-[0.12em]"
                style={{ background: w.state.running ? '#e05137' : '#0e8ee8', color:'#fff' }}>
          {w.state.running ? 'Pause' : 'Start'}
        </button>
      </div>
    </div>
  );
};

const PlannerWidget = ({ onAsk }) => {
  const days = [
    { d:'Mon', tasks:['Essay draft §1-2','Calc pset Q1-3'] },
    { d:'Tue', tasks:['Bio: Glycolysis review','Spanish review 30m'] },
    { d:'Wed', tasks:['Full Bio practice test'] },
    { d:'Thu', tasks:['BIO MIDTERM 9:00',''] },
    { d:'Fri', tasks:['Calc pset Q4-7','Essay draft §3-4'] },
  ];
  return (
    <div data-nodrag>
      <div className="flex items-center justify-between mb-2">
        <span className="font-display text-[15px] text-ink-100">Apr 21 – 25</span>
        <button onClick={() => onAsk('Rebalance my plan for this week')} className="text-[10px] font-mono uppercase tracking-[0.12em] text-accent hover:underline flex items-center gap-1">
          <Icon name="sparkle" size={9}/>auto-balance
        </button>
      </div>
      <div className="space-y-1">
        {days.map(d => (
          <div key={d.d} className="flex gap-2 items-start py-1 border-t border-line/50">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-400 w-8 pt-0.5">{d.d}</span>
            <div className="flex-1 flex flex-col gap-0.5">
              {d.tasks.filter(Boolean).map((t,i) => (
                <div key={i} className="text-[11.5px] text-ink-200 flex items-center gap-1.5">
                  <div className="w-1 h-1 rounded-full" style={{background: t.includes('MIDTERM') ? '#e05137' : '#0e8ee8'}}/>
                  <span className={t.includes('MIDTERM') ? 'font-semibold text-coral' : ''}>{t}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const TodayWidget = ({ onAsk }) => {
  const items = [
    { t:'Review 12 biology flashcards', k:'flashcards', c:'#20b8b2', done:true },
    { t:'Essay: rework §3 transition', k:'essay', c:'#b67616', done:false },
    { t:'Calc pset · Q4 (IBP twice)', k:'pset', c:'#0e8ee8', done:false },
    { t:'Spanish subjunctive drill', k:'flashcards', c:'#20b8b2', done:false },
  ];
  return (
    <div data-nodrag>
      <div className="flex items-center justify-between mb-2">
        <span className="font-display text-[15px] text-ink-100">Today · 4 items</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{color:'#148f5d'}}>1 done</span>
      </div>
      <div className="space-y-1.5">
        {items.map((x,i) => (
          <div key={i} className="flex items-center gap-2 py-1">
            <div className="w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0"
                 style={{ borderColor: x.c, background: x.done ? x.c : 'transparent' }}>
              {x.done && <Icon name="check" size={8} stroke="#fff"/>}
            </div>
            <Icon name={x.k} size={11} className="shrink-0" />
            <span className={`text-[11.5px] flex-1 ${x.done ? 'line-through text-ink-400' : 'text-ink-200'}`}>{x.t}</span>
          </div>
        ))}
      </div>
      <button onClick={() => onAsk("What's the most impactful thing to do right now?")} className="mt-2 w-full text-[10.5px] font-mono uppercase tracking-[0.12em] text-accent hover:underline flex items-center gap-1 justify-center py-1 border border-dashed border-line rounded">
        <Icon name="sparkle" size={9}/>what should I start?
      </button>
    </div>
  );
};

const ScratchpadWidget = () => {
  const [txt, setTxt] = useS2('Quick notes for anywhere.\nDrag me around.\nAI will fold into workspace when you ask.');
  return <textarea data-nodrag value={txt} onChange={e=>setTxt(e.target.value)}
                   className="w-full h-[160px] bg-transparent outline-none font-mono text-[12px] text-ink-100 resize-none slim-scroll" />;
};

const LibraryWidget = () => {
  const srcs = [
    { t:'Gatsby — Ch. 5 passage', k:'reading', tag:'eng' },
    { t:'Khan Academy: IBP', k:'reading', tag:'calc' },
    { t:'Krebs cycle diagram', k:'reading', tag:'bio' },
    { t:'Subjuntivo rules (RAE)', k:'reading', tag:'span' },
  ];
  return (
    <div data-nodrag className="space-y-1">
      {srcs.map((s,i) => (
        <div key={i} className="flex items-center gap-2 py-1 border-t border-line/50 first:border-t-0">
          <Icon name="reading" size={10} className="text-ink-400"/>
          <span className="text-[11.5px] text-ink-200 flex-1 truncate">{s.t}</span>
          <span className="font-mono text-[9px] uppercase text-ink-400">{s.tag}</span>
        </div>
      ))}
    </div>
  );
};

const CalendarWidget = () => {
  const days = ['S','M','T','W','T','F','S'];
  const today = 4; // Thu
  return (
    <div data-nodrag>
      <div className="font-display text-[15px] text-ink-100 mb-2">April 2026</div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {days.map((d,i) => <div key={i} className="font-mono text-[9px] uppercase text-ink-400 py-1">{d}</div>)}
        {Array.from({length:30}, (_,i) => (
          <div key={i} className={`text-[10.5px] py-1 rounded ${i+1 === 23 ? 'bg-coral text-white font-semibold' : i+1 === today+20 ? 'bg-accent/15 text-accent font-semibold' : 'text-ink-200'}`}>
            {i+1}
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Command bar with quick starts ───────────────────────────────
const CommandBar = ({ focusedItem, workspace, selectedCount, onSubmit, resultIsland, quickStarts, bloomedCount }) => {
  const [value, setValue] = useS2('');
  const [focused, setFocused] = useS2(false);
  const [suggestions, setSuggestions] = useS2([]);
  const [showQS, setShowQS] = useS2(false);
  const inputRef = useR2();

  const suggestionsFor = () => {
    if (selectedCount > 1) return [`Ask about ${selectedCount} items`, 'Compare', 'Merge into one note', 'Quiz me on all of these'];
    if (focusedItem) {
      const k = focusedItem.kind;
      if (k === 'essay') return ['Strengthen thesis', 'Tighten §3 transition', 'Find counterargument', 'Suggest stronger quote'];
      if (k === 'pset')  return ['Hint for problem 3', 'Check my work', 'Make similar practice'];
      if (k === 'flashcards') return ['Quick review 10', 'Add harder cards', 'Explain what I miss'];
      if (k === 'note')  return ['Explain in 3 lines', 'Turn into flashcards', 'Find related'];
      if (k === 'reading') return ['Summarize', 'Extract key terms', 'Make flashcards'];
      return ['Summarize', 'Find related', 'Turn into flashcards'];
    }
    if (workspace && workspace.id !== 'atlas') return [`Plan ${workspace.name} this week`, `What's urgent in ${workspace.name}?`, 'Start a new note'];
    return ['Plan my exam week', 'Cram session', 'Start an essay', 'What should I do next?'];
  };

  useE2(() => setSuggestions(suggestionsFor()), [focusedItem?.id, workspace?.id, selectedCount]);

  const placeholder = (() => {
    if (selectedCount > 1) return `Ask about ${selectedCount} items…`;
    if (focusedItem) return `Ask about "${focusedItem.title.slice(0,32)}…"`;
    if (bloomedCount > 1) return `Ask across ${bloomedCount} open items…`;
    if (workspace?.id !== 'atlas' && workspace) return `Ask, act, or create in ${workspace.name}…`;
    return 'Ask anything, or /command, or ✦ create…';
  })();

  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-5 z-40 pointer-events-auto w-[min(760px,92vw)]">
      {resultIsland && (
        <div className="result-island mb-2 chat-island chat-island-border rounded-xl px-4 py-3 flex gap-3 items-start">
          <div className="w-5 h-5 rounded-full mt-0.5 flex items-center justify-center" style={{ background:'linear-gradient(135deg,#0e8ee8,#20b8b2)' }}>
            <Icon name="sparkle" size={11} stroke="#fff"/>
          </div>
          <div className="flex-1">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-400 mb-0.5">
              {resultIsland.status === 'streaming' ? 'Thinking…' : 'Done'}
            </div>
            <div className="text-[13px] leading-[1.55] text-ink-100">{resultIsland.text}</div>
            {resultIsland.chips && (
              <div className="flex gap-1.5 mt-2">{resultIsland.chips.map((c,i) => <div key={i} className="chip">{c}</div>)}</div>
            )}
          </div>
        </div>
      )}

      {(focusedItem || selectedCount > 0 || bloomedCount > 0) && (
        <div className="flex items-center gap-1.5 mb-2 px-1">
          {selectedCount > 0 ? (
            <div className="chip" style={{ color:'#0e8ee8', borderColor:'#0e8ee8' }}>
              <div className="w-1.5 h-1.5 rounded-full bg-accent" />
              {selectedCount} selected
            </div>
          ) : focusedItem ? (
            <>
              <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-400">acting on</span>
              <div className="chip">
                <span style={{ color:focusedItem.color }}><Icon name={focusedItem.kind} size={10}/></span>
                {focusedItem.title}
              </div>
            </>
          ) : (
            <div className="chip" style={{ color:'#0e8ee8', borderColor:'#0e8ee8' }}>
              <div className="w-1.5 h-1.5 rounded-full bg-accent" />
              {bloomedCount} open
            </div>
          )}
        </div>
      )}

      {showQS && focused && (
        <div className="mb-2 chat-island chat-island-border rounded-xl p-2 drift-in">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-400 px-2 py-1">Quick starts</div>
          <div className="grid grid-cols-2 gap-1">
            {quickStarts.map(q => (
              <button key={q.id} onMouseDown={() => { onSubmit(q.title); setShowQS(false); setValue(''); }}
                      className="text-left p-2 rounded-lg hover:bg-bg2 flex gap-2 items-start">
                <div className="w-1 h-full rounded-full mt-0.5 shrink-0" style={{background:q.tone, width:3, minHeight:24}}/>
                <div>
                  <div className="text-[12px] text-ink-100">{q.title}</div>
                  <div className="text-[10.5px] text-ink-400">{q.blurb}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`chat-island chat-island-border ${focused ? 'chat-island-active' : ''} rounded-full px-4 py-2.5 flex items-center gap-3 transition-all`}>
        <button onClick={() => setShowQS(q => !q)} className="text-accent hover:text-accent/80 shrink-0" title="Quick starts">
          <Icon name="sparkle" size={14}/>
        </button>
        <input ref={inputRef}
               value={value}
               onChange={e => setValue(e.target.value)}
               onFocus={() => setFocused(true)}
               onBlur={() => setTimeout(() => { setFocused(false); setShowQS(false); }, 200)}
               onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) { onSubmit(value); setValue(''); } }}
               placeholder={placeholder}
               className="flex-1 bg-transparent outline-none text-[14px] text-ink-100 placeholder:text-ink-400" />
        <button className="text-ink-400 hover:text-accent transition-colors shrink-0" title="Voice"><Icon name="mic" size={14}/></button>
        <span className="kbd">⌘K</span>
        <button onClick={() => { if (value.trim()) { onSubmit(value); setValue(''); } }}
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                style={{ background: value.trim() ? '#0e8ee8' : '#ede9e3', color: value.trim() ? '#fff' : '#9e9082' }}>
          <Icon name="arrow-rt" size={13}/>
        </button>
      </div>

      {focused && !showQS && (
        <div className="mt-2 flex gap-1.5 flex-wrap px-1">
          {suggestions.map((s, i) => (
            <button key={i} onMouseDown={() => onSubmit(s)}
                    className="chip hover:border-accent/50 hover:text-accent cursor-pointer breathe"
                    style={{ animationDelay: `${i*160}ms` }}>
              <Icon name="sparkle" size={9}/> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Spotlight ───────────────────────────────────────────────────
const Spotlight = ({ open, onClose, items, workspaces, quickStarts, onPick }) => {
  const [q, setQ] = useS2('');
  const inputRef = useR2();
  useE2(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); else setQ(''); }, [open]);
  if (!open) return null;

  const qlc = q.toLowerCase();
  const itemHits = items.filter(i => !qlc || i.title.toLowerCase().includes(qlc) || i.preview?.toLowerCase().includes(qlc)).slice(0, 5);
  const wsHits   = workspaces.filter(w => w.id !== 'atlas' && (!qlc || w.name.toLowerCase().includes(qlc))).slice(0, 4);
  const qsHits   = quickStarts.filter(s => !qlc || s.title.toLowerCase().includes(qlc)).slice(0, 4);
  const viewHits = [
    { id:'spatial', label:'Switch to Spatial view' },
    { id:'type', label:'Switch to By-Type view' },
    { id:'topic', label:'Switch to By-Topic view' },
    { id:'timeline', label:'Switch to Timeline view' },
  ].filter(v => !qlc || v.label.toLowerCase().includes(qlc)).slice(0, 4);
  const aiSug = q.trim() ? [{ text: `Ask AI: "${q}"` }] : [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[16vh] bg-black/25 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[min(640px,92vw)] bg-paper border border-line rounded-2xl shadow-soft overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
          <Icon name="search" size={16} className="text-ink-300"/>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
                 placeholder="Search items, workspaces, views, or ask AI…"
                 className="flex-1 bg-transparent outline-none text-[15px] text-ink-100 placeholder:text-ink-400" />
          <span className="kbd">esc</span>
        </div>
        <div className="max-h-[52vh] overflow-y-auto slim-scroll p-2">
          {aiSug.length > 0 && (
            <SpotGroup label="AI">
              {aiSug.map((s,i) => (
                <SpotRow key={i} onClick={() => { onPick({ type:'ai', query:q }); onClose(); }}
                         icon={<div className="w-7 h-7 rounded-full flex items-center justify-center" style={{background:'linear-gradient(135deg,#0e8ee8,#20b8b2)'}}><Icon name="sparkle" size={12} stroke="#fff"/></div>}
                         title={s.text}/>
              ))}
            </SpotGroup>
          )}
          {qsHits.length > 0 && (
            <SpotGroup label="Quick starts">
              {qsHits.map(s => (
                <SpotRow key={s.id} onClick={() => { onPick({ type:'quick', title:s.title }); onClose(); }}
                         icon={<div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background:`${s.tone}18`, color:s.tone }}><Icon name="sparkle" size={12}/></div>}
                         title={s.title} sub={s.blurb}/>
              ))}
            </SpotGroup>
          )}
          {viewHits.length > 0 && (
            <SpotGroup label="Views">
              {viewHits.map(v => (
                <SpotRow key={v.id} onClick={() => { onPick({ type:'view', mode:v.id }); onClose(); }}
                         icon={<div className="w-7 h-7 rounded-lg flex items-center justify-center bg-bg2 text-ink-300"><Icon name={v.id === 'spatial' ? 'layout' : v.id === 'type' ? 'grid' : v.id === 'topic' ? 'topic' : 'timeline'} size={12}/></div>}
                         title={v.label}/>
              ))}
            </SpotGroup>
          )}
          {wsHits.length > 0 && (
            <SpotGroup label="Workspaces">
              {wsHits.map(w => (
                <SpotRow key={w.id} onClick={() => { onPick({ type:'workspace', id:w.id }); onClose(); }}
                         icon={<div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{background:`${w.color}18`, color:w.color}}><span className="font-display text-[13px]">{w.glyph}</span></div>}
                         title={w.name} sub={w.subtitle}/>
              ))}
            </SpotGroup>
          )}
          {itemHits.length > 0 && (
            <SpotGroup label="Items">
              {itemHits.map(it => (
                <SpotRow key={it.id} onClick={() => { onPick({ type:'item', id:it.id }); onClose(); }}
                         icon={<div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{background:`${it.color}18`, color:it.color}}><Icon name={it.kind} size={13}/></div>}
                         title={it.title} sub={it.preview?.slice(0,70)}/>
              ))}
            </SpotGroup>
          )}
          {itemHits.length === 0 && wsHits.length === 0 && qsHits.length === 0 && !q && (
            <div className="px-3 py-4 text-[12.5px] text-ink-300">
              <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-400 mb-2">Try</div>
              <div>"plan my exam week"</div>
              <div>"gatsby essay"</div>
              <div>"everything due this week"</div>
            </div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-line text-[10.5px] font-mono text-ink-400 flex gap-3">
          <span><span className="kbd">↑↓</span> navigate</span>
          <span><span className="kbd">⏎</span> open</span>
          <span><span className="kbd">⌥⏎</span> bloom</span>
          <span className="ml-auto">Spotlight</span>
        </div>
      </div>
    </div>
  );
};

const SpotGroup = ({ label, children }) => (
  <div className="mb-2">
    <div className="px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-400">{label}</div>
    {children}
  </div>
);
const SpotRow = ({ icon, title, sub, onClick }) => (
  <button onClick={onClick} className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-bg2 text-left">
    {icon}
    <div className="flex-1 min-w-0">
      <div className="text-[13px] text-ink-100 truncate">{title}</div>
      {sub && <div className="text-[11px] text-ink-400 truncate">{sub}</div>}
    </div>
  </button>
);

// ─── Zoom control ────────────────────────────────────────────────
const ZoomControl = ({ zoom, onZoom }) => (
  <div className="absolute bottom-5 left-5 z-30 pointer-events-auto">
    <div className="bg-paper/92 backdrop-blur border border-line rounded-full px-1 py-1 flex items-center gap-0.5">
      <button onClick={() => onZoom(zoom * 0.8)} className="w-7 h-7 rounded-full flex items-center justify-center text-ink-300 hover:text-accent hover:bg-bg2"><Icon name="zoom-out" size={13}/></button>
      <div className="font-mono text-[10.5px] text-ink-200 tabular-nums w-10 text-center">{Math.round(zoom*100)}%</div>
      <button onClick={() => onZoom(zoom * 1.25)} className="w-7 h-7 rounded-full flex items-center justify-center text-ink-300 hover:text-accent hover:bg-bg2"><Icon name="zoom-in" size={13}/></button>
      <div className="w-px h-4 bg-line mx-0.5" />
      <button onClick={() => onZoom(0)} className="px-2 h-7 rounded-full text-[10px] font-mono uppercase tracking-[0.12em] text-ink-300 hover:text-accent">Reset</button>
    </div>
    <div className="mt-1 text-[9.5px] font-mono text-ink-400 text-center px-2">
      <span className="kbd">⌘+scroll</span> zoom · <span className="kbd">Space</span> bloom · <span className="kbd">Tab</span> next
    </div>
  </div>
);

window.TopRail = TopRail;
window.AtlasStrip = AtlasStrip;
window.Minimap = Minimap;
window.Tray = Tray;
window.FloatingWidget = FloatingWidget;
window.CommandBar = CommandBar;
window.Spotlight = Spotlight;
window.ZoomControl = ZoomControl;
