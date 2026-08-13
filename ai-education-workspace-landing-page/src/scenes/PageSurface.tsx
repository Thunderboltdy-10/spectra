import { forwardRef } from "react";
import { Avatar, Chip, Cite, Icon, Logo, PEOPLE, PrismMark } from "../components/kit";
import { DotMeter } from "./Undercurrent";

/* ------------------------------------------------------------------
   The landing page itself, as a working surface inside Verso.
   Same components, same type, same dot language — one design system.
-------------------------------------------------------------------*/

const S = 560;

export const PageSurface = forwardRef<HTMLDivElement, { width?: number }>(function PageSurface(
  { width = S },
  ref
) {
  const k = width / S;
  const px = (n: number) => n * k;
  return (
    <div
      ref={ref}
      style={{
        width,
        background: "linear-gradient(180deg, #0d100e 0%, #0a0c0a 40%, #0c0e0c 100%)",
      }}
    >
      {/* 1 — hero */}
      <section
        data-block="hero"
        style={{ padding: `${px(26)}px ${px(30)}px ${px(34)}px`, position: "relative", overflow: "hidden" }}
      >
        <div
          className="dots dots-amber dots-mask-fade"
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.32,
            ["--dot-s" as string]: `${px(7)}px`,
            ["--dot-r" as string]: "0.85px",
          }}
        />
        <div style={{ position: "relative" }}>
          <div className="flex items-center justify-between">
            <Logo size={px(13)} />
            <span className="label" style={{ fontSize: px(8) }}>
              Start a workspace
            </span>
          </div>
          <div className="mt-6 flex items-start gap-4">
            <div style={{ flex: 1 }}>
              <span className="label" style={{ fontSize: px(8) }}>
                Workspace · study, research, teaching
              </span>
              <h1
                className="display"
                style={{ fontSize: px(38), lineHeight: 1, margin: `${px(10)}px 0 0`, maxWidth: "16ch" }}
              >
                Research, drafts and deadlines that stay{" "}
                <em>in conversation with each other.</em>
              </h1>
              <p style={{ fontSize: px(11), lineHeight: 1.6, color: "var(--paper-3)", marginTop: px(12), maxWidth: px(330) }}>
                Fellows work inside the document with you, keep every source attached to the claim it supports, and
                carry a project's context from the first question to the final submission.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <span
                  style={{
                    background: "linear-gradient(180deg,#f0d1a2,#ddab68)",
                    color: "#17150f",
                    fontSize: px(10),
                    padding: `${px(6)}px ${px(11)}px`,
                    borderRadius: 5,
                    fontWeight: 500,
                  }}
                >
                  Start a workspace
                </span>
                <span
                  style={{
                    border: "1px solid var(--line-strong)",
                    fontSize: px(10),
                    padding: `${px(6)}px ${px(11)}px`,
                    borderRadius: 5,
                    color: "var(--paper-2)",
                  }}
                >
                  See a seminar in Verso
                </span>
              </div>
            </div>
            <PrismMark size={px(74)} state="work" style={{ marginTop: px(18), opacity: 0.95 }} />
          </div>
        </div>
      </section>

      {/* 2 — the fellow card that was dragged in */}
      <section data-block="card" style={{ padding: `0 ${px(30)}px ${px(30)}px` }}>
        <div className="surface" style={{ padding: px(13) }}>
          <div className="flex items-center gap-2">
            <Avatar initials={PEOPLE.fellow.initials} color={PEOPLE.fellow.color} />
            <span style={{ fontSize: px(10.5) }}>Source Fellow</span>
            <span className="label" style={{ fontSize: px(8) }}>
              HIST 342 · Water &amp; Empire
            </span>
          </div>
          <p style={{ fontSize: px(11), lineHeight: 1.55, color: "var(--paper-2)", marginTop: px(8) }}>
            Willcocks dates the first perennial canal to 1885 <Cite>Willcocks 1899, p. 112</Cite>; the gauge table in
            your reader says 1887. I've flagged the discrepancy in your notes.
          </p>
        </div>
      </section>

      {/* 3 — prism result */}
      <section data-block="result" style={{ padding: `0 ${px(30)}px ${px(30)}px` }}>
        <div className="flex items-center gap-2" style={{ marginBottom: px(12) }}>
          <PrismMark size={px(13)} state="done" />
          <span className="label" style={{ fontSize: px(8) }}>
            Five fragments in · one approach out
          </span>
        </div>
        <div className="surface" style={{ padding: px(15) }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: px(20), margin: 0, lineHeight: 1.1 }}>
            Essay 2 — an approach you can argue
          </h3>
          <p style={{ fontFamily: "var(--font-display)", fontSize: px(13), lineHeight: 1.5, color: "var(--paper-2)", marginTop: px(8) }}>
            Two systems, one argument: read Egypt's perennial canals against the Punjab canal colonies. Both
            administered water in order to administer people — but only one of them said so.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Chip tone="amber">counter-argument from Essay 1 feedback</Chip>
            <Chip tone="sea">clash resolved</Chip>
            <Chip>6 of 14 sources load-bearing</Chip>
          </div>
        </div>
      </section>

      {/* 4 — connected surfaces */}
      <section data-block="connected" style={{ padding: `0 ${px(30)}px ${px(30)}px` }}>
        <div className="flex gap-2">
          {[
            { i: "thread", t: "Scope & sources", b: "Compare Egypt with Punjab. Two systems, one argument." },
            { i: "doc", t: "Essay 2 · draft", b: "Case II · Punjab canal colonies, 1885–1901" },
            { i: "plan", t: "Week of 10 Nov", b: "Draft I moved to Mon — the lab report keeps Wednesday." },
          ].map((s2) => (
            <div key={s2.i} className="surface" style={{ flex: 1, padding: px(11) }}>
              <div className="flex items-center gap-1.5" style={{ color: "var(--paper-3)" }}>
                <Icon name={s2.i} size={px(10)} />
                <span className="label" style={{ fontSize: px(7.5) }}>
                  {s2.t}
                </span>
              </div>
              <p style={{ fontSize: px(9.5), lineHeight: 1.5, color: "var(--paper-2)", marginTop: px(7) }}>{s2.b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 5 — collaboration */}
      <section data-block="collab" style={{ padding: `0 ${px(30)}px ${px(30)}px` }}>
        <div className="surface" style={{ padding: px(15) }}>
          <div className="flex items-center gap-2" style={{ marginBottom: px(9) }}>
            <Icon name="doc" size={px(10)} />
            <span className="label" style={{ fontSize: px(8) }}>
              Essay 2 · §2 Chronology
            </span>
            <span className="ml-auto flex -space-x-1">
              <Avatar initials={PEOPLE.naima.initials} color={PEOPLE.naima.color} />
              <Avatar initials={PEOPLE.maya.initials} color={PEOPLE.maya.color} />
            </span>
          </div>
          <p style={{ fontFamily: "var(--font-display)", fontSize: px(13.5), lineHeight: 1.65, color: "var(--paper)" }}>
            The corvée was abolished in 1892, seven years after the first perennial canal — which means the canal freed
            no one; it changed who was compelled, and how.<span className="ins">
              {" "}
              <Cite>Barak 2013, p. 74</Cite>
            </span>
          </p>
        </div>
      </section>

      {/* 6 — undercurrent still */}
      <section data-block="under" style={{ padding: `0 ${px(30)}px ${px(30)}px` }}>
        <div className="surface" style={{ padding: px(13) }}>
          <div className="flex items-center gap-2">
            <PrismMark size={px(14)} state="work" />
            <span className="label" style={{ fontSize: px(8) }}>
              Undercurrent
            </span>
            <span className="meta ml-auto" style={{ fontSize: px(8.5) }}>
              3 running · 1 waiting
            </span>
          </div>
          <div className="mt-3 flex flex-col" style={{ gap: px(8) }}>
            {[
              ["Reading 14 items on corvée labour", 0.84, "dots-amber", "running"],
              ["1885 confirmed · flagged in §2", 1, "dots-sea", "delivered"],
            ].map(([t, v, c, w]) => (
              <div key={t as string} className="flex items-center gap-2">
                <span style={{ fontSize: px(10), color: "var(--paper-2)", flex: 1 }} className="truncate">
                  {t as string}
                </span>
                <DotMeter value={v as number} tone={c as string} width={px(54)} />
                <span className="meta" style={{ fontSize: px(8), width: px(46) }}>
                  {w as string}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7 — closing */}
      <section
        data-block="cta"
        style={{
          padding: `${px(30)}px ${px(30)}px ${px(36)}px`,
          position: "relative",
          overflow: "hidden",
          borderTop: "1px solid var(--line)",
        }}
      >
        <div
          className="dots dots-sea"
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.18,
            ["--dot-s" as string]: `${px(7)}px`,
            ["--dot-r" as string]: "0.8px",
            WebkitMaskImage: "linear-gradient(180deg, #000, transparent)",
            maskImage: "linear-gradient(180deg, #000, transparent)",
          }}
        />
        <div style={{ position: "relative" }}>
          <h2 className="display" style={{ fontSize: px(34), lineHeight: 1.02, margin: 0, maxWidth: "14ch" }}>
            Bring one project. <em>Verso keeps the thread.</em>
          </h2>
          <p style={{ fontSize: px(11), lineHeight: 1.6, color: "var(--paper-3)", marginTop: px(12), maxWidth: px(340) }}>
            Free for students. Department plans include shared Throughlines, seminar spaces and source policy controls.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <a
              href="#top"
              style={{
                background: "linear-gradient(180deg,#f0d1a2,#ddab68)",
                color: "#17150f",
                fontSize: px(10.5),
                padding: `${px(7)}px ${px(13)}px`,
                borderRadius: 5,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Start a workspace
            </a>
            <span
              style={{
                border: "1px solid var(--line-strong)",
                fontSize: px(10.5),
                padding: `${px(7)}px ${px(13)}px`,
                borderRadius: 5,
                color: "var(--paper-2)",
              }}
            >
              Book a department walkthrough
            </span>
          </div>
          <div className="mt-6 flex items-center gap-3" style={{ opacity: 0.5 }}>
            <Logo size={px(11)} muted />
            <span className="meta" style={{ fontSize: px(8) }}>
              © Verso · Built in Verso
            </span>
          </div>
        </div>
      </section>
    </div>
  );
});
