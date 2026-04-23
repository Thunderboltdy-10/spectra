"use client";

import { useMemo, useState, useEffect } from "react";
import { Icon } from "./icons";
import { KIND_META, type V2Item } from "./data";

/* ─── Layer: glance — minimal card at zoom-out ─── */
function GlanceLayer({ item }: { item: V2Item }) {
  const meta = KIND_META[item.kind];
  return (
    <div className="p-4 h-full flex flex-col justify-between">
      <div className="flex items-start gap-2.5">
        <div
          className="mt-0.5 w-5 h-5 rounded flex items-center justify-center shrink-0"
          style={{ background: `${meta.tone}12` }}
        >
          <Icon name={meta.icon} size={11} style={{ color: meta.tone }} />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="font-display text-[16px] leading-[1.22] truncate"
            style={{ color: "var(--ink-100)" }}
          >
            {item.title}
          </div>
          {item.preview && (
            <div
              className="text-[11px] leading-[1.45] mt-1 truncate"
              style={{ color: "var(--ink-400)", maxWidth: "90%" }}
            >
              {item.preview.slice(0, 60)}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-end justify-between mt-2">
        <span
          className="font-mono text-[9px] uppercase tracking-[0.14em] font-medium"
          style={{ color: meta.tone, opacity: 0.75 }}
        >
          {meta.label}
        </span>
        {item.updated && (
          <span className="font-mono text-[9px]" style={{ color: "var(--ink-500)" }}>
            {item.updated}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Layer: touch — rich card at working zoom ─── */
function TouchLayer({ item, onEdit }: { item: V2Item; onEdit?: (patch: Partial<V2Item>) => void }) {
  const meta = KIND_META[item.kind];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  useEffect(() => { setDraft(item.title); }, [item.title]);
  return (
    <div className="p-5 h-full flex flex-col">
      {/* Header row */}
      <div className="flex items-start gap-3 mb-3">
        <div
          className="mt-0.5 w-6 h-6 rounded-md flex items-center justify-center shrink-0"
          style={{ background: `${meta.tone}14` }}
        >
          <Icon name={meta.icon} size={13} style={{ color: meta.tone }} />
        </div>
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onBlur={() => {
                setEditing(false);
                const next = draft.trim();
                if (next && next !== item.title) onEdit?.({ title: next });
                else setDraft(item.title);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { (e.currentTarget as HTMLInputElement).blur(); }
                if (e.key === "Escape") { setDraft(item.title); setEditing(false); }
              }}
              className="w-full bg-transparent outline-none font-display text-[21px] leading-[1.15] tracking-[-0.01em]"
              style={{ color: "var(--ink-100)" }}
            />
          ) : (
            <div
              className="font-display text-[21px] leading-[1.15] tracking-[-0.01em] truncate cursor-text"
              style={{ color: "var(--ink-100)" }}
              title="Double-click to rename"
              onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
            >
              {item.title}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-2">
            <div
              className="h-[2px] rounded-full"
              style={{ width: 28, background: meta.tone, opacity: 0.5 }}
            />
            <span
              className="font-mono text-[9px] uppercase tracking-[0.14em] font-medium"
              style={{ color: meta.tone, opacity: 0.65 }}
            >
              {meta.label}
            </span>
          </div>
        </div>
      </div>

      {/* Preview body */}
      {item.preview && (
        <div
          className="text-[12.5px] leading-[1.62] flex-1"
          style={{
            color: "var(--ink-300)",
            display: "-webkit-box",
            WebkitLineClamp: 4,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {item.preview}
        </div>
      )}

      {/* Footer */}
      <div
        className="flex items-center justify-between mt-auto pt-3"
        style={{ borderTop: "1px solid rgba(221,216,207,0.45)" }}
      >
        <span className="font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-400)" }}>
          {item.updated || "—"}
        </span>
        <div className="flex items-center gap-1 opacity-50" style={{ color: "var(--ink-400)" }}>
          <Icon name="expand" size={10} />
          <span className="font-mono text-[8.5px] uppercase tracking-[0.1em]">open</span>
        </div>
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

  useEffect(() => {
    if (!item.sourceArtifactId) return;
    let cancelled = false;
    fetch(`/api/artifacts?artifactId=${item.sourceArtifactId}`)
      .then(r => r.json())
      .then(data => {
         if (cancelled) return;
         if (data.artifact?.contentPlaintext || data.artifact?.content) {
           setBody(data.artifact.contentPlaintext || data.artifact.content);
         }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.sourceArtifactId]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-7 pb-3" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-5 h-5 rounded flex items-center justify-center"
            style={{ background: "rgba(107,95,82,0.08)" }}
          >
            <Icon name="note" size={11} style={{ color: "#6b5f52" }} />
          </div>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "#6b5f52" }}>
            Note
          </span>
          <span className="font-mono text-[9.5px]" style={{ color: "var(--ink-400)" }}>
            · {item.updated || "draft"}
          </span>
        </div>
        <h1 className="font-display text-[32px] leading-[1.05] tracking-[-0.02em]" style={{ color: "var(--ink-100)" }}>
          {item.title}
        </h1>
        <div className="mt-3 h-[2px] w-14 rounded-full" style={{ background: "rgba(107,95,82,0.3)" }} />
      </div>
      <div className="px-8 pb-7 overflow-y-auto sv2-slim flex-1 pt-4">
        {editing ? (
          <textarea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => { setEditing(false); onEditBody?.(body); }}
            className="w-full min-h-[240px] bg-transparent outline-none text-[14px] leading-[1.78] resize-none font-display"
            style={{ color: "var(--ink-200)" }}
          />
        ) : (
          <div onDoubleClick={() => setEditing(true)} className="space-y-1 cursor-text">
            {renderMarkdown(body)}
          </div>
        )}
        <div
          className="mt-6 text-[12px] italic border-l-2 pl-3.5 py-1.5 rounded-r"
          style={{ color: "var(--ink-400)", borderColor: "rgba(107,95,82,0.25)", background: "rgba(107,95,82,0.03)" }}
        >
          Double-click to edit · press <span className="sv2-kbd" style={{ display: "inline-flex" }}>/</span> to invoke AI.
        </div>
      </div>
    </div>
  );
}

function BloomEssay({ item, onEdit }: { item: V2Item; onEdit?: (patch: Partial<V2Item>) => void }) {
  const target = (item.meta?.target as number) || 1500;
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(item.body || item.preview || "");

  useEffect(() => {
    if (!item.sourceArtifactId) return;
    let cancelled = false;
    fetch(`/api/artifacts?artifactId=${item.sourceArtifactId}`)
      .then(r => r.json())
      .then(data => {
         if (cancelled) return;
         if (data.artifact?.contentPlaintext || data.artifact?.content) {
           setBody(data.artifact.contentPlaintext || data.artifact.content);
         }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.sourceArtifactId]);

  const words = body.split(/\s+/).filter(w => w.length > 0).length || (item.meta?.words as number) || 0;
  const pct = Math.min(100, Math.round((words / target) * 100));

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-7 pb-3" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-5 h-5 rounded flex items-center justify-center"
            style={{ background: "rgba(182,118,22,0.1)" }}
          >
            <Icon name="essay" size={11} style={{ color: "#b67616" }} />
          </div>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "#b67616" }}>
            Essay draft
          </span>
          <span className="font-mono text-[9.5px]" style={{ color: "var(--ink-400)" }}>
            · {words}/{target} words
          </span>
        </div>
        <h1 className="font-display text-[34px] leading-[1.02] tracking-[-0.02em]" style={{ color: "var(--ink-100)" }}>
          {item.title}
        </h1>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 h-[3px] rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: pct >= 100 ? "var(--ok)" : "var(--warn)" }}
            />
          </div>
          <span className="font-mono text-[10px] font-medium" style={{ color: pct >= 100 ? "var(--ok)" : "var(--ink-400)" }}>
            {pct}%
          </span>
        </div>
      </div>
      <div className="px-8 pb-7 overflow-y-auto sv2-slim flex-1 pt-4">
        {editing ? (
          <textarea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => { setEditing(false); onEdit?.({ body }); }}
            className="w-full min-h-[240px] bg-transparent outline-none text-[15px] leading-[1.82] resize-none font-display whitespace-pre-wrap"
            style={{ color: "var(--ink-200)" }}
          />
        ) : (
          <div onDoubleClick={() => setEditing(true)} className="text-[15px] leading-[1.82] font-display whitespace-pre-wrap cursor-text"
               style={{ color: "var(--ink-200)" }}>
            {body}
          </div>
        )}
        <div className="mt-6 p-3.5 rounded-xl flex items-start gap-3"
             style={{ background: "rgba(182,118,22,0.04)", border: "1px solid rgba(182,118,22,0.12)" }}>
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: "rgba(14,142,232,0.08)" }}
          >
            <Icon name="sparkle" size={12} style={{ color: "var(--accent)" }} />
          </div>
          <div className="flex-1">
            <div className="text-[12px] font-semibold" style={{ color: "var(--ink-100)" }}>AI suggestion</div>
            <div className="text-[12px] mt-0.5 leading-[1.5]" style={{ color: "var(--ink-300)" }}>
              Consider strengthening your thesis with a concrete image in paragraph one.
            </div>
          </div>
          <button
             className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded-md hover:bg-[var(--bg2)] transition-colors"
             style={{ color: "var(--accent)" }}
             onClick={() => {
               const newBody = "Consider strengthening your thesis with a concrete image in paragraph one.\n\n" + body;
               setBody(newBody);
               onEdit?.({ body: newBody });
             }}
          >accept</button>
        </div>
      </div>
    </div>
  );
}

