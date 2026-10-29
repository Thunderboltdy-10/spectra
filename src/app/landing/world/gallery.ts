import { sequentialIdFactory } from "@/features/spectra/ai/harness/authoring/shared";
import { whiteboardFromSpec } from "@/features/spectra/ai/harness/authoring/whiteboard";
import type { SpectraArtifact } from "@/features/spectra/data/api";
import { DEADLINES, ZONE } from "./school";
import { dayAt } from "./story";
import { CLASSES, WORKS, type ClassKey } from "./works";

/*
 * One of every kind of work, for the page's tour of the editors. The ones the
 * story already has (notes, slides, the lab sheet, the quiz, the cards) are
 * the story's own; the board, the simulation and the task are made here, in
 * the formats Spectra itself writes them in.
 */

function made(id: string, blueprintKey: SpectraArtifact["blueprintKey"], title: string, classKey: ClassKey, content: unknown, summary: string): SpectraArtifact {
  const place = CLASSES[classKey];
  const updatedAt = dayAt(0, 19, 30);
  return {
    _id: id,
    blueprintKey,
    title,
    content,
    summary,
    tags: [],
    status: "active",
    createdAt: updatedAt - 86_400_000,
    updatedAt,
    placements: [{ workspaceId: place.workspaceId, workspaceTitle: place.title, nodeId: `node-${id}` }],
    placementStatus: "workspace",
    ownership: "owned",
    accessLevel: "modify",
    capabilities: ["read", "modify", "share", "delete", "use", "comment"],
  };
}

const KREBS = whiteboardFromSpec(
  {
    nodes: [
      { key: "acetyl", text: "Acetyl CoA (2C) joins in", color: "gold" },
      { key: "citrate", text: "Citrate (6C)", color: "mint" },
      { key: "five", text: "5C compound: CO2 and NADH out", color: "cyan" },
      { key: "four", text: "4C compound: CO2, NADH and ATP out", color: "violet" },
      { key: "oxalo", text: "Oxaloacetate (4C), ready again", color: "coral" },
    ],
    edges: [
      { from: "acetyl", to: "citrate", label: "joins" },
      { from: "citrate", to: "five", label: "loses CO2" },
      { from: "five", to: "four", label: "loses CO2" },
      { from: "four", to: "oxalo", label: "FADH2, NADH" },
      { from: "oxalo", to: "citrate", label: "takes the next acetyl" },
    ],
    layout: "cycle",
  },
  sequentialIdFactory(),
);

/* A simulation, not a script: how fast an enzyme works as the water warms, with the temperature to drag. */
const ENZYME_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root{color-scheme:light;font-family:system-ui,sans-serif;color:#1f1d1a}
body{margin:0;padding:18px 22px;background:#fbfaf7}
h1{font:600 15px/1.3 system-ui;margin:0 0 2px}
p{margin:0 0 12px;font-size:12.5px;color:#5d5a55}
.row{display:flex;align-items:center;gap:12px;font-size:12.5px;margin-top:8px}
input{flex:1;accent-color:#5b6be0}
b{font-variant-numeric:tabular-nums}
</style></head><body>
<h1>Catalase activity and temperature</h1>
<p>Bubbles of oxygen per minute from hydrogen peroxide. Drag the water bath.</p>
<svg id="c" viewBox="0 0 520 220" width="100%"></svg>
<div class="row">Water bath <input id="t" type="range" min="5" max="70" value="30"><b id="v">30 °C</b></div>
<script>
const svg=document.getElementById('c'),t=document.getElementById('t'),v=document.getElementById('v');
const rate=x=>Math.max(0,Math.exp(-((x-37)**2)/260)*(x<37?1:Math.max(0,1-(x-37)/28)))*100;
const X=x=>40+(x-5)/65*460,Y=y=>190-y*1.6;
function draw(){const T=+t.value;v.textContent=T+' °C';let d='';for(let x=5;x<=70;x+=1)d+=(x==5?'M':'L')+X(x)+' '+Y(rate(x));
let s='<line x1="40" y1="190" x2="505" y2="190" stroke="#cfcac2"/><line x1="40" y1="20" x2="40" y2="190" stroke="#cfcac2"/>';
for(const g of [10,20,30,40,50,60,70])s+='<text x="'+X(g)+'" y="206" font-size="10" fill="#8a857e" text-anchor="middle">'+g+'</text>';
s+='<path d="'+d+'" fill="none" stroke="#5b6be0" stroke-width="2.4" stroke-linecap="round"/>';
s+='<line x1="'+X(T)+'" y1="20" x2="'+X(T)+'" y2="190" stroke="#e8853a" stroke-dasharray="3 4"/>';
s+='<circle cx="'+X(T)+'" cy="'+Y(rate(T))+'" r="6" fill="#e8853a"/>';
s+='<text x="'+(X(T)+10)+'" y="'+(Y(rate(T))-10)+'" font-size="12" fill="#1f1d1a">'+Math.round(rate(T))+' per min</text>';
for(let i=0;i<Math.round(rate(T)/12);i++)s+='<circle cx="'+(470+Math.sin(i*2.1)*14)+'" cy="'+(40+i*13)+'" r="'+(3+i%3)+'" fill="none" stroke="#4f9fe6" opacity=".7"><animate attributeName="cy" values="'+(170-i*6)+';30" dur="'+(2.4-rate(T)/60)+'s" repeatCount="indefinite"/></circle>';
svg.innerHTML=s}
t.oninput=draw;draw();
</script></body></html>`;

const ENZYME = {
  runtime: "browser",
  entryFileId: "index",
  files: [{ id: "index", path: "index.html", language: "html", source: ENZYME_PAGE }],
  visualisation: { enabled: true, title: "Catalase activity", description: "How temperature changes an enzyme's rate.", openMode: "preview" },
  preview: { autoRun: true },
  networkPolicy: { mode: "none" },
};

const TASK = {
  taskTitle: DEADLINES.sourceAnalysis.title,
  description: "Two sources from the pack. Value and limitations of each, 600 words.",
  dueAt: DEADLINES.sourceAnalysis.startAt,
  status: "doing",
  priority: "high",
  estimateMinutes: 135,
  subtasks: [
    { id: "s1", title: "Read the Enabling Act text and Wels's speech", done: true },
    { id: "s2", title: "Origin, purpose and content of each", done: true },
    { id: "s3", title: "One value and one limitation per source", done: false },
    { id: "s4", title: "Write it up and check the word count", done: false },
  ],
  reminders: [{ id: "r1", minutesBefore: 1440, enabled: true }],
  timezone: ZONE,
  recurrence: { frequency: "none", interval: 1, weekdays: [], exceptions: [] },
  progressNote: "Halfway. The value of Wels's speech is clear; its limitation needs a second look.",
};

export const GALLERY = {
  document: WORKS.ia,
  presentation: WORKS.deck,
  sheets: WORKS.sheet,
  quiz: WORKS.quiz,
  flashcard_deck: WORKS.cards,
  whiteboard: made("work-board", "whiteboard", "The Krebs cycle", "biology", KREBS, "One turn of the cycle, from acetyl CoA back to oxaloacetate."),
  code: made("work-enzyme", "code", "Catalase and temperature", "biology", ENZYME, "A simulation of enzyme activity to drag through."),
  planner_task: made("work-task", "planner_task", DEADLINES.sourceAnalysis.title, "history", TASK, "Due with two steps to go."),
} satisfies Record<string, SpectraArtifact>;

export type GalleryKey = keyof typeof GALLERY;
