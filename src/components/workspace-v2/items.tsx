"use client";

import { useMemo, useState } from "react";
import { Icon } from "./icons";
import { KIND_META, type V2Item } from "./data";

/* ─── Layer: glance ─── */
function GlanceLayer({ item }: { item: V2Item }) {
  const meta = KIND_META[item.kind];
  return (
    <div className="p-4 h-full flex flex-col justify-between">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5" style={{ color: meta.tone }}>
          <Icon name={meta.icon} size={14} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-display text-[17px] leading-[1.2] truncate" style={{ color: "var(--ink-100)" }}>
            {item.title}
          </div>
        </div>
      </div>
      <div className="flex items-end justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color: "var(--ink-400)" }}>
          {meta.label}
        </span>
        {item.updated && (
          <span className="font-mono text-[9.5px]" style={{ color: "var(--ink-400)" }}>{item.updated}</span>
        )}
      </div>
    </div>
  );
}

/* ─── Layer: touch ─── */
function TouchLayer({ item }: { item: V2Item }) {
  const meta = KIND_META[item.kind];
  return (
    <div className="p-5 h-full flex flex-col">
      <div className="flex items-start gap-2.5 mb-2">
        <span className="mt-1 shrink-0" style={{ color: meta.tone }}>
          <Icon name={meta.icon} size={14} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-display text-[20px] leading-[1.15]" style={{ color: "var(--ink-100)" }}>
            {item.title}
          </div>
          <div className="sv2-rule mt-1" style={{ width: 32 }} />
        </div>
      </div>
      <div
        className="text-[12.5px] leading-[1.58] mt-2 flex-1"
        style={{
          color: "var(--ink-200)",
          display: "-webkit-box",
          WebkitLineClamp: 4,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {item.preview}
      </div>
      <div
        className="flex items-center justify-between mt-3 pt-2"
        style={{ borderTop: "1px solid rgba(221,216,207,0.6)" }}
      >
        <span className="font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color: "var(--ink-400)" }}>
          {meta.label}
        </span>
        <span className="font-mono text-[9.5px]" style={{ color: "var(--ink-400)" }}>{item.updated}</span>
      </div>
    </div>
  );
}

/* ─── Bloom body: type-specific full editor ─── */

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") ? <strong key={i} style={{ fontWeight: 600, color: "var(--ink-100)" }}>{p.slice(2, -2)}</strong> : p,
  );
}

function renderMarkdown(md: string) {
  const lines = md.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("# ")) {
      return <h2 key={i} className="font-display text-[26px] mt-3 mb-2 leading-tight" style={{ color: "var(--ink-100)" }}>{line.slice(2)}</h2>;
    }
    if (line.startsWith("## ")) {
      return <h3 key={i} className="font-display text-[19px] mt-4 mb-1.5" style={{ color: "var(--ink-100)" }}>{line.slice(3)}</h3>;
    }
    if (line.startsWith("- ") || line.startsWith("• ")) {
      return <li key={i} className="ml-5 list-disc text-[13.5px] leading-[1.6]" style={{ color: "var(--ink-200)" }}>{renderInline(line.slice(2))}</li>;
    }
    if (line.startsWith("|")) {
      return <div key={i} className="font-mono text-[11px]" style={{ color: "var(--ink-200)" }}>{line}</div>;
    }
    if (line.trim() === "") return <div key={i} className="h-2" />;
    return <p key={i} className="text-[13.5px] leading-[1.72]" style={{ color: "var(--ink-200)" }}>{renderInline(line)}</p>;
  });
}

function BloomNote({ item, onEditBody }: { item: V2Item; onEditBody?: (body: string) => void }) {
  const [body, setBody] = useState(item.body || item.preview || "");
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex flex-col h-full">
      <div className="px-7 pt-6 pb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>
          <span style={{ color: "var(--ink-300)" }}>Note</span> · {item.updated || "draft"}
        </div>
        <h1 className="font-display text-[32px] leading-[1.05] mt-3" style={{ color: "var(--ink-100)" }}>
          {item.title}
        </h1>
        <div className="mt-2 h-px w-16" style={{ background: "rgba(14,142,232,0.6)" }} />
      </div>
      <div className="px-7 pb-6 overflow-y-auto sv2-slim flex-1">
        {editing ? (
          <textarea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => { setEditing(false); onEditBody?.(body); }}
            className="w-full min-h-[240px] bg-transparent outline-none text-[13.5px] leading-[1.72] resize-none font-display"
            style={{ color: "var(--ink-200)" }}
          />
        ) : (
          <div onDoubleClick={() => setEditing(true)} className="space-y-0.5 cursor-text">
            {renderMarkdown(body)}
          </div>
        )}
        <div className="mt-4 text-[12.5px] italic border-l-2 pl-3 py-1"
             style={{ color: "var(--ink-400)", borderColor: "rgba(14,142,232,0.4)" }}>
          Double-click to edit · press <span className="sv2-kbd" style={{ display: "inline-flex" }}>/</span> to invoke AI.
        </div>
      </div>
    </div>
  );
}

