"use client";

import { useMemo, useState, useEffect } from "react";
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
        <div className="mt-6 p-3 rounded-lg flex items-start gap-2"
             style={{ background: "rgba(237,233,227,0.6)", border: "1px solid var(--line)" }}>
          <Icon name="sparkle" size={14} className="mt-0.5" style={{ color: "var(--accent)" }} />
          <div className="flex-1">
            <div className="text-[12px]" style={{ color: "var(--ink-100)", fontWeight: 600 }}>AI suggestion</div>
            <div className="text-[12px] mt-0.5" style={{ color: "var(--ink-200)" }}>
              Consider strengthening your thesis with a concrete image in paragraph one.
            </div>
          </div>
          <button 
             className="text-[10px] font-mono uppercase tracking-[0.1em]"
             style={{ color: "var(--ink-300)" }}
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

function BloomFlashcards({ item }: { item: V2Item; onEdit?: (patch: Partial<V2Item>) => void }) {
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

function BloomThread({ item, onEdit }: { item: V2Item; onEdit?: (patch: Partial<V2Item>) => void }) {
  const [reply, setReply] = useState("");
  const [fetchedMessages, setFetchedMessages] = useState<{ role: string; text: string }[] | null>(null);
  
  // Fetch real thread messages if we have a sourceChatId
  useEffect(() => {
    if (!item.sourceChatId) return;
    let cancelled = false;
    fetch(`/api/chat?chatId=${item.sourceChatId}`)
      .then(r => r.json())
      .then(data => {
         if (cancelled) return;
         if (data.chat?.messages) {
           setFetchedMessages(data.chat.messages.map((m: { role: string; content: string }) => ({
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
      <div className="px-8 pt-8 pb-3 border-b border-[var(--line)] bg-[var(--bg2)]/30 backdrop-blur">
        <div className="flex items-center gap-2">
          <Icon name="thread" size={14} style={{ color: "#0e8ee8" }} />
          <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>
            <span style={{ color: "#0e8ee8" }}>Thread</span> · {messages.length} messages
          </div>
        </div>
        <h1 className="font-display text-[26px] leading-[1.1] mt-3 font-medium" style={{ color: "var(--ink-100)" }}>{item.title}</h1>
      </div>
      <div className="px-8 py-6 overflow-y-auto sv2-slim flex-1 space-y-4">
        {messages.length === 0 && (
          <div className="text-[13px] italic flex items-center justify-center h-full opacity-60" style={{ color: "var(--ink-300)" }}>
            No messages yet. Send one from the bar below.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] text-[13.5px] leading-[1.6] rounded-2xl px-4 py-2.5 whitespace-pre-wrap shadow-sm ${
                m.role === "user" 
                  ? "rounded-br-sm text-white" 
                  : "rounded-bl-sm"
              }`}
              style={{
                background: m.role === "user" ? "var(--accent)" : "var(--paper)",
                border: `1px solid ${m.role === "user" ? "transparent" : "var(--line)"}`,
                color: m.role === "user" ? "#fff" : "var(--ink-200)",
              }}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>
      <div className="px-8 py-4 bg-[var(--bg2)]/30 backdrop-blur border-t border-[var(--line)]">
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
            className="w-6 h-6 rounded-full flex items-center justify-center bg-[var(--accent)] text-white hover:scale-105 transition-transform"
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
      <div className="px-7 pt-6 pb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>
          Reading · {(item.meta?.pages as number) || "—"} pages
        </div>
        <h1 className="font-display text-[26px] leading-[1.08] mt-2" style={{ color: "var(--ink-100)" }}>{item.title}</h1>
      </div>
      <div className="px-7 pb-6 flex-1 flex flex-col">
        <div className="flex-1 sv2-placeholder rounded-lg flex items-center justify-center p-4"
             style={{ border: "1px solid var(--line)", background: "var(--paper)" }}>
          <div className="text-center w-full h-full flex flex-col">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] mb-3" style={{ color: "var(--ink-400)" }}>
              Preview
            </div>
            <div className="flex-1 overflow-y-auto sv2-slim text-[13px] leading-relaxed text-left font-display" style={{ color: "var(--ink-200)" }}>{body}</div>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          {["✦ summarize", "make flashcards", "quiz me"].map((label) => (
            <button key={label} className="flex-1 py-2 rounded-lg text-[11px] font-mono uppercase tracking-[0.1em] hover:bg-[var(--bg2)] transition-colors"
                    style={{ border: "1px solid var(--line)", color: "var(--ink-300)" }}
                    onClick={() => {
                       // dispatch action to command bar equivalent 
                       window.dispatchEvent(new CustomEvent("workspace:context-action", {
                         detail: { action: "chat", text: `${label} from ${item.title}`, itemId: item.sourceId }
                       }));
                    }}>
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
    <div className="flex flex-col h-full p-7">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--coral)" }}>Planner · Task</div>
      <h1 className="font-display text-[28px] leading-[1.1] mt-2" style={{ color: "var(--ink-100)" }}>{item.title}</h1>
      
      {editing ? (
         <textarea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => { setEditing(false); onEdit?.({ body }); }}
            className="w-full mt-4 bg-transparent outline-none text-[13px] leading-relaxed resize-none font-display"
            style={{ color: "var(--ink-200)", minHeight: "150px" }}
         />
      ) : (
         <div onDoubleClick={() => setEditing(true)} className="mt-4 text-[13px] cursor-text whitespace-pre-wrap leading-relaxed" style={{ color: "var(--ink-200)" }}>{body}</div>
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
      <div className="px-6 pt-5 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="layers" size={14} style={{ color: "var(--ink-400)" }} />
          <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>Visual Artifact</div>
        </div>
        <div className="flex gap-2">
          <button className="px-2 py-1 rounded border border-[var(--line)] font-mono text-[9px] uppercase hover:bg-[var(--line)] transition-colors">Export</button>
          <button className="px-2 py-1 rounded border border-[var(--line)] font-mono text-[9px] uppercase hover:bg-[var(--line)] transition-colors">Fullscreen</button>
        </div>
      </div>
      <div className="px-6">
        <h1 className="font-display text-[22px] leading-[1.1] font-medium" style={{ color: "var(--ink-100)" }}>{item.title}</h1>
      </div>
      <div className="mt-4 mx-6 mb-6 flex-1 bg-[var(--paper)] rounded-xl flex items-center justify-center shadow-inner overflow-hidden border border-[var(--line)] relative group">
        <div className="absolute inset-0 sv2-grid opacity-30 pointer-events-none" />
        <div className="text-[14px] max-w-lg text-center leading-relaxed whitespace-pre-wrap max-h-full overflow-y-auto sv2-slim z-10" style={{ color: "var(--ink-200)" }}>{body}</div>
        
        <div className="absolute bottom-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
          <button className="w-8 h-8 rounded bg-[var(--paper)] border border-[var(--line)] shadow-sm flex items-center justify-center hover:text-[var(--accent)] transition-colors"><Icon name="zoom-in" size={14} /></button>
          <button className="w-8 h-8 rounded bg-[var(--paper)] border border-[var(--line)] shadow-sm flex items-center justify-center hover:text-[var(--accent)] transition-colors"><Icon name="zoom-out" size={14} /></button>
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
