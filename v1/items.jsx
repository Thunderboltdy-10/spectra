// Item renderer — field-style cards with zoom-aware layers.
// Three render modes: 'glance' (title + kind), 'touch' (+ preview), 'bloom' (full editor)
// Mode derived from zoom level AND whether item is focused/bloomed.

const { useState, useRef, useEffect, useMemo } = React;

// ─── Kind → color & label ──────────────────────────────────────────────
const KIND_META = {
  note:        { label: 'Note',        tone: '#6b5f52' },
  essay:       { label: 'Essay',       tone: '#b67616' },
  pset:        { label: 'Problem set', tone: '#0e8ee8' },
  flashcards:  { label: 'Flashcards',  tone: '#20b8b2' },
  thread:      { label: 'Thread',      tone: '#0e8ee8' },
  reading:     { label: 'Reading',     tone: '#6b5f52' },
  lab:         { label: 'Lab',         tone: '#20b8b2' },
  schedule:    { label: 'Due',         tone: '#e05137' },
};

// ─── Glance: just kind glyph + title, no preview ───────────────────────
const GlanceLayer = ({ item }) => {
  const meta = KIND_META[item.kind] || { label: item.kind, tone: '#6b5f52' };
  return (
    <div className="p-4 h-full flex flex-col justify-between">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 text-ink-300" style={{ color: meta.tone }}>
          <Icon name={item.kind} size={14} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-display text-[17px] leading-[1.2] text-ink-100 truncate">{item.title}</div>
        </div>
      </div>
      <div className="flex items-end justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-400">{meta.label}</span>
        {item.updated && <span className="font-mono text-[9.5px] text-ink-400">{item.updated}</span>}
      </div>
    </div>
  );
};

// ─── Touch: title + preview + metadata ─────────────────────────────────
const TouchLayer = ({ item }) => {
  const meta = KIND_META[item.kind] || { label: item.kind, tone: '#6b5f52' };
  return (
    <div className="p-5 h-full flex flex-col">
      <div className="flex items-start gap-2.5 mb-2">
        <span className="mt-1 shrink-0" style={{ color: meta.tone }}>
          <Icon name={item.kind} size={14} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-display text-[20px] leading-[1.15] text-ink-100">{item.title}</div>
          <div className="mt-1 h-px bg-line rule-grow" style={{ width: '32px' }} />
        </div>
      </div>
      <div className="text-[12.5px] leading-[1.58] text-ink-200 mt-2 line-clamp-4 flex-1">
        {item.preview}
      </div>
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-line/60">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-400">{meta.label}</span>
        <span className="font-mono text-[9.5px] text-ink-400">{item.updated}</span>
      </div>
    </div>
  );
};

// ─── Bloom: full editor. Type-specific. ────────────────────────────────
const BloomNote = ({ item }) => {
  const [body, setBody] = useState(item.body || '');
  const renderMarkdown = (md) => {
    const lines = md.split('\n');
    const out = [];
    let inList = false;
    lines.forEach((line, i) => {
      if (line.startsWith('# ')) out.push(<h2 key={i} className="font-display text-[26px] text-ink-100 mt-3 mb-2 leading-tight">{line.slice(2)}</h2>);
      else if (line.startsWith('## ')) out.push(<h3 key={i} className="font-display text-[19px] text-ink-100 mt-4 mb-1.5">{line.slice(3)}</h3>);
      else if (line.startsWith('- ') || line.startsWith('• ')) out.push(<li key={i} className="ml-5 list-disc marker:text-ink-400 text-[13.5px] leading-[1.6] text-ink-200">{renderInline(line.slice(2))}</li>);
      else if (line.startsWith('|')) {/* tables — skip fancy rendering, show mono */ out.push(<div key={i} className="font-mono text-[11px] text-ink-200">{line}</div>);}
      else if (line.trim() === '') out.push(<div key={i} className="h-2" />);
      else out.push(<p key={i} className="text-[13.5px] leading-[1.72] text-ink-200">{renderInline(line)}</p>);
    });
    return out;
  };
  const renderInline = (text) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) => p.startsWith('**') ? <strong key={i} className="font-semibold text-ink-100">{p.slice(2,-2)}</strong> : p);
  };
  return (
    <div className="flex flex-col h-full">
      <div className="px-7 pt-6 pb-3">
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">
            <span style={{ color: '#6b5f52' }}>Note</span> · {item.meta?.words || 0} words · {item.updated}
          </div>
        </div>
        <h1 className="font-display text-[32px] leading-[1.05] text-ink-100 mt-3">{item.title}</h1>
        <div className="mt-2 h-px w-16 bg-accent/60" />
      </div>
      <div className="px-7 pb-6 overflow-y-auto slim-scroll flex-1">
        <div className="space-y-0.5">{renderMarkdown(body)}</div>
        <div className="mt-4 text-[13px] text-ink-400 italic border-l-2 border-accent/40 pl-3 py-1">
          Tip: place cursor and press <span className="kbd" style={{display:'inline-flex'}}>/</span> to call AI — "explain in three lines", "make flashcards", "quiz me".
        </div>
      </div>
    </div>
  );
};