function BloomEssay({ item }: { item: V2Item }) {
  const words = (item.meta?.words as number) || 0;
  const target = (item.meta?.target as number) || 1500;
  const pct = Math.min(100, Math.round((words / target) * 100));
  return (
    <div className="flex flex-col h-full">
      <div className="px-7 pt-6 pb-2">
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>
            <span style={{ color: "#b67616" }}>Essay draft</span> · {words}/{target} words
          </div>
          <div className="w-32 h-1 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
            <div className="h-full" style={{ width: `${pct}%`, background: "var(--warn)" }} />
          </div>
        </div>
        <h1 className="font-display text-[34px] leading-[1.02] mt-3" style={{ color: "var(--ink-100)" }}>
          {item.title}
        </h1>
      </div>
      <div className="px-7 pb-6 overflow-y-auto sv2-slim flex-1">
        <div className="text-[15px] leading-[1.82] font-display whitespace-pre-wrap"
             style={{ color: "var(--ink-200)" }}>
          {item.body || item.preview}
        </div>
        <div className="mt-6 p-3 rounded-lg flex items-start gap-2"
             style={{ background: "rgba(237,233,227,0.6)", border: "1px solid var(--line)" }}>
          <Icon name="sparkle" size={14} className="mt-0.5" style={{ color: "var(--accent)" }} />
          <div className="flex-1">
            <div className="text-[12px]" style={{ color: "var(--ink-100)", fontWeight: 600 }}>AI suggestion</div>
            <div className="text-[12px] mt-0.5" style={{ color: "var(--ink-200)" }}>
              Consider strengthening your thesis with a concrete image in paragraph one.
            </div>
          </div>
          <button className="text-[10px] font-mono uppercase tracking-[0.1em]"
                  style={{ color: "var(--ink-300)" }}>accept</button>
        </div>
      </div>
    </div>
  );
}