function BloomPset({ item, onEdit }: { item: V2Item; onEdit?: (patch: Partial<V2Item>) => void }) {
  const [probs, setProbs] = useState(item.problems || []);
  const cycle = (i: number) => {
    const order: Array<"todo" | "stuck" | "done"> = ["todo", "stuck", "done"];
    const next = probs.map((p, j) => (j === i ? { ...p, status: order[(order.indexOf(p.status) + 1) % 3] as "todo" | "stuck" | "done" } : p));
    setProbs(next);
    onEdit?.({ problems: next, body: JSON.stringify(next) });
  };
  const statusColor = (s: string) => (s === "done" ? "#148f5d" : s === "stuck" ? "#e05137" : "#9e9082");
  const statusIcon = (s: string) => (s === "done" ? "check" : s === "stuck" ? "close" : "minus");
  const doneCount = probs.filter((p) => p.status === "done").length;
  const pct = probs.length > 0 ? Math.round((doneCount / probs.length) * 100) : 0;

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-7 pb-3" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-5 h-5 rounded flex items-center justify-center"
            style={{ background: "rgba(14,142,232,0.08)" }}
          >
            <Icon name="pset" size={11} style={{ color: "#0e8ee8" }} />
          </div>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "#0e8ee8" }}>
            Problem set
          </span>
          <span className="font-mono text-[9.5px]" style={{ color: "var(--ink-400)" }}>
            · {doneCount}/{probs.length} complete
          </span>
        </div>
        <h1 className="font-display text-[30px] leading-[1.05] tracking-[-0.02em]" style={{ color: "var(--ink-100)" }}>
          {item.title}
        </h1>
        {probs.length > 0 && (
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 h-[3px] rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: "var(--accent)" }}
              />
            </div>
            <span className="font-mono text-[10px] font-medium" style={{ color: pct === 100 ? "var(--ok)" : "var(--ink-400)" }}>
              {pct}%
            </span>
          </div>
        )}
      </div>
      <div className="px-8 pb-6 overflow-y-auto sv2-slim flex-1 space-y-1 pt-3">
        {probs.map((p, i) => (
          <div key={i} className="group flex items-start gap-3.5 py-3 rounded-lg px-2 -mx-2 hover:bg-[var(--accent-soft)] transition-colors"
               style={{ borderBottom: i === probs.length - 1 ? "none" : "1px solid rgba(221,216,207,0.35)" }}>
            <button
              onClick={() => cycle(i)}
              className="mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
              style={{ borderColor: statusColor(p.status), background: p.status === "done" ? statusColor(p.status) : "transparent" }}
            >
              <Icon name={statusIcon(p.status)} size={9} stroke={p.status === "done" ? "#fff" : statusColor(p.status)} />
            </button>
            <div className="flex-1">
              <div className="font-mono text-[13px] leading-[1.5]" style={{ color: p.status === "done" ? "var(--ink-400)" : "var(--ink-100)", textDecoration: p.status === "done" ? "line-through" : "none" }}>
                {p.q}
              </div>
              {p.a && (
                <div className="font-mono text-[12px] mt-1 px-2.5 py-1 rounded-md inline-block"
                     style={{ color: "var(--ink-300)", background: "var(--bg2)" }}>
                  = {p.a}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BloomFlashcards({ item }: { item: V2Item; onEdit?: (patch: Partial<V2Item>) => void }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const cards = item.cards || [];
  const card = cards[i];
  if (!card) return <div className="p-8 text-[13px]" style={{ color: "var(--ink-300)" }}>No cards yet.</div>;
  const next = () => { setI((i + 1) % cards.length); setFlipped(false); };
  const prev = () => { setI((i - 1 + cards.length) % cards.length); setFlipped(false); };

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-7 pb-3" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-5 h-5 rounded flex items-center justify-center"
            style={{ background: "rgba(32,184,178,0.1)" }}
          >
            <Icon name="flashcards" size={11} style={{ color: "#20b8b2" }} />
          </div>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "#20b8b2" }}>
            Flashcards
          </span>
          <span className="font-mono text-[9.5px]" style={{ color: "var(--ink-400)" }}>
            · {i + 1}/{cards.length}
          </span>
        </div>
        <h1 className="font-display text-[28px] leading-[1.05] tracking-[-0.02em]" style={{ color: "var(--ink-100)" }}>{item.title}</h1>
      </div>
      <div className="px-8 pb-6 flex-1 flex flex-col pt-5">
        <button
          onClick={() => setFlipped(!flipped)}
          className="flex-1 rounded-xl p-8 flex items-center justify-center text-center transition-all duration-300 hover:shadow-lg"
          style={{
            background: flipped ? "rgba(32,184,178,0.04)" : "var(--paper-deep)",
            border: `1.5px solid ${flipped ? "rgba(32,184,178,0.2)" : "var(--line)"}`,
            transform: flipped ? "scale(0.99)" : "scale(1)",
          }}
        >
          <div>
            <div
              className="font-mono text-[9px] uppercase tracking-[0.16em] mb-4 font-medium"
              style={{ color: flipped ? "#20b8b2" : "var(--ink-400)" }}
            >
              {flipped ? "Answer" : "Question"}
            </div>
            <div className="font-display text-[22px] leading-[1.35] max-w-md tracking-[-0.01em]" style={{ color: "var(--ink-100)" }}>
              {flipped ? card.a : card.q}
            </div>
          </div>
        </button>
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={prev}
            className="font-mono text-[10px] uppercase tracking-[0.14em] px-3 py-2 rounded-lg hover:bg-[var(--bg2)] transition-colors"
            style={{ color: "var(--ink-300)" }}
          >
            ← prev
          </button>
          <div className="flex gap-1.5">
            {cards.map((_, j) => (
              <div
                key={j}
                className="rounded-full transition-all duration-200"
                style={{
                  width: j === i ? 12 : 4,
                  height: 4,
                  background: j === i ? "var(--accent)" : "var(--line)",
                }}
              />
            ))}
          </div>
          <button
            onClick={next}
            className="font-mono text-[10px] uppercase tracking-[0.14em] px-3 py-2 rounded-lg hover:bg-[var(--bg2)] transition-colors"
            style={{ color: "var(--ink-300)" }}
          >
            next →
          </button>
        </div>
      </div>
    </div>
  );
}

function BloomThread({ item, onEdit }: { item: V2Item; onEdit?: (patch: Partial<V2Item>) => void }) {
  const [reply, setReply] = useState("");
  const [fetchedMessages, setFetchedMessages] = useState<{ role: string; text: string }[] | null>(null);

  useEffect(() => {
    if (!item.sourceChatId) return;
    let cancelled = false;
    fetch(`/api/chats/${encodeURIComponent(item.sourceChatId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then(data => {
         if (cancelled) return;
         if (Array.isArray(data?.messages)) {
           setFetchedMessages(data.messages.map((m: { role: string; content: string }) => ({
             role: m.role,
             text: m.content
           })));
         }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.sourceChatId]);

  const messages = fetchedMessages || item.messages || [];
  return (
    <div className="flex flex-col h-full bg-[var(--paper)]">
      <div className="px-8 pt-7 pb-3" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-5 h-5 rounded flex items-center justify-center"
            style={{ background: "rgba(14,142,232,0.08)" }}
          >
            <Icon name="thread" size={11} style={{ color: "#0e8ee8" }} />
          </div>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "#0e8ee8" }}>
            Thread
          </span>
          <span className="font-mono text-[9.5px]" style={{ color: "var(--ink-400)" }}>
            · {messages.length} messages
          </span>
        </div>
        <h1 className="font-display text-[26px] leading-[1.1] tracking-[-0.01em]" style={{ color: "var(--ink-100)" }}>{item.title}</h1>
      </div>
      <div className="px-8 py-5 overflow-y-auto sv2-slim flex-1 space-y-3">
        {messages.length === 0 && (
          <div className="text-[13px] italic flex items-center justify-center h-full opacity-60" style={{ color: "var(--ink-300)" }}>
            No messages yet. Send one from the bar below.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[82%] text-[13.5px] leading-[1.6] rounded-2xl px-4 py-2.5 whitespace-pre-wrap ${
                m.role === "user"
                  ? "rounded-br-sm text-white"
                  : "rounded-bl-sm"
              }`}
              style={{
                background: m.role === "user"
                  ? "linear-gradient(135deg, var(--accent), #1a9ef0)"
                  : "var(--paper-deep)",
                border: `1px solid ${m.role === "user" ? "transparent" : "var(--line)"}`,
                color: m.role === "user" ? "#fff" : "var(--ink-200)",
                boxShadow: m.role === "user" ? "0 2px 8px rgba(14,142,232,0.2)" : "none",
              }}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>
      <div className="px-8 py-4 bg-[var(--paper-deep)] border-t border-[var(--line)]">
        <div className="flex items-center gap-3 rounded-full px-4 py-2 shadow-sm transition-shadow focus-within:shadow-md"
             style={{ background: "var(--paper)", border: "1px solid var(--accent)" }}>
          <Icon name="sparkle" size={14} style={{ color: "var(--accent)" }} />
          <input
            className="flex-1 bg-transparent text-[13.5px] outline-none font-medium"
            style={{ color: "var(--ink-100)" }}
            placeholder="Reply to thread…"
            value={reply}
            onChange={e => setReply(e.target.value)}
            onKeyDown={(e) => {
               if (e.key === "Enter" && reply.trim()) {
                 onEdit?.({ messages: [...messages, { role: "user", text: reply }] as V2Item["messages"] });
                 setReply("");
               }
            }}
          />
          <button
            className="w-6 h-6 rounded-full flex items-center justify-center hover:scale-105 transition-transform"
            style={{ background: "var(--accent)", color: "#fff", boxShadow: "0 2px 6px rgba(14,142,232,0.25)" }}
            onClick={() => {
              if (reply.trim()) {
                 onEdit?.({ messages: [...messages, { role: "user", text: reply }] as V2Item["messages"] });
                 setReply("");
              }
            }}
          >
            <Icon name="arrow-rt" size={10} />
          </button>
        </div>
      </div>
    </div>
  );
}

function BloomReading({ item }: { item: V2Item; onEdit?: (patch: Partial<V2Item>) => void }) {
  const [body, setBody] = useState(item.body || item.preview || "No preview");

  useEffect(() => {
    if (!item.sourceArtifactId) return;
    let cancelled = false;
    fetch(`/api/artifacts?artifactId=${item.sourceArtifactId}`)
      .then(r => r.json())
      .then(data => {
         if (cancelled) return;
         if (data.artifact?.contentPlaintext || data.artifact?.content) {
           setBody(data.artifact.contentPlaintext || data.artifact.content);
         }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.sourceArtifactId]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-7 pb-3" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-5 h-5 rounded flex items-center justify-center"
            style={{ background: "rgba(107,95,82,0.08)" }}
          >
            <Icon name="reading" size={11} style={{ color: "#6b5f52" }} />
          </div>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "#6b5f52" }}>
            Reading
          </span>
          <span className="font-mono text-[9.5px]" style={{ color: "var(--ink-400)" }}>
            · {(item.meta?.pages as number) || "—"} pages
          </span>
        </div>
        <h1 className="font-display text-[26px] leading-[1.08] tracking-[-0.02em]" style={{ color: "var(--ink-100)" }}>{item.title}</h1>
      </div>
      <div className="px-8 pb-7 flex-1 flex flex-col pt-4">
        <div
          className="flex-1 rounded-xl flex items-center justify-center p-6"
          style={{ border: "1px solid var(--line)", background: "var(--paper-deep)" }}
        >
          <div className="text-center w-full h-full flex flex-col">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] mb-3 font-medium" style={{ color: "var(--ink-400)" }}>
              Preview
            </div>
            <div className="flex-1 overflow-y-auto sv2-slim text-[13.5px] leading-[1.68] text-left font-display" style={{ color: "var(--ink-200)" }}>{body}</div>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          {["✦ summarize", "make flashcards", "quiz me"].map((label) => (
            <button
              key={label}
              className="flex-1 py-2.5 rounded-lg text-[10.5px] font-mono uppercase tracking-[0.1em] font-medium hover:bg-[var(--bg2)] transition-colors"
              style={{ border: "1px solid var(--line)", color: "var(--ink-300)" }}
              onClick={() => {
                 window.dispatchEvent(new CustomEvent("workspace:context-action", {
                   detail: { action: "chat", text: `${label} from ${item.title}`, itemId: item.sourceId }
                 }));
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function BloomSchedule({ item, onEdit }: { item: V2Item; onEdit?: (patch: Partial<V2Item>) => void }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(item.body || item.preview || "");

  useEffect(() => {
    if (!item.sourcePlannerItemId) return;
    let cancelled = false;
    fetch(`/api/planner-items?plannerItemId=${item.sourcePlannerItemId}`)
      .then(r => r.json())
      .then(data => {
         if (cancelled) return;
         if (data.plannerItem?.description) {
           setBody(data.plannerItem.description);
         }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.sourcePlannerItemId]);

  return (
    <div className="flex flex-col h-full p-8">
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-5 h-5 rounded flex items-center justify-center"
          style={{ background: "rgba(224,81,55,0.08)" }}
        >
          <Icon name="schedule" size={11} style={{ color: "#e05137" }} />
        </div>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "#e05137" }}>
          Planner · Task
        </span>
      </div>
      <h1 className="font-display text-[28px] leading-[1.1] tracking-[-0.02em]" style={{ color: "var(--ink-100)" }}>{item.title}</h1>
      <div className="mt-3 h-[2px] w-14 rounded-full" style={{ background: "rgba(224,81,55,0.25)" }} />

      {editing ? (
         <textarea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => { setEditing(false); onEdit?.({ body }); }}
            className="w-full mt-5 bg-transparent outline-none text-[13.5px] leading-[1.68] resize-none font-display"
            style={{ color: "var(--ink-200)", minHeight: "150px" }}
         />
      ) : (
         <div onDoubleClick={() => setEditing(true)} className="mt-5 text-[13.5px] cursor-text whitespace-pre-wrap leading-[1.68]" style={{ color: "var(--ink-200)" }}>{body}</div>
      )}
    </div>
  );
}

function BloomVisual({ item }: { item: V2Item; onEdit?: (patch: Partial<V2Item>) => void }) {
  const [body, setBody] = useState(item.body || item.preview || "");

  useEffect(() => {
    if (!item.sourceArtifactId) return;
    let cancelled = false;
    fetch(`/api/artifacts?artifactId=${item.sourceArtifactId}`)
      .then(r => r.json())
      .then(data => {
         if (cancelled) return;
         if (data.artifact?.contentPlaintext || data.artifact?.content) {
           setBody(data.artifact.contentPlaintext || data.artifact.content);
         }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.sourceArtifactId]);

  return (
    <div className="flex flex-col h-full bg-[var(--bg2)]">
      <div className="px-7 pt-6 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 rounded flex items-center justify-center"
            style={{ background: "rgba(182,118,22,0.1)" }}
          >
            <Icon name="layers" size={11} style={{ color: "#b67616" }} />
          </div>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "#b67616" }}>
            Visual Artifact
          </span>
        </div>
        <div className="flex gap-1.5">
          <button className="px-2.5 py-1 rounded-md border font-mono text-[9px] uppercase tracking-[0.1em] hover:bg-[var(--line)] transition-colors"
                  style={{ borderColor: "var(--line)", color: "var(--ink-300)" }}>Export</button>
          <button className="px-2.5 py-1 rounded-md border font-mono text-[9px] uppercase tracking-[0.1em] hover:bg-[var(--line)] transition-colors"
                  style={{ borderColor: "var(--line)", color: "var(--ink-300)" }}>Fullscreen</button>
        </div>
      </div>
      <div className="px-7">
        <h1 className="font-display text-[22px] leading-[1.1] tracking-[-0.01em] font-medium" style={{ color: "var(--ink-100)" }}>{item.title}</h1>
      </div>
      <div className="mt-4 mx-7 mb-6 flex-1 bg-[var(--paper)] rounded-xl flex items-center justify-center shadow-inner overflow-hidden border border-[var(--line)] relative group">
        <div className="absolute inset-0 sv2-grid opacity-30 pointer-events-none" />
        <div className="text-[14px] max-w-lg text-center leading-[1.7] whitespace-pre-wrap max-h-full overflow-y-auto sv2-slim z-10" style={{ color: "var(--ink-200)" }}>{body}</div>

        <div className="absolute bottom-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
          <button className="w-8 h-8 rounded-md bg-[var(--paper)] border border-[var(--line)] shadow-sm flex items-center justify-center hover:text-[var(--accent)] transition-colors">
            <Icon name="zoom-in" size={14} />
          </button>
          <button className="w-8 h-8 rounded-md bg-[var(--paper)] border border-[var(--line)] shadow-sm flex items-center justify-center hover:text-[var(--accent)] transition-colors">
            <Icon name="zoom-out" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function BloomBody({ item, onEdit }: { item: V2Item; onEdit?: (patch: Partial<V2Item>) => void }) {
  switch (item.kind) {
    case "essay": return <BloomEssay item={item} onEdit={onEdit} />;
    case "pset": return <BloomPset item={item} onEdit={onEdit} />;
    case "flashcards": return <BloomFlashcards item={item} onEdit={onEdit} />;
    case "thread": return <BloomThread item={item} onEdit={onEdit} />;
    case "reading": return <BloomReading item={item} onEdit={onEdit} />;
    case "schedule": return <BloomSchedule item={item} onEdit={onEdit} />;
    case "visual": return <BloomVisual item={item} onEdit={onEdit} />;
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
  inSet?: boolean;
  primaryInSet?: boolean;
  aiTouched?: boolean;
  onClick?: (item: V2Item, e: React.MouseEvent) => void;
  onDoubleClick?: (item: V2Item) => void;
  onPin?: (item: V2Item) => void;
  onClose?: () => void;
  onEdit?: (patch: Partial<V2Item>) => void;
  bloomPrimary?: boolean;
};

export function ItemCard({
  item, mode, focused, selected, inSet, primaryInSet, aiTouched,
  onClick, onDoubleClick, onPin, onClose, onEdit, bloomPrimary,
}: ItemProps) {
  const bloomed = mode === "bloom";
  const meta = KIND_META[item.kind];
  const className = useMemo(() => {
    if (bloomed) {
      return `sv2-bloom-surface sv2-bloom-in ${bloomPrimary ? "primary" : ""} ${aiTouched ? "sv2-ai-touched" : ""} w-full h-full relative`;
    }
    return `sv2-field ${focused ? "focused" : ""} ${selected ? "selected" : ""} ${inSet ? "in-set" : ""} ${primaryInSet ? "primary-in-set" : ""} ${aiTouched ? "sv2-ai-touched" : ""} w-full h-full relative`;
  }, [bloomed, bloomPrimary, focused, selected, inSet, primaryInSet, aiTouched]);

  return (
    <div
      data-bloom-editor={bloomed ? "1" : undefined}
      className={className}
      onClick={(e) => { e.stopPropagation(); onClick?.(item, e); }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(item); }}
    >
      {/* Color accent line at top */}
      <div
        className="absolute top-0 left-0 right-0 h-[2.5px] transition-opacity duration-200"
        style={{ background: item.color, opacity: focused || bloomed ? 1 : 0.3 }}
      />
      {/* Animated accent line at bottom on hover */}
      {!bloomed && (
        <div
          className="sv2-card-accent-line"
          style={{ background: meta.tone, opacity: 0.4 }}
        />
      )}
      {mode === "glance" && <GlanceLayer item={item} />}
      {mode === "touch" && <TouchLayer item={item} onEdit={onEdit} />}
      {mode === "bloom" && <BloomBody item={item} onEdit={onEdit} />}
      {bloomed && (
        <div className="absolute top-4 right-4 flex gap-1.5 z-10">
          <button
            onClick={(e) => { e.stopPropagation(); onPin?.(item); }}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-105"
            style={{
              border: "1px solid var(--line)",
              background: "rgba(251,250,246,0.92)",
              color: "var(--ink-400)",
              backdropFilter: "blur(8px)",
              boxShadow: "0 2px 8px rgba(26,21,16,0.08)",
            }}
            title="Pin to tray"
          >
            <Icon name="pin" size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose?.(); }}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-105"
            style={{
              border: "1px solid var(--line)",
              background: "rgba(251,250,246,0.92)",
              color: "var(--ink-400)",
              backdropFilter: "blur(8px)",
              boxShadow: "0 2px 8px rgba(26,21,16,0.08)",
            }}
            title="Collapse (Esc)"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