const BloomEssay = ({ item }) => {
  const words = item.meta?.words || 0;
  const target = item.meta?.target || 1500;
  const pct = Math.min(100, Math.round((words / target) * 100));
  return (
    <div className="flex flex-col h-full">
      <div className="px-7 pt-6 pb-2">
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">
            <span style={{ color: '#b67616' }}>Essay draft</span> · {words}/{target} words
          </div>
          <div className="w-32 h-1 bg-line rounded-full overflow-hidden">
            <div className="h-full bg-warn" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <h1 className="font-display text-[34px] leading-[1.02] text-ink-100 mt-3">{item.title}</h1>
      </div>
      <div className="px-7 pb-6 overflow-y-auto slim-scroll flex-1">
        <div className="text-[15px] leading-[1.82] text-ink-200 font-display whitespace-pre-wrap">
          {item.body}
        </div>
        <div className="mt-6 p-3 bg-bg2/60 border border-line rounded-lg flex items-start gap-2">
          <Icon name="sparkle" size={14} className="mt-0.5 text-accent" />
          <div className="flex-1">
            <div className="text-[12px] font-semibold text-ink-100">AI suggestion</div>
            <div className="text-[12px] text-ink-200 mt-0.5">Your thesis in para 1 is strong but your final line ("destroyed") needs earned weight. Consider adding a transitional sentence about proximity and ruin before it.</div>
          </div>
          <button className="text-[10px] font-mono uppercase tracking-[0.1em] text-ink-300 hover:text-accent">accept</button>
        </div>
      </div>
    </div>
  );
};

