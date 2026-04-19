// Spectra V1 — Frames (upgraded)
// Canvas with trackpad-friendly nav, view modes (Spatial / Type / Topic / Timeline),
// bloomed items, floating widgets, working tray, AI island, and "alive" item glow.

const { useState: uS, useRef: uR, useEffect: uE, useMemo: uM, useCallback: uC } = React;

const { WORKSPACES, ITEMS, TOPICS, QUICK_STARTS } = window.SPECTRA_DATA;

// ─── Zoom tiers ───────────────────────────────────────────────────────
const TIERS = {
  OUT: 0.28,       // see all workspaces
  WORKSPACE: 0.55, // default — touch tier
  ITEM: 0.95,      // focused on one
  BLOOM: 1.25,     // deep edit
};
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 2.4;

// ─── Main ─────────────────────────────────────────────────────────────
function App() {
  // Viewport
  const [zoom, setZoom] = uS(TIERS.WORKSPACE);
  const [pan, setPan] = uS({ x: -800, y: -500 });

  // Selection & focus
  const [bloomedIds, setBloomedIds] = uS([]);   // list — allows side-by-side
  const [selection, setSelection] = uS(new Set());
  const [pinned, setPinned] = uS([]);
  const [trayOpen, setTrayOpen] = uS(false);
  const [spotOpen, setSpotOpen] = uS(false);
  const [resultIsland, setResultIsland] = uS(null);

  // View mode per workspace
  const [viewMode, setViewMode] = uS('spatial'); // spatial | type | topic | timeline

  // Widgets (draggable floating hub items)
  const [widgets, setWidgets] = uS([
    { id:'w-planner', kind:'planner', x:28, y:96, w:280, h:260, state:{} },
    { id:'w-timer',   kind:'timer',   x:28, y:372, w:280, h:112, state:{ secs:25*60, running:false } },
    { id:'w-today',   kind:'today',   x:28, y:500, w:280, h:210, state:{} },
  ]);
  const [widgetsHidden, setWidgetsHidden] = uS(false);

  // AI "alive" — ids that are currently glowing because AI touched them
  const [aiTouched, setAiTouched] = uS({}); // { itemId: {until, reason} }
  const clearTouchTimers = uR({});

  // Lasso
  const [lasso, setLasso] = uS(null);
  const [panning, setPanning] = uS(false);
  const [spaceHeld, setSpaceHeld] = uS(false);

  // Context menu
  const [ctx, setCtx] = uS(null); // {x,y, target}

  // Onboard / first-time
  const [welcomeShown, setWelcomeShown] = uS(false);

  const viewportRef = uR();
  const canvasRef = uR();

  // ── Derive current workspace from viewport center ─────────────────
  const currentWorkspace = uM(() => {
    const cx = -pan.x, cy = -pan.y;
    const ws = WORKSPACES.filter(w => w.id !== 'atlas').find(w =>
      cx >= w.cx - w.w/2 && cx <= w.cx + w.w/2 && cy >= w.cy - w.h/2 && cy <= w.cy + w.h/2
    );
    if (ws && zoom > 0.34) return ws;
    return WORKSPACES[0];
  }, [pan, zoom]);

  // ── Arrange items per view mode (world coords) ────────────────────
  const arranged = uM(() => {
    // When viewing atlas (zoomed out) or spatial — use native coords
    if (viewMode === 'spatial' || currentWorkspace.id === 'atlas') return null;
    const w = currentWorkspace;
    const ws_items = ITEMS.filter(i => i.workspaceId === w.id);
    const coords = {};

    const padLeft = w.cx - w.w/2 + 80;
    const padTop  = w.cy - w.h/2 + 120;
    const innerW = w.w - 160;

    if (viewMode === 'type') {
      const byKind = {};
      ws_items.forEach(it => { (byKind[it.kind] = byKind[it.kind] || []).push(it); });
      const kinds = Object.keys(byKind);
      let y = padTop;
      kinds.forEach(k => {
        const row = byKind[k];
        row.forEach((it, idx) => {
          coords[it.id] = { x: padLeft + (idx % 3) * 300, y: y + Math.floor(idx / 3) * 220 };
        });
        y += Math.ceil(row.length / 3) * 220 + 40;
      });
      coords.__groups = kinds.map((k, i) => {
        let gy = padTop + kinds.slice(0,i).reduce((a,kk) => a + Math.ceil(byKind[kk].length / 3) * 220 + 40, 0);
        return { id:k, label:KIND_META_LABEL(k), x: padLeft - 12, y: gy - 28, kind:k };
      });
    } else if (viewMode === 'topic') {
      const groups = TOPICS[w.id] || [{ id:'all', label:'All', ids: ws_items.map(x=>x.id) }];
      let y = padTop;
      groups.forEach((g, gi) => {
        g.ids.forEach((id, idx) => {
          coords[id] = { x: padLeft + (idx % 3) * 300, y: y + Math.floor(idx / 3) * 220 };
        });
        y += Math.ceil(g.ids.length / 3) * 220 + 48;
      });
      coords.__groups = groups.map((g, i) => {
        let gy = padTop + groups.slice(0,i).reduce((a,gg) => a + Math.ceil(gg.ids.length / 3) * 220 + 48, 0);
        return { id:g.id, label:g.label, x: padLeft - 12, y: gy - 28 };
      });
    } else if (viewMode === 'timeline') {
      // sort by updated-rank: use updatedAt or implicit index
      const withRank = ws_items.map((it, i) => ({ it, rank: it.updatedRank ?? i }));
      withRank.sort((a,b) => a.rank - b.rank);
      withRank.forEach((w, idx) => {
        coords[w.it.id] = { x: padLeft + (idx % 4) * 260, y: padTop + Math.floor(idx / 4) * 220 };
      });
      // Group by day labels
      const days = ['Earlier','This week','Today','Next up'];
      coords.__groups = days.map((d, i) => ({ id:d, label:d, x: padLeft - 12, y: padTop - 28 + i * 220 }));
      // Only label first row
      coords.__groups = [{ id:'tl', label:'Recent → Upcoming', x: padLeft - 12, y: padTop - 30 }];
    }
    return coords;
  }, [viewMode, currentWorkspace]);

  // Resolve item position in current view mode
  const posOf = uC((it) => {
    if (arranged && arranged[it.id]) return { x: arranged[it.id].x, y: arranged[it.id].y };
    return { x: it.x, y: it.y };
  }, [arranged]);

  // ── Zoom tier per item ────────────────────────────────────────────
  const modeFor = uC((item) => {
    if (bloomedIds.includes(item.id)) return 'bloom';
    if (zoom < 0.42) return 'glance';
    return 'touch';
  }, [zoom, bloomedIds]);

  // ── Smooth flyTo ──────────────────────────────────────────────────
  const flyTo = uC((targetPan, targetZoom) => {
    const start = { ...pan, z: zoom };
    const end = { ...targetPan, z: targetZoom ?? zoom };
    const dur = 520;
    const t0 = performance.now();
    const step = (t) => {
      const tt = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - tt, 3);
      setPan({ x: start.x + (end.x - start.x) * eased, y: start.y + (end.y - start.y) * eased });
      if (targetZoom != null) setZoom(start.z + (end.z - start.z) * eased);
      if (tt < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [pan, zoom]);

  const zoomAt = uC((mx, my, factor) => {
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * factor));
    const rect = viewportRef.current.getBoundingClientRect();
    const cx = rect.width/2, cy = rect.height/2;
    // world point under cursor stays under cursor
    const wx = (mx - cx)/zoom - pan.x;
    const wy = (my - cy)/zoom - pan.y;
    const newPanX = (mx - cx)/newZoom - wx;
    const newPanY = (my - cy)/newZoom - wy;
    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, [zoom, pan]);

  // ── Wheel handling — trackpad & mouse friendly ────────────────────
  const onWheel = (e) => {
    e.preventDefault();
    const rect = viewportRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (e.ctrlKey || e.metaKey) {
      // pinch / cmd+wheel → zoom at cursor
      const factor = Math.exp(-e.deltaY * 0.012);
      zoomAt(mx, my, factor);
    } else if (e.shiftKey) {
      // shift+wheel → force zoom (helps when trackpad gives only deltaY)
      const factor = Math.exp(-e.deltaY * 0.010);
      zoomAt(mx, my, factor);
    } else {
      // trackpad: both axes = pan in world units
      setPan(p => ({ x: p.x - e.deltaX / zoom, y: p.y - e.deltaY / zoom }));
    }
  };

  // ── Drag-to-pan + lasso ───────────────────────────────────────────
  const dragRef = uR(null);
  const onMouseDown = (e) => {
    if (e.target.closest('[data-widget]')) return;
    if (e.target.closest('[data-bloom-editor]')) return;
    if (e.button === 1 || e.button === 2 || (e.button === 0 && (e.altKey || spaceHeld))) {
      e.preventDefault();
      dragRef.current = { type: 'pan', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
      setPanning(true);
    } else if (e.button === 0 && (e.target === canvasRef.current || e.target.closest('[data-canvas-bg]'))) {
      const rect = viewportRef.current.getBoundingClientRect();
      const wx = (e.clientX - rect.left - rect.width/2)/zoom - pan.x;
      const wy = (e.clientY - rect.top - rect.height/2)/zoom - pan.y;
      dragRef.current = { type: 'lasso', wx0: wx, wy0: wy };
      setLasso({ x0: wx, y0: wy, x1: wx, y1: wy });
      if (!e.shiftKey) setSelection(new Set());
    }
  };
  const onMouseMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.type === 'pan') {
      setPan({ x: d.px + (e.clientX - d.sx)/zoom, y: d.py + (e.clientY - d.sy)/zoom });
    } else if (d.type === 'lasso') {
      const rect = viewportRef.current.getBoundingClientRect();
      const wx = (e.clientX - rect.left - rect.width/2)/zoom - pan.x;
      const wy = (e.clientY - rect.top - rect.height/2)/zoom - pan.y;
      setLasso({ x0: d.wx0, y0: d.wy0, x1: wx, y1: wy });
    }
  };
  const onMouseUp = () => {
    const d = dragRef.current;
    if (d?.type === 'lasso' && lasso) {
      const x0 = Math.min(lasso.x0, lasso.x1), x1 = Math.max(lasso.x0, lasso.x1);
      const y0 = Math.min(lasso.y0, lasso.y1), y1 = Math.max(lasso.y0, lasso.y1);
      const hits = ITEMS.filter(it => {
        const p = posOf(it);
        return p.x < x1 && p.x + it.w > x0 && p.y < y1 && p.y + it.h > y0;
      });
      if (hits.length > 0) {
        const s = new Set(selection);
        hits.forEach(h => s.add(h.id));
        setSelection(s);
        if (hits.length > 1) setTrayOpen(true);
      }
    }
    dragRef.current = null;
    setLasso(null);
    setPanning(false);
  };

  // ── Nav helpers ──────────────────────────────────────────────────
  const goToWorkspace = (wsId) => {
    setViewMode('spatial');
    const w = WORKSPACES.find(x => x.id === wsId);
    if (!w) return;
    setBloomedIds([]);
    if (w.id === 'atlas') flyTo({ x: 0, y: 0 }, TIERS.OUT);
    else flyTo({ x: -w.cx, y: -w.cy }, TIERS.WORKSPACE);
  };
  const goToItem = (itemId, bloom=true) => {
    const it = ITEMS.find(x => x.id === itemId);
    if (!it) return;
    const p = posOf(it);
    flyTo({ x: -(p.x + it.w/2), y: -(p.y + it.h/2) }, TIERS.ITEM);
    if (bloom) setTimeout(() => setBloomedIds(bs => bs.includes(it.id) ? bs : [...bs, it.id]), 440);
  };

  // Focused = center-most item near center, visible only if zoomed in enough
  const focusedItem = uM(() => {
    if (zoom < 0.48) return null;
    const cx = -pan.x, cy = -pan.y;
    const wsItems = ITEMS.filter(it => !currentWorkspace || currentWorkspace.id === 'atlas' || it.workspaceId === currentWorkspace.id);
    let best = null, bd = Infinity;
    const maxDist = 300 / zoom;
    wsItems.forEach(it => {
      const p = posOf(it);
      const ix = p.x + it.w/2, iy = p.y + it.h/2;
      const d = Math.hypot(ix - cx, iy - cy);
      if (d < bd && d < maxDist) { best = it; bd = d; }
    });
    return best;
  }, [pan, zoom, currentWorkspace, posOf]);

  const bloomedItems = bloomedIds.map(id => ITEMS.find(i => i.id === id)).filter(Boolean);

  // ── Tab cycles focus through items in current workspace ───────────
  const cycleFocus = (dir=1) => {
    const wsItems = ITEMS.filter(it => !currentWorkspace || currentWorkspace.id === 'atlas' || it.workspaceId === currentWorkspace.id);
    if (wsItems.length === 0) return;
    let idx = focusedItem ? wsItems.findIndex(i => i.id === focusedItem.id) : -1;
    idx = (idx + dir + wsItems.length) % wsItems.length;
    const it = wsItems[idx];
    const p = posOf(it);
    flyTo({ x: -(p.x + it.w/2), y: -(p.y + it.h/2) }, Math.max(zoom, TIERS.ITEM));
  };

  // ── Keyboard ─────────────────────────────────────────────────────
  uE(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.contentEditable === 'true') {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSpotOpen(true); return; }
      if (e.key === ' ') {
        e.preventDefault();
        // Space toggles bloom on focused OR pans when held
        if (e.repeat) { setSpaceHeld(true); return; }
        if (focusedItem) {
          setBloomedIds(bs => bs.includes(focusedItem.id) ? bs.filter(i=>i!==focusedItem.id) : [...bs, focusedItem.id]);
        }
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        cycleFocus(e.shiftKey ? -1 : 1);
      }
      if (e.key === 'Escape') {
        if (ctx) setCtx(null);
        else if (spotOpen) setSpotOpen(false);
        else if (bloomedIds.length > 0) setBloomedIds([]);
        else if (selection.size > 0) setSelection(new Set());
        else if (trayOpen) setTrayOpen(false);
      }
      if (e.key === '=' || e.key === '+') {
        const rect = viewportRef.current.getBoundingClientRect();
        zoomAt(rect.width/2, rect.height/2, 1.2);
      }
      if (e.key === '-' || e.key === '_') {
        const rect = viewportRef.current.getBoundingClientRect();
        zoomAt(rect.width/2, rect.height/2, 0.83);
      }
      if (e.key === '0') flyTo({ x: 0, y: 0 }, TIERS.OUT);
      if (e.key === '1') setViewMode('spatial');
      if (e.key === '2') setViewMode('type');
      if (e.key === '3') setViewMode('topic');
      if (e.key === '4') setViewMode('timeline');
      if (e.key === 'w') setWidgetsHidden(h => !h);
      if (e.key === 'b' && focusedItem) {
        setBloomedIds(bs => bs.includes(focusedItem.id) ? bs.filter(i=>i!==focusedItem.id) : [...bs, focusedItem.id]);
      }
    };
    const onUp = (e) => { if (e.key === ' ') setSpaceHeld(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); };
  }, [bloomedIds, focusedItem, spotOpen, selection, trayOpen, ctx, viewMode, currentWorkspace, posOf]);

  // ── Timer tick ───────────────────────────────────────────────────
  uE(() => {
    const id = setInterval(() => {
      setWidgets(ws => ws.map(w => {
        if (w.kind !== 'timer' || !w.state.running) return w;
        const s = w.state.secs - 1;
        if (s <= 0) return { ...w, state: { ...w.state, secs: 25*60, running: false } };
        return { ...w, state: { ...w.state, secs: s } };
      }));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ── AI glow helper ──────────────────────────────────────────────
  const touchAI = (ids, reason, ms=4200) => {
    setAiTouched(prev => {
      const next = { ...prev };
      ids.forEach(id => { next[id] = { reason, until: Date.now() + ms }; });
      return next;
    });
    ids.forEach(id => {
      clearTimeout(clearTouchTimers.current[id]);
      clearTouchTimers.current[id] = setTimeout(() => {
        setAiTouched(prev => { const n = { ...prev }; delete n[id]; return n; });
      }, ms);
    });
  };

  // ── Item interactions ────────────────────────────────────────────
  const onItemClick = (item, e) => {
    if (e.shiftKey) {
      const s = new Set(selection);
      if (s.has(item.id)) s.delete(item.id); else s.add(item.id);
      setSelection(s);
      if (s.size > 1) setTrayOpen(true);
      return;
    }
    if (bloomedIds.includes(item.id)) return;
    const p = posOf(item);
    flyTo({ x: -(p.x + item.w/2), y: -(p.y + item.h/2) }, Math.max(zoom, TIERS.WORKSPACE + 0.1));
  };
  const onItemDoubleClick = (item) => goToItem(item.id, true);
  const closeBloom = (id) => setBloomedIds(bs => bs.filter(i => i !== id));
  const onPinItem = (item) => { if (!pinned.includes(item.id)) setPinned([...pinned, item.id]); setTrayOpen(true); };

  // ── Command / AI ─────────────────────────────────────────────────
  const onCommandSubmit = (text) => {
    const lc = text.toLowerCase();
    let res;
    let touched = [];

    if (selection.size > 1) {
      touched = Array.from(selection);
      res = { status:'done', text:`Compared ${selection.size} items. Built a side-by-side with differences highlighted. Open from the tray.`, chips:['Compare', `${selection.size} items`] };
    } else if (focusedItem?.kind === 'essay') {
      touched = [focusedItem.id];
      res = { status:'done', text:'Your thesis on "distance as unavailability" is strong. Weakest transition: ¶3→¶4 — you pivot too fast. Suggested a bridge sentence.', chips:['Suggestion in doc', 'Essay · Gatsby'] };
    } else if (focusedItem?.kind === 'pset') {
      touched = [focusedItem.id];
      res = { status:'done', text:'For ∫ arctan(x) dx — IBP with u=arctan(x), dv=dx. After first pass, substitute w=1+x² to finish. Solution inserted as Problem 3.', chips:['Hint inserted','Pset 7']};
    } else if (focusedItem?.kind === 'flashcards') {
      touched = [focusedItem.id];
      res = { status:'done', text:'Review started — 10 cards queued. Weakest card: subjunctive after "dudo que" (doubt trigger).', chips:['Review started']};
    } else if (focusedItem?.kind === 'note') {
      touched = [focusedItem.id];
      res = { status:'done', text:'Condensed into 3 lines and extracted 6 flashcard-ready terms at the bottom of the note.', chips:['Note updated']};
    } else if (lc.includes('plan') && (lc.includes('week') || lc.includes('exam'))) {
      // Plan across workspaces — touch one item in each
      touched = WORKSPACES.filter(w => w.id !== 'atlas').map(w => ITEMS.find(i => i.workspaceId === w.id)?.id).filter(Boolean);
      res = { status:'done', text:'This week: Biology midterm Thu (P1), Calc pset Fri, English draft Mon. Scheduled 6×50-min focus blocks with a 2-day taper. Plan added to the Planner widget.', chips:['Plan drafted','6 blocks','2 exams']};
    } else if (lc.includes('essay') || lc.includes('gatsby')) {
      touched = ITEMS.filter(i => i.workspaceId === 'eng').map(i => i.id);
      res = { status:'done', text:'Opened the essay folder. Strongest quote for your thesis: Chapter 5, "unattainable dream" passage. Inserted as candidate evidence.', chips:['Evidence added']};
    } else if (lc.includes('flashcard') || lc.includes('quiz')) {
      touched = ITEMS.filter(i => i.kind === 'flashcards').map(i => i.id);
      res = { status:'done', text:'Generated 24 new flashcards across Biology & Spanish from your weakest items.', chips:['Flashcards made']};
    } else {
      res = { status:'done', text:`I'd normally act on: "${text}". This is a design prototype — the AI is stubbed, but behavior shows you how it would feel.`, chips:['Stub']};
    }
    if (touched.length) touchAI(touched, text);
    setResultIsland({ ...res, status:'streaming' });
    setTimeout(() => setResultIsland(res), 500);
    setTimeout(() => setResultIsland(r => r && r.status === 'done' ? null : r), 9500);
  };

  // Tray actions
  const onTrayAction = (action) => {
    const n = selection.size;
    const ids = Array.from(selection);
    touchAI(ids, action);
    let text;
    if (action === 'ask')     text = `Asked about ${n} items. Pulled common threads — see result above.`;
    if (action === 'compare') text = `Built a side-by-side of ${n} items with differences highlighted.`;
    if (action === 'merge')   text = `Merged ${n} items into a new combined note.`;
    if (action === 'quiz')    text = `Quiz generated from ${n} items — 12 questions.`;
    if (action === 'link')    text = `Linked ${n} items as related. They'll show connectors at touch zoom.`;
    if (action === 'bloom')   { ids.forEach(id => setBloomedIds(bs => bs.includes(id) ? bs : [...bs, id])); return; }
    setResultIsland({ status:'done', text, chips:[`${n} items`] });
    setSelection(new Set());
    setTimeout(() => setResultIsland(null), 7000);
  };

  const onSpotlightPick = (sel) => {
    if (sel.type === 'workspace') goToWorkspace(sel.id);
    else if (sel.type === 'item') goToItem(sel.id);
    else if (sel.type === 'ai') onCommandSubmit(sel.query);
    else if (sel.type === 'view') setViewMode(sel.mode);
    else if (sel.type === 'quick') onCommandSubmit(sel.title);
  };

  // Widgets
  const moveWidget = (id, x, y) => setWidgets(ws => ws.map(w => w.id === id ? { ...w, x, y } : w));
  const closeWidget = (id) => setWidgets(ws => ws.filter(w => w.id !== id));
  const addWidget = (kind) => {
    const id = `w-${Date.now()}`;
    const base = { timer: {w:280,h:112}, planner:{w:280,h:260}, today:{w:280,h:210}, scratch:{w:280,h:220}, calendar:{w:300,h:260}, library:{w:300,h:260} }[kind] || {w:260,h:200};
    setWidgets(ws => [...ws, { id, kind, x: 96, y: 96, ...base, state: kind === 'timer' ? { secs:25*60, running:false } : {} }]);
  };
  const toggleTimer = (id) => setWidgets(ws => ws.map(w => w.id === id ? { ...w, state: { ...w.state, running: !w.state.running } } : w));
  const resetTimer = (id, secs=25*60) => setWidgets(ws => ws.map(w => w.id === id ? { ...w, state: { ...w.state, secs, running:false } } : w));

  // Viewport
  const [vpSize, setVpSize] = uS({ w: window.innerWidth, h: window.innerHeight });
  uE(() => {
    const onR = () => setVpSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onR); return () => window.removeEventListener('resize', onR);
  }, []);

  const visibleItems = uM(() => {
    const pad = 500;
    const cx = -pan.x, cy = -pan.y;
    const hw = vpSize.w / 2 / zoom + pad;
    const hh = vpSize.h / 2 / zoom + pad;
    // When a view mode is active, only that workspace's items
    let pool = ITEMS;
    if (arranged && currentWorkspace.id !== 'atlas') pool = ITEMS.filter(i => i.workspaceId === currentWorkspace.id);
    return pool.filter(it => {
      const p = posOf(it);
      return p.x + it.w > cx - hw && p.x < cx + hw && p.y + it.h > cy - hh && p.y < cy + hh;
    });
  }, [pan, zoom, vpSize, arranged, currentWorkspace, posOf]);

  // When view mode changes, pan to the workspace top-left to frame it
  uE(() => {
    if (viewMode !== 'spatial' && currentWorkspace.id !== 'atlas') {
      flyTo({ x: -(currentWorkspace.cx), y: -(currentWorkspace.cy - 40) }, Math.max(0.62, zoom));
    }
  }, [viewMode]);

  // First-time welcome
  uE(() => {
    const seen = localStorage.getItem('spectra-v1-welcome2');
    if (!seen) { setWelcomeShown(true); localStorage.setItem('spectra-v1-welcome2','seen'); }
  }, []);

  const canvasTransform = `translate(${vpSize.w/2 + pan.x*zoom}px, ${vpSize.h/2 + pan.y*zoom}px) scale(${zoom})`;

  const trayItems = Array.from(selection).map(id => ITEMS.find(i => i.id === id)).filter(Boolean);
  const pinnedItems = pinned.map(id => ITEMS.find(i => i.id === id)).filter(Boolean);

  return (
    <div className="fixed inset-0 bg-bg paper-grid overflow-hidden"
         style={{ cursor: panning ? 'grabbing' : (spaceHeld ? 'grab' : 'default') }}>

      {/* Viewport / canvas */}
      <div ref={viewportRef}
           data-canvas-bg
           className="absolute inset-0"
           onWheel={onWheel}
           onMouseDown={onMouseDown}
           onMouseMove={onMouseMove}
           onMouseUp={onMouseUp}
           onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY }); }}>

        <div ref={canvasRef} data-canvas-bg className="absolute"
             style={{ left: 0, top: 0, transform: canvasTransform, transformOrigin: '0 0', width: 1, height: 1 }}>

          {/* Territory borders */}
          {WORKSPACES.filter(w => w.id !== 'atlas').map(w => {
            const territoryOpacity = zoom < 0.5 ? 1 : zoom < 0.8 ? (0.8 - zoom) * 4 : 0;
            return (
              <div key={w.id} className="absolute pointer-events-none"
                   style={{ left:w.cx-w.w/2, top:w.cy-w.h/2, width:w.w, height:w.h,
                            border:`1.5px dashed ${w.color}`, opacity: territoryOpacity * 0.35,
                            borderRadius:24, transition:'opacity 220ms ease' }}/>
            );
          })}

          {/* Territory titles */}
          {WORKSPACES.filter(w => w.id !== 'atlas').map(w => {
            const labelOpacity = zoom < 0.32 ? 1 : zoom < 0.5 ? 1 : zoom < 0.72 ? (0.72 - zoom) * 3.2 : 0;
            if (labelOpacity <= 0) return null;
            return (
              <div key={'t'+w.id} className="absolute pointer-events-none"
                   style={{ left:w.cx-w.w/2+30, top:w.cy-w.h/2+24, opacity: labelOpacity, transition:'opacity 220ms ease' }}>
                <div className="font-display" style={{ fontSize:44, color:w.color, lineHeight:1, letterSpacing:'-0.02em', opacity:0.82 }}>{w.name}</div>
                <div className="font-mono uppercase tracking-[0.16em]" style={{ fontSize:14, color:w.color, opacity:0.65, marginTop:10 }}>
                  {ITEMS.filter(i => i.workspaceId === w.id).length} items · {w.subtitle}
                </div>
              </div>
            );
          })}

          {/* View-mode group labels (type / topic / timeline) */}
          {arranged && arranged.__groups && arranged.__groups.map(g => (
            <div key={g.id} className="absolute pointer-events-none drift-in"
                 style={{ left:g.x, top:g.y, color: currentWorkspace.color, opacity: 0.82 }}>
              <div className="font-mono text-[11px] uppercase tracking-[0.16em]">
                {g.kind ? <Icon name={g.kind} size={10} className="inline mr-1.5 -mt-0.5" /> : null}
                {g.label}
              </div>
            </div>
          ))}

          {/* Connector lines between related items */}
          {zoom > 0.42 && zoom < 1.2 && viewMode === 'spatial' && (
            <svg className="absolute pointer-events-none" style={{ left:-5000, top:-5000, width:10000, height:10000, overflow:'visible' }}>
              {ITEMS.filter(it => it.meta?.linked).flatMap(it =>
                (it.meta.linked || []).map(lid => {
                  const other = ITEMS.find(x => x.id === lid);
                  if (!other) return null;
                  const p1 = posOf(it), p2 = posOf(other);
                  const x1=p1.x+it.w/2+5000, y1=p1.y+it.h/2+5000, x2=p2.x+other.w/2+5000, y2=p2.y+other.h/2+5000;
                  return <line key={it.id+'-'+lid} x1={x1} y1={y1} x2={x2} y2={y2} className="connector"/>;
                })
              )}
            </svg>
          )}

          {/* Items */}
          {visibleItems.map((it, idx) => {
            const m = modeFor(it);
            const p = posOf(it);
            const dimmed = bloomedIds.length > 0 && !bloomedIds.includes(it.id);
            const itemW = m === 'bloom' ? 640 : it.w;
            const itemH = m === 'bloom' ? 520 : it.h;
            return (
              <div key={it.id}
                   className="absolute drift-in"
                   style={{
                     left: p.x, top: p.y, width: itemW, height: itemH,
                     opacity: dimmed ? 0.22 : 1, pointerEvents: dimmed ? 'none' : 'auto',
                     transition: 'left 380ms cubic-bezier(0.22,1,0.36,1), top 380ms cubic-bezier(0.22,1,0.36,1), width 260ms ease, height 260ms ease, opacity 220ms ease',
                     animationDelay: `${Math.min(idx*22, 360)}ms`,
                   }}>
                <Item item={it} mode={m}
                      focused={!bloomedIds.length && focusedItem?.id === it.id}
                      selected={selection.has(it.id)}
                      aiTouched={!!aiTouched[it.id]}
                      onClick={onItemClick}
                      onDoubleClick={onItemDoubleClick}
                      onPin={onPinItem}
                      onClose={() => closeBloom(it.id)} />
              </div>
            );
          })}

          {/* Lasso */}
          {lasso && (
            <div className="absolute lasso pointer-events-none"
                 style={{
                   left: Math.min(lasso.x0, lasso.x1),
                   top: Math.min(lasso.y0, lasso.y1),
                   width: Math.abs(lasso.x1 - lasso.x0),
                   height: Math.abs(lasso.y1 - lasso.y0),
                 }}/>
          )}
        </div>

        {/* Canvas-level dim when blooms are active */}
        {bloomedIds.length > 0 && <div className="absolute inset-0 pointer-events-none" style={{ background:'rgba(237,233,227,0.42)', transition:'opacity 240ms ease' }}/>}
      </div>

      {/* Chrome */}
      <TopRail workspace={currentWorkspace} zoom={zoom}
               trayCount={selection.size + pinned.length}
               viewMode={viewMode} onViewMode={setViewMode}
               onOpenTray={() => setTrayOpen(!trayOpen)}
               onHome={() => goToWorkspace('atlas')}
               onAtlas={() => goToWorkspace('atlas')}
               onSpotlight={() => setSpotOpen(true)}
               onToggleWidgets={() => setWidgetsHidden(h => !h)}
               widgetsHidden={widgetsHidden}
               onAddWidget={addWidget}/>

      <AtlasStrip workspaces={WORKSPACES} current={currentWorkspace?.id} onPick={goToWorkspace} />

      <Minimap workspaces={WORKSPACES} items={ITEMS}
               viewport={{ x:-pan.x, y:-pan.y, w:vpSize.w/zoom, h:vpSize.h/zoom }}
               worldSize={{ w:4000, h:2400 }}
               onLensMove={(x,y) => setPan({ x:-x, y:-y })}
               onWorkspaceClick={goToWorkspace} />

      <ZoomControl zoom={zoom} onZoom={(z) => {
        const rect = viewportRef.current.getBoundingClientRect();
        if (z === 0) flyTo({x:0,y:0}, TIERS.OUT);
        else zoomAt(rect.width/2, rect.height/2, z/zoom);
      }} />

      {/* Widgets */}
      {!widgetsHidden && widgets.map(w => (
        <FloatingWidget key={w.id} widget={w}
                        onMove={moveWidget} onClose={closeWidget}
                        onTimerToggle={() => toggleTimer(w.id)}
                        onTimerReset={(s) => resetTimer(w.id, s)}
                        aiTouched={!!aiTouched[w.id]}
                        onAsk={(text) => onCommandSubmit(text)}/>
      ))}

      <Tray open={trayOpen || selection.size > 0}
            items={trayItems}
            pinned={pinnedItems}
            onClose={() => { setTrayOpen(false); setSelection(new Set()); }}
            onRemove={(id) => { const s = new Set(selection); s.delete(id); setSelection(s); }}
            onAction={onTrayAction} />

      <CommandBar focusedItem={focusedItem} workspace={currentWorkspace}
                  selectedCount={selection.size}
                  onSubmit={onCommandSubmit}
                  resultIsland={resultIsland}
                  quickStarts={QUICK_STARTS}
                  bloomedCount={bloomedIds.length}/>

      <Spotlight open={spotOpen} onClose={() => setSpotOpen(false)}
                 items={ITEMS} workspaces={WORKSPACES}
                 quickStarts={QUICK_STARTS}
                 onPick={onSpotlightPick} />

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} onClose={() => setCtx(null)}
                           onPick={(v) => { setCtx(null); if (v.startsWith('ws:')) addWidget(v.slice(3)); if (v === 'ask') setSpotOpen(true); }} />}

      {welcomeShown && <Welcome onClose={() => setWelcomeShown(false)} />}

      {/* Focused item hint (keyboard affordance) */}
      {focusedItem && bloomedIds.length === 0 && (
        <div className="absolute left-1/2 -translate-x-1/2 top-[85px] z-10 pointer-events-none drift-in">
          <div className="chip" style={{background:'#fbfaf6'}}>
            <span style={{color:focusedItem.color}}><Icon name={focusedItem.kind} size={10}/></span>
            Focused · <kbd className="kbd ml-1">Space</kbd> to open · <kbd className="kbd">Tab</kbd> next
          </div>
        </div>
      )}
    </div>
  );
}

