import type { ReactNode } from "react";

/*
 * What is behind each of Henry's tabs at 21:41: the school portal, a cloud
 * folder with the essay in four versions, an inbox, the group chat, a chatbot
 * that has never seen his notes, a scan, a timer. Drawn small and plainly, as
 * other people's apps; none of them is Spectra.
 */

export type GlueKind = "portal" | "files" | "inbox" | "group" | "bot" | "docx" | "week" | "flash" | "slides" | "pdf" | "rubric" | "timer";

export const ESSAYS = ["essay.docx", "essay_final.docx", "essay_FINAL_actual.docx", "essay_FINAL_actual (2).docx"];

function Page({ kind, children }: { kind: GlueKind; children: ReactNode }) {
  return (
    <div className="gp" data-kind={kind}>
      {children}
    </div>
  );
}

function Portal() {
  const rows = [
    { title: "Unit test: cell respiration", cls: "Biology SL", due: "Fri", tone: "soon" },
    { title: "Problem set 4: sequences and series", cls: "Maths AA SL", due: "Fri", tone: "soon" },
    { title: "Source analysis (draft)", cls: "History HL", due: "Overdue", tone: "late" },
    { title: "Paper 2 practice essay", cls: "English A", due: "Tue", tone: "" },
    { title: "CAS reflection 3", cls: "CAS", due: "Missing", tone: "late" },
    { title: "Oral practice: la tecnología", cls: "Spanish B", due: "Wed", tone: "" },
  ];
  return (
    <Page kind="portal">
      <div className="gp-portal-bar">
        <strong>School portal</strong>
        <span>Classes</span>
        <span data-on>Tasks</span>
        <span>Calendar</span>
        <span>Files</span>
      </div>
      <div className="gp-portal-body">
        <p className="gp-title">Upcoming tasks</p>
        <ul className="gp-portal-rows">
          {rows.map((row) => (
            <li key={row.title}>
              <span className="gp-portal-check" aria-hidden />
              <span className="gp-portal-name">
                {row.title}
                <small>{row.cls}</small>
              </span>
              <span className="gp-portal-due" data-tone={row.tone || undefined}>
                {row.due}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Page>
  );
}

function Files({ essays }: { essays: number }) {
  const others = [
    { name: "ch7_respiration_scan.pdf", kind: "pdf" },
    { name: "rubric_v3_USE_THIS.pdf", kind: "pdf" },
    { name: "Untitled document", kind: "doc" },
    { name: "Untitled document (1)", kind: "doc" },
    { name: "IMG_4471.HEIC", kind: "img" },
    { name: "notes friday (copy).docx", kind: "doc" },
  ];
  return (
    <Page kind="files">
      <div className="gp-files-side">
        <strong>Cloud files</strong>
        <span>My files</span>
        <span data-on>School stuff</span>
        <span>School stuff (old)</span>
        <span>Shared with me</span>
        <span>Trash</span>
      </div>
      <div className="gp-files-main">
        <p className="gp-title">School stuff</p>
        <ul className="gp-files-grid">
          {ESSAYS.slice(0, Math.max(1, essays)).map((name, index) => (
            <li key={name} data-new={index > 0 || undefined}>
              <span className="piece-file-icon" data-kind="doc" aria-hidden />
              <span>{name}</span>
            </li>
          ))}
          {others.map((file) => (
            <li key={file.name}>
              <span className="piece-file-icon" data-kind={file.kind} aria-hidden />
              <span>{file.name}</span>
            </li>
          ))}
        </ul>
        {essays >= ESSAYS.length ? <p className="gp-margin">which one did I send??</p> : null}
      </div>
    </Page>
  );
}

function Inbox() {
  const rows = [
    { from: "Ms Gonzalez", subject: "Re: Fwd: rubric (UPDATED, use this one)", when: "21:02", unread: true },
    { from: "CAS coordinator", subject: "Reminder: reflections are now overdue", when: "19:40", unread: true },
    { from: "Mr Okafor", subject: "Biology test moved to Friday", when: "17:15", unread: true },
    { from: "School office", subject: "Newsletter: week 9", when: "16:00" },
    { from: "Alex", subject: "Fwd: Fwd: notes??", when: "15:22", unread: true },
    { from: "Library", subject: "Your loan is due back", when: "Mon" },
  ];
  return (
    <Page kind="inbox">
      <div className="gp-inbox-side">
        <strong>Mail</strong>
        <span data-on>
          Inbox <b>214</b>
        </span>
        <span>Starred</span>
        <span>Sent</span>
        <span>Drafts</span>
      </div>
      <ul className="gp-inbox-rows">
        {rows.map((row) => (
          <li key={row.subject} data-unread={row.unread || undefined}>
            <span className="gp-inbox-from">{row.from}</span>
            <span className="gp-inbox-subject">{row.subject}</span>
            <span className="gp-inbox-when">{row.when}</span>
          </li>
        ))}
      </ul>
    </Page>
  );
}

function Group() {
  const lines = [
    { who: "Alex", text: "does anyone have the notes from friday" },
    { who: "Maya", text: "is the test thursday or friday??" },
    { who: "Alex", text: "friday i think" },
    { who: "Sam", text: "which chapter is it on" },
    { who: "Maya", text: "7 or 8" },
    { who: "Henry", text: "i have a scan of ch7 somewhere", mine: true },
  ];
  return (
    <Page kind="group">
      <div className="gp-group-head">
        <strong>DP1 Bio</strong>
        <span>23 members</span>
      </div>
      <ul className="gp-group-lines">
        {lines.map((line, index) => (
          <li key={index} data-mine={line.mine || undefined}>
            {line.mine ? null : <span className="gp-group-who">{line.who}</span>}
            <span className="gp-group-text">{line.text}</span>
          </li>
        ))}
      </ul>
    </Page>
  );
}

function Bot() {
  return (
    <Page kind="bot">
      <div className="gp-bot-thread">
        <p className="gp-bot-me">use my biology notes to quiz me</p>
        <p className="gp-bot-it">I don&rsquo;t have access to your files. Could you paste your notes here?</p>
        <p className="gp-bot-me gp-bot-paste">
          Cell respiration. Respiration releases energy from glucose as ATP. It happens in every living cell, all the time,
          not only when you breathe. Glycolysis happens in the cytoplasm and splits one glucose into two pyruvate…
        </p>
        <p className="gp-bot-it">Great notes! Here is a quiz on photosynthesis.</p>
        <p className="gp-bot-me">when is my test</p>
        <p className="gp-bot-it">I&rsquo;m not able to see your school&rsquo;s schedule.</p>
      </div>
      <div className="gp-bot-input">Message</div>
    </Page>
  );
}

function Docx() {
  return (
    <Page kind="docx">
      <div className="gp-doc-ribbon">
        <span>File</span>
        <span data-on>Home</span>
        <span>Insert</span>
        <span>Layout</span>
        <span>Review</span>
      </div>
      <div className="gp-doc-sheet">
        <p className="gp-doc-title">To what extent did the Enabling Act of 1933 give Hitler legal power?</p>
        <p>
          This investigation looks at how the Enabling Act of March 1933 changed the legal basis of Hitler&rsquo;s power.
          <mark>[ADD SECOND SOURCE HERE]</mark>
        </p>
        <p className="gp-doc-faint">Its value is that it was spoken by an opponent in the room, at the time, knowing the risk.</p>
        <p className="gp-doc-faint">Word count: 1,612 of 2,200</p>
      </div>
    </Page>
  );
}

function Week() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const blocks: Record<string, string[]> = { Mon: ["CAS meeting"], Tue: ["Maths", "Essay?"], Wed: ["Oral"], Thu: ["Bio test?", "Maths set 4"], Fri: ["Bio test", "Football"] };
  return (
    <Page kind="week">
      <div className="gp-week">
        {days.map((day) => (
          <div key={day}>
            <span className="gp-week-day">{day}</span>
            {blocks[day]!.map((block) => (
              <span key={block} className="gp-week-block">
                {block}
              </span>
            ))}
          </div>
        ))}
      </div>
    </Page>
  );
}

function Flash() {
  return (
    <Page kind="flash">
      <div className="gp-flash-card">
        <span>Card 1 of 3</span>
        <strong>Where does glycolysis happen?</strong>
        <em>Tap to flip</em>
      </div>
      <p className="gp-flash-note">Made by someone in another school, for a different syllabus.</p>
    </Page>
  );
}

function Slides() {
  return (
    <Page kind="slides">
      <div className="gp-slides">
        <div className="gp-slides-strip">
          <i data-on />
          <i />
        </div>
        <div className="gp-slides-canvas">
          <span>Click to add title</span>
          <small>Click to add subtitle</small>
        </div>
      </div>
    </Page>
  );
}

function Pdf({ title }: { title: string }) {
  return (
    <Page kind="pdf">
      <div className="gp-pdf-bar">
        {title}
        <span>1 / 14</span>
      </div>
      <div className="gp-pdf-page">
        <i />
        <i />
        <i />
        <i data-short />
        <i />
        <i />
        <i data-short />
      </div>
    </Page>
  );
}

function Timer() {
  return (
    <Page kind="timer">
      <strong className="gp-timer">25:00</strong>
      <span className="gp-timer-sub">Focus. Start when ready.</span>
    </Page>
  );
}

export function GluePage({ kind, essays }: { kind: GlueKind; essays: number }) {
  switch (kind) {
    case "portal":
      return <Portal />;
    case "files":
      return <Files essays={essays} />;
    case "inbox":
      return <Inbox />;
    case "group":
      return <Group />;
    case "bot":
      return <Bot />;
    case "docx":
      return <Docx />;
    case "week":
      return <Week />;
    case "flash":
      return <Flash />;
    case "slides":
      return <Slides />;
    case "pdf":
      return <Pdf title="ch7_respiration_scan.pdf" />;
    case "rubric":
      return <Pdf title="rubric_v3_USE_THIS.pdf" />;
    case "timer":
      return <Timer />;
  }
}