function BloomPset({ item }: { item: V2Item }) {
  const [probs, setProbs] = useState(item.problems || []);
  const cycle = (i: number) => {
    const order: Array<"todo" | "stuck" | "done"> = ["todo", "stuck", "done"];
    setProbs(probs.map((p, j) => (j === i ? { ...p, status: order[(order.indexOf(p.status) + 1) % 3] } : p)));
  };
  const statusColor = (s: string) => (s === "done" ? "#148f5d" : s === "stuck" ? "#e05137" : "#9e9082");
  return (
    <div className="flex flex-col h-full">
      <div className="px-7 pt-6 pb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>
          <span style={{ color: "#0e8ee8" }}>Problem set</span> · {probs.filter((p) => p.status === "done").length}/{probs.length} complete
        </div>
        <h1 className="font-display text-[30px] leading-[1.05] mt-2" style={{ color: "var(--ink-100)" }}>
          {item.title}
        </h1>
      </div>
      <div className="px-7 pb-6 overflow-y-auto sv2-slim flex-1 space-y-2">
        {probs.map((p, i) => (
          <div key={i} className="group flex items-start gap-3 py-2.5"
               style={{ borderBottom: i === probs.length - 1 ? "none" : "1px solid rgba(221,216,207,0.5)" }}>
            <button
              onClick={() => cycle(i)}
              className="mt-1 w-4 h-4 rounded-full border flex items-center justify-center shrink-0"
              style={{ borderColor: statusColor(p.status), background: p.status === "done" ? statusColor(p.status) : "transparent" }}
            >
              {p.status === "done" && <Icon name="check" size={10} stroke="#fff" />}
              {p.status === "stuck" && <div className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor(p.status) }} />}
            </button>
            <div className="flex-1">
              <div className="font-mono text-[12.5px]" style={{ color: "var(--ink-100)" }}>{p.q}</div>
              {p.a && <div className="font-mono text-[11.5px] mt-0.5" style={{ color: "var(--ink-300)" }}>= {p.a}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BloomFlashcards({ item }: { item: V2Item }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const cards = item.cards || [];
  const card = cards[i];
  if (!card) return <div className="p-6 text-[13px]" style={{ color: "var(--ink-300)" }}>No cards yet.</div>;
  const next = () => { setI((i + 1) % cards.length); setFlipped(false); };
  const prev = () => { setI((i - 1 + cards.length) % cards.length); setFlipped(false); };
  return (
    <div className="flex flex-col h-full">
      <div className="px-7 pt-6 pb-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>
          <span style={{ color: "#20b8b2" }}>Flashcards</span> · {i + 1}/{cards.length}
        </div>
        <h1 className="font-display text-[28px] leading-[1.05] mt-2" style={{ color: "var(--ink-100)" }}>{item.title}</h1>
      </div>
      <div className="px-7 pb-5 flex-1 flex flex-col">
        <button
          onClick={() => setFlipped(!flipped)}
          className="flex-1 rounded-xl p-6 flex items-center justify-center text-center transition-colors"
          style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
        >
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] mb-3" style={{ color: "var(--ink-400)" }}>
              {flipped ? "Answer" : "Question"}
            </div>
            <div className="font-display text-[20px] leading-[1.3] max-w-md" style={{ color: "var(--ink-100)" }}>
              {flipped ? card.a : card.q}
            </div>
          </div>
        </button>
        <div className="flex items-center justify-between mt-3">
          <button onClick={prev} className="font-mono text-[10px] uppercase tracking-[0.14em] px-2 py-1"
                  style={{ color: "var(--ink-300)" }}>← prev</button>
          <div className="flex gap-1.5">
            {cards.map((_, j) => (
              <div key={j} className="w-1 h-1 rounded-full"
                   style={{ background: j === i ? "var(--accent)" : "var(--line)" }} />
            ))}
          </div>
          <button onClick={next} className="font-mono text-[10px] uppercase tracking-[0.14em] px-2 py-1"
                  style={{ color: "var(--ink-300)" }}>next →</button>
        </div>
      </div>
    </div>
  );
}

function BloomThread({ item }: { item: V2Item }) {
  const messages = item.messages || [];
  return (
    <div className="flex flex-col h-full">
      <div className="px-7 pt-6 pb-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>
          <span style={{ color: "#0e8ee8" }}>Thread</span> · {messages.length} messages
        </div>
        <h1 className="font-display text-[24px] leading-[1.1] mt-2" style={{ color: "var(--ink-100)" }}>{item.title}</h1>
      </div>
      <div className="px-7 pb-4 overflow-y-auto sv2-slim flex-1 space-y-3">
        {messages.length === 0 && (
          <div className="text-[13px] italic" style={{ color: "var(--ink-300)" }}>
            No messages yet. Send one from the bar below.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className="max-w-[82%] text-[12.5px] leading-[1.58] rounded-xl px-3.5 py-2 whitespace-pre-wrap"
              style={{
                background: m.role === "user" ? "rgba(14,142,232,0.06)" : "var(--paper)",
                border: `1px solid ${m.role === "user" ? "rgba(14,142,232,0.2)" : "var(--line)"}`,
                color: "var(--ink-200)",
              }}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>
      <div className="px-7 pb-5 pt-2" style={{ borderTop: "1px solid rgba(221,216,207,0.6)" }}>
        <div className="flex items-center gap-2 rounded-full px-3 py-1.5"
             style={{ background: "var(--paper)", border: "1px solid var(--line)" }}>
          <Icon name="sparkle" size={12} style={{ color: "var(--accent)" }} />
          <input
            className="flex-1 bg-transparent text-[12.5px] outline-none"
            style={{ color: "var(--ink-100)" }}
            placeholder="Continue thread…"
          />
          <Icon name="send" size={12} style={{ color: "var(--ink-400)" }} />
        </div>
      </div>
    </div>
  );
}

function BloomReading({ item }: { item: V2Item }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-7 pt-6 pb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>
          Reading · {(item.meta?.pages as number) || "—"} pages
        </div>
        <h1 className="font-display text-[26px] leading-[1.08] mt-2" style={{ color: "var(--ink-100)" }}>{item.title}</h1>
      </div>
      <div className="px-7 pb-6 flex-1 flex flex-col">
        <div className="flex-1 sv2-placeholder rounded-lg flex items-center justify-center"
             style={{ border: "1px solid var(--line)" }}>
          <div className="text-center">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] mb-1" style={{ color: "var(--ink-400)" }}>
              Preview
            </div>
            <div className="font-mono text-[10.5px]" style={{ color: "var(--ink-300)" }}>{item.preview || "No preview"}</div>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          {["✦ summarize", "make flashcards", "quiz me"].map((label) => (
            <button key={label} className="flex-1 py-2 rounded-lg text-[11px] font-mono uppercase tracking-[0.1em]"
                    style={{ border: "1px solid var(--line)", color: "var(--ink-300)" }}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function BloomSchedule({ item }: { item: V2Item }) {
  return (
    <div className="flex flex-col h-full p-7">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--coral)" }}>Planner · Task</div>
      <h1 className="font-display text-[28px] leading-[1.1] mt-2" style={{ color: "var(--ink-100)" }}>{item.title}</h1>
      <div className="mt-4 text-[13px]" style={{ color: "var(--ink-200)" }}>{item.preview}</div>
    </div>
  );
}

function BloomVisual({ item }: { item: V2Item }) {
  return (
    <div className="flex flex-col h-full p-7">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>Visual</div>
      <h1 className="font-display text-[28px] leading-[1.1] mt-2" style={{ color: "var(--ink-100)" }}>{item.title}</h1>
      <div className="mt-4 flex-1 sv2-placeholder rounded-lg flex items-center justify-center"
           style={{ border: "1px solid var(--line)" }}>
        <div className="text-[12px]" style={{ color: "var(--ink-300)" }}>{item.preview}</div>
      </div>
    </div>
  );
}

function BloomBody({ item, onEdit }: { item: V2Item; onEdit?: (patch: Partial<V2Item>) => void }) {
  switch (item.kind) {
    case "essay": return <BloomEssay item={item} />;
    case "pset": return <BloomPset item={item} />;
    case "flashcards": return <BloomFlashcards item={item} />;
    case "thread": return <BloomThread item={item} />;
    case "reading": return <BloomReading item={item} />;
    case "schedule": return <BloomSchedule item={item} />;
    case "visual": return <BloomVisual item={item} />;
    case "code":
    case "note":
    default:
      return <BloomNote item={item} onEditBody={(body) => onEdit?.({ body })} />;
  }
}

/* ─── The Item renderer ─── */
type ItemProps = {
  item: V2Item;
  mode: "glance" | "touch" | "bloom";
  focused?: boolean;
  selected?: boolean;
  aiTouched?: boolean;
  onClick?: (item: V2Item, e: React.MouseEvent) => void;
  onDoubleClick?: (item: V2Item) => void;
  onPin?: (item: V2Item) => void;
  onClose?: () => void;
  onEdit?: (patch: Partial<V2Item>) => void;
  bloomPrimary?: boolean;
};

export function ItemCard({
  item, mode, focused, selected, aiTouched,
  onClick, onDoubleClick, onPin, onClose, onEdit, bloomPrimary,
}: ItemProps) {
  const bloomed = mode === "bloom";
  const className = useMemo(() => {
    if (bloomed) {
      return `sv2-bloom-surface sv2-bloom-in ${bloomPrimary ? "primary" : ""} ${aiTouched ? "sv2-ai-touched" : ""} w-full h-full relative`;
    }
    return `sv2-field ${focused ? "focused" : ""} ${selected ? "selected" : ""} ${aiTouched ? "sv2-ai-touched" : ""} w-full h-full relative`;
  }, [bloomed, bloomPrimary, focused, selected, aiTouched]);

  return (
    <div
      data-bloom-editor={bloomed ? "1" : undefined}
      className={className}
      onClick={(e) => { e.stopPropagation(); onClick?.(item, e); }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(item); }}
    >
      <div className="absolute top-0 left-0 right-0 h-[2px]"
           style={{ background: item.color, opacity: focused || bloomed ? 1 : 0.4 }} />
      {mode === "glance" && <GlanceLayer item={item} />}
      {mode === "touch" && <TouchLayer item={item} />}
      {mode === "bloom" && <BloomBody item={item} onEdit={onEdit} />}
      {bloomed && (
        <div className="absolute top-3 right-3 flex gap-1 z-10">
          <button
            onClick={(e) => { e.stopPropagation(); onPin?.(item); }}
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{
              border: "1px solid var(--line)",
              background: "rgba(251,250,246,0.9)",
              color: "var(--ink-400)",
            }}
            title="Pin to tray"
          >
            <Icon name="pin" size={13} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose?.(); }}
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{
              border: "1px solid var(--line)",
              background: "rgba(251,250,246,0.9)",
              color: "var(--ink-400)",
            }}
            title="Collapse (Esc)"
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