const BloomPset = ({ item }) => {
  const [probs, setProbs] = useState(item.problems || []);
  const cycle = (i) => {
    const order = ['todo','stuck','done'];
    setProbs(probs.map((p, j) => j === i ? { ...p, status: order[(order.indexOf(p.status)+1)%3] } : p));
  };
  const statusColor = (s) => s === 'done' ? '#148f5d' : s === 'stuck' ? '#e05137' : '#9e9082';
  return (
    <div className="flex flex-col h-full">
      <div className="px-7 pt-6 pb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">
          <span style={{ color: '#0e8ee8' }}>Problem set</span> · {probs.filter(p=>p.status==='done').length}/{probs.length} complete
        </div>
        <h1 className="font-display text-[30px] leading-[1.05] text-ink-100 mt-2">{item.title}</h1>
      </div>
      <div className="px-7 pb-6 overflow-y-auto slim-scroll flex-1 space-y-2">
        {probs.map((p, i) => (
          <div key={i} className="group flex items-start gap-3 py-2.5 border-b border-line/50 last:border-0">
            <button onClick={() => cycle(i)} className="mt-1 w-4 h-4 rounded-full border flex items-center justify-center shrink-0"
                    style={{ borderColor: statusColor(p.status), background: p.status==='done'?statusColor(p.status):'transparent' }}>
              {p.status === 'done' && <Icon name="check" size={10} stroke="#fff" />}
              {p.status === 'stuck' && <div className="w-1.5 h-1.5 rounded-full" style={{background:statusColor(p.status)}} />}
            </button>
            <div className="flex-1">
              <div className="font-mono text-[12.5px] text-ink-100">{p.q}</div>
              {p.a && <div className="font-mono text-[11.5px] text-ink-300 mt-0.5">= {p.a}</div>}
              {!p.a && p.status !== 'done' && (
                <button className="mt-1 text-[10px] font-mono uppercase tracking-[0.1em] text-accent opacity-0 group-hover:opacity-100 transition-opacity">
                  ✦ walk me through
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const BloomFlashcards = ({ item }) => {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = item.cards[i];
  const next = () => { setI((i+1) % item.cards.length); setFlipped(false); };
  const prev = () => { setI((i-1+item.cards.length) % item.cards.length); setFlipped(false); };
  return (
    <div className="flex flex-col h-full">
      <div className="px-7 pt-6 pb-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">
          <span style={{ color: '#20b8b2' }}>Flashcards</span> · {i+1}/{item.cards.length} · {item.meta?.mastered || 0} mastered
        </div>
        <h1 className="font-display text-[28px] leading-[1.05] text-ink-100 mt-2">{item.title}</h1>
      </div>
      <div className="px-7 pb-5 flex-1 flex flex-col">
        <button onClick={() => setFlipped(!flipped)}
                className="flex-1 bg-paper border border-line rounded-xl p-6 flex items-center justify-center text-center hover:border-mint/50 transition-colors">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-400 mb-3">{flipped ? 'Answer' : 'Question'}</div>
            <div className="font-display text-[20px] leading-[1.3] text-ink-100 max-w-md">{flipped ? card.a : card.q}</div>
          </div>
        </button>
        <div className="flex items-center justify-between mt-3">
          <button onClick={prev} className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-300 hover:text-ink-100 px-2 py-1">← prev</button>
          <div className="flex gap-1.5">
            {item.cards.map((_, j) => <div key={j} className={`w-1 h-1 rounded-full ${j===i?'bg-accent':'bg-line'}`} />)}
          </div>
          <button onClick={next} className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-300 hover:text-ink-100 px-2 py-1">next →</button>
        </div>
        <div className="mt-3 flex gap-2">
          <button className="flex-1 py-2 border border-line rounded-lg text-[11px] font-mono uppercase tracking-[0.1em] text-ink-300 hover:border-coral/50 hover:text-coral">again</button>
          <button className="flex-1 py-2 border border-line rounded-lg text-[11px] font-mono uppercase tracking-[0.1em] text-ink-300 hover:border-warn/50 hover:text-warn">hard</button>
          <button className="flex-1 py-2 border border-line rounded-lg text-[11px] font-mono uppercase tracking-[0.1em] text-ink-300 hover:border-mint/50 hover:text-mint">good</button>
          <button className="flex-1 py-2 border border-line rounded-lg text-[11px] font-mono uppercase tracking-[0.1em] text-ink-300 hover:border-accent/50 hover:text-accent">easy</button>
        </div>
      </div>
    </div>
  );
};

const BloomThread = ({ item }) => (
  <div className="flex flex-col h-full">
    <div className="px-7 pt-6 pb-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">
        <span style={{ color: '#0e8ee8' }}>Thread</span> · {item.messages.length} messages
      </div>
      <h1 className="font-display text-[24px] leading-[1.1] text-ink-100 mt-2">{item.title}</h1>
    </div>
    <div className="px-7 pb-4 overflow-y-auto slim-scroll flex-1 space-y-3">
      {item.messages.map((m, i) => (
        <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[82%] text-[12.5px] leading-[1.58] ${m.role === 'user' ? 'bg-[#f0f7ff] border border-accent/20 text-ink-200' : 'bg-paper border border-line text-ink-200'} rounded-xl px-3.5 py-2 whitespace-pre-wrap`}>
            {m.text}
          </div>
        </div>
      ))}
    </div>
    <div className="px-7 pb-5 pt-2 border-t border-line/60">
      <div className="flex items-center gap-2 bg-paper border border-line rounded-full px-3 py-1.5">
        <Icon name="sparkle" size={12} className="text-accent" />
        <input className="flex-1 bg-transparent text-[12.5px] outline-none text-ink-100 placeholder:text-ink-400" placeholder="Continue thread…" />
        <Icon name="send" size={12} className="text-ink-400" />
      </div>
    </div>
  </div>
);

const BloomReading = ({ item }) => (
  <div className="flex flex-col h-full">
    <div className="px-7 pt-6 pb-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">
        Reading · {item.meta?.pages} pages · {item.meta?.highlights || 0} highlights
      </div>
      <h1 className="font-display text-[26px] leading-[1.08] text-ink-100 mt-2">{item.title}</h1>
    </div>
    <div className="px-7 pb-6 flex-1 flex flex-col">
      <div className="flex-1 placeholder-img rounded-lg border border-line flex items-center justify-center">
        <div className="text-center">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-400 mb-1">Preview</div>
          <div className="font-mono text-[10.5px] text-ink-300">PDF · {item.meta?.pages} pages</div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button className="flex-1 py-2 border border-line rounded-lg text-[11px] font-mono uppercase tracking-[0.1em] text-ink-300 hover:text-accent hover:border-accent/50">✦ summarize</button>
        <button className="flex-1 py-2 border border-line rounded-lg text-[11px] font-mono uppercase tracking-[0.1em] text-ink-300 hover:text-accent hover:border-accent/50">make flashcards</button>
        <button className="flex-1 py-2 border border-line rounded-lg text-[11px] font-mono uppercase tracking-[0.1em] text-ink-300 hover:text-accent hover:border-accent/50">quiz me</button>
      </div>
    </div>
  </div>
);

const BloomSchedule = ({ item }) => (
  <div className="flex flex-col h-full p-7">
    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-coral">Due</div>
    <h1 className="font-display text-[28px] leading-[1.1] text-ink-100 mt-2">{item.title}</h1>
    <div className="mt-4 text-[13px] text-ink-200">{item.preview}</div>
    <div className="mt-6 grid grid-cols-2 gap-3">
      <div className="border border-line rounded-lg p-3">
        <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-400">When</div>
        <div className="font-display text-[22px] text-ink-100 mt-1">{item.meta?.when} · {item.meta?.time}</div>
      </div>
      <div className="border border-line rounded-lg p-3">
        <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-400">In</div>
        <div className="font-display text-[22px] text-ink-100 mt-1">2 days</div>
      </div>
    </div>
    <button className="mt-4 py-2 border border-line rounded-lg text-[11px] font-mono uppercase tracking-[0.1em] text-ink-300 hover:text-accent hover:border-accent/50">✦ plan study sessions</button>
  </div>
);

const BloomBody = ({ item }) => {
  switch (item.kind) {
    case 'essay': return <BloomEssay item={item} />;
    case 'pset': return <BloomPset item={item} />;
    case 'flashcards': return <BloomFlashcards item={item} />;
    case 'thread': return <BloomThread item={item} />;
    case 'reading': return <BloomReading item={item} />;
    case 'schedule': return <BloomSchedule item={item} />;
    case 'note': default: return <BloomNote item={item} />;
  }
};

// ─── The Item component. Renders correct layer based on mode ───────────
// mode: 'glance' | 'touch' | 'bloom'
const Item = ({ item, mode, focused, selected, aiTouched, onClick, onDoubleClick, onPin, onClose }) => {
  const bloomed = mode === 'bloom';
  const baseCls = `field rounded-[14px] border border-line overflow-hidden bg-paper/50 ${focused ? 'focused' : ''} ${selected ? 'ring-2 ring-accent/50' : ''} ${bloomed ? 'bloomed bloom-in' : ''} ${aiTouched ? 'ai-touched' : ''}` + ' w-full h-full relative';
  return (
    <div data-bloom-editor={bloomed ? '1' : undefined} className={baseCls}
         onClick={(e) => { e.stopPropagation(); onClick && onClick(item, e); }}
         onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick && onDoubleClick(item); }}>
      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: item.color, opacity: focused || bloomed ? 1 : 0.4 }} />
      {mode === 'glance' && <GlanceLayer item={item} />}
      {mode === 'touch' && <TouchLayer item={item} />}
      {mode === 'bloom' && <BloomBody item={item} />}
      {bloomed && (
        <div className="absolute top-3 right-3 flex gap-1">
          <button onClick={(e) => { e.stopPropagation(); onPin && onPin(item); }}
                  className="w-7 h-7 rounded-full border border-line bg-paper/80 flex items-center justify-center text-ink-400 hover:text-accent hover:border-accent/40" title="Pin to tray">
            <Icon name="pin" size={13} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onClose && onClose(); }}
                  className="w-7 h-7 rounded-full border border-line bg-paper/80 flex items-center justify-center text-ink-400 hover:text-ink-100 hover:border-ink-300/50" title="Collapse (Esc)">
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
    </div>
  );
};

window.Item = Item;
window.KIND_META = KIND_META;