function Welcome({ onClose }) {
  return (
    <div className="absolute top-24 right-6 z-40 drift-in" style={{ animationDelay:'600ms' }}>
      <div className="bg-paper/94 backdrop-blur border border-line rounded-2xl p-4 w-[340px] shadow-soft">
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{background:'linear-gradient(135deg,#0e8ee8,#20b8b2)'}}>
            <Icon name="sparkle" size={13} stroke="#fff" />
          </div>
          <div className="flex-1">
            <div className="font-display text-[17px] text-ink-100 leading-tight">Welcome back, Maya.</div>
            <div className="text-[12px] text-ink-300 mt-1.5 leading-[1.55]">
              <b>Scroll</b> to pan · <b>⌘/Shift + scroll</b> to zoom · <b>Space</b> to bloom focused · <b>Tab</b> to cycle · <b>⌘K</b> to jump.
              Toggle <b>By Type / Topic / Timeline</b> in the top rail.
            </div>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-100 shrink-0 mt-0.5"><Icon name="close" size={12}/></button>
        </div>
      </div>
    </div>
  );
}

function ContextMenu({ x, y, onPick, onClose }) {
  uE(() => {
    const off = () => onClose();
    window.addEventListener('mousedown', off);
    return () => window.removeEventListener('mousedown', off);
  }, []);
  const items = [
    { id:'ask', label:'Ask AI…', icon:'sparkle' },
    { id:'ws:planner', label:'Add Planner widget', icon:'planner' },
    { id:'ws:timer',   label:'Add Timer widget', icon:'timer' },
    { id:'ws:scratch', label:'Add Scratchpad widget', icon:'note' },
    { id:'ws:today',   label:'Add Today widget', icon:'schedule' },
    { id:'ws:library', label:'Add Library widget', icon:'reading' },
  ];
  return (
    <div className="fixed z-50 bg-paper border border-line rounded-lg shadow-soft py-1 min-w-[210px] drift-in"
         style={{ left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - 260) }}
         onMouseDown={e => e.stopPropagation()}>
      {items.map(it => (
        <button key={it.id} onClick={() => onPick(it.id)}
                className="w-full text-left px-3 py-1.5 hover:bg-bg2 flex items-center gap-2 text-[12.5px] text-ink-100">
          <Icon name={it.icon} size={12} className="text-ink-400"/>{it.label}
        </button>
      ))}
    </div>
  );
}

// Helper used by arranged() groups (avoid circular)
function KIND_META_LABEL(k) {
  return ({ note:'Notes', essay:'Essays', pset:'Problem sets', flashcards:'Flashcards',
            thread:'Threads', reading:'Readings', lab:'Labs', schedule:'Due' })[k] || k;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
