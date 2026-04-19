// Sample data — student-focused: Biology midterm, Calc problem sets, English essay, Spanish flashcards
// World coordinates are absolute canvas positions. Workspaces are spatial regions.

const WORKSPACES = [
  {
    id: 'atlas',
    name: 'Atlas',
    subtitle: 'All courses',
    glyph: '◎',
    color: '#6b5f52',
    cx: 0, cy: 0, w: 2800, h: 1800,
    items: [],
  },
  {
    id: 'bio',
    name: 'Biology 201',
    subtitle: 'Midterm · Thu',
    glyph: '◐',
    color: '#20b8b2',
    cx: -900, cy: -400, w: 1400, h: 900,
  },
  {
    id: 'calc',
    name: 'Calculus II',
    subtitle: 'Pset 7 due',
    glyph: '∫',
    color: '#0e8ee8',
    cx: 800, cy: -450, w: 1400, h: 900,
  },
  {
    id: 'eng',
    name: 'English Lit',
    subtitle: 'Essay draft',
    glyph: '¶',
    color: '#b67616',
    cx: -900, cy: 550, w: 1400, h: 900,
  },
  {
    id: 'span',
    name: 'Spanish',
    subtitle: 'Vocab cycle',
    glyph: 'ñ',
    color: '#e05137',
    cx: 800, cy: 550, w: 1400, h: 900,
  },
];

// Items — each has x/y in world coords, relative to workspace center roughly.
// itemType: note | essay | pset | flashcards | thread | reading | lab | schedule
const ITEMS = [
  // ─── BIOLOGY ────────────────────────────────────────────────
  {
    id: 'bio-1', workspaceId: 'bio', kind: 'note',
    title: 'Cell Respiration — summary',
    preview: 'Glycolysis → Krebs → ETC. Net ATP: 36–38 per glucose. Key regulators: PFK (allosteric), citrate synthase. Rate-limiting = PFK.',
    body: `# Cellular Respiration

Three stages compress glucose into ATP:

**1. Glycolysis** — cytoplasm. 2 ATP in, 4 out, 2 NADH. Ends at pyruvate.
**2. Krebs cycle** — mitochondrial matrix. Pyruvate → Acetyl-CoA → cycle. Yields 2 ATP, 6 NADH, 2 FADH₂ per glucose.
**3. ETC** — inner membrane. NADH/FADH₂ dump electrons; proton gradient drives ATP synthase. ~34 ATP.

## Regulators I always forget
- **PFK** — inhibited by ATP/citrate, activated by AMP. Rate-limiting.
- **Pyruvate dehydrogenase** — phosphorylation inactivates it.
- **Citrate synthase** — inhibited by ATP.

## Likely exam trap
"Why is ETC oxygen-dependent even though O₂ isn't in the equations until the end?" — because without the terminal electron acceptor, NADH can't unload and the whole thing stalls. Classic.`,
    x: -1280, y: -620, w: 320, h: 260, color: '#20b8b2', updated: '2h ago',
    meta: { words: 186, linked: ['bio-3'] },
  },
  {
    id: 'bio-2', workspaceId: 'bio', kind: 'flashcards',
    title: 'Midterm flashcards',
    preview: '38 cards · 62% mastered',
    cards: [
      { q: 'Net ATP from glycolysis alone?', a: '2 ATP (4 made, 2 used)' },
      { q: 'Where does the Krebs cycle occur?', a: 'Mitochondrial matrix' },
      { q: 'Rate-limiting enzyme of glycolysis?', a: 'Phosphofructokinase (PFK-1)' },
      { q: 'Terminal electron acceptor in aerobic respiration?', a: 'Oxygen (O₂) → water' },
      { q: 'What does FADH₂ yield in ETC?', a: '~1.5 ATP' },
    ],
    x: -880, y: -620, w: 320, h: 260, color: '#20b8b2', updated: '1h ago',
    meta: { count: 38, mastered: 24 },
  },
  {
    id: 'bio-3', workspaceId: 'bio', kind: 'thread',
    title: 'Why is Oxygen the final acceptor?',
    preview: 'Discussion with tutor about electron affinity & why O₂ is uniquely suited.',
    messages: [
      { role: 'user', text: 'If NADH gives up electrons at Complex I, why can\'t something else accept them at the end?' },
      { role: 'ai', text: 'Three reasons: O₂ has very high electron affinity (reduces the full redox gradient), it\'s plentiful in our atmosphere, and its reduction product (water) is benign. Facultative anaerobes swap in nitrate or sulfate but get far less ATP — the gradient is shallower.' },
      { role: 'user', text: 'So the ATP yield difference is purely thermodynamic?' },
      { role: 'ai', text: 'Exactly. The amount of free energy released when electrons fall from NADH to the acceptor sets the proton-pumping budget.' },
    ],
    x: -1280, y: -260, w: 320, h: 240, color: '#20b8b2', updated: '25m ago',
    meta: { msgs: 8 },
  },
  {
    id: 'bio-4', workspaceId: 'bio', kind: 'reading',
    title: 'Ch. 9 — Energy Metabolism',
    preview: 'Textbook reading · 42 pages · highlighted',
    x: -880, y: -260, w: 320, h: 180, color: '#20b8b2', updated: 'yesterday',
    meta: { pages: 42, highlights: 17 },
  },
  {
    id: 'bio-5', workspaceId: 'bio', kind: 'schedule',
    title: 'Midterm — Thu 9:30am',
    preview: 'Room 204 · 90 minutes · 40 MCQ + 2 short answer',
    x: -1080, y: -60, w: 280, h: 140, color: '#20b8b2', updated: '',
    meta: { when: 'Thu', time: '9:30' },
  },

  // ─── CALCULUS ─────────────────────────────────────────────
  {
    id: 'calc-1', workspaceId: 'calc', kind: 'pset',
    title: 'Pset 7 — Integration by Parts',
    preview: '∫ x·eˣ dx, ∫ ln(x) dx, ∫ arctan(x) dx + 5 more',
    problems: [
      { q: '∫ x·eˣ dx', a: 'xeˣ − eˣ + C', status: 'done' },
      { q: '∫ ln(x) dx', a: 'x·ln(x) − x + C', status: 'done' },
      { q: '∫ arctan(x) dx', a: 'x·arctan(x) − ½ln(1+x²) + C', status: 'stuck' },
      { q: '∫ x²·sin(x) dx', a: '', status: 'todo' },
      { q: '∫ eˣ·cos(x) dx', a: '', status: 'todo' },
    ],
    x: 420, y: -620, w: 340, h: 280, color: '#0e8ee8', updated: '10m ago',
    meta: { done: 2, total: 8 },
  },
  {
    id: 'calc-2', workspaceId: 'calc', kind: 'note',
    title: 'LIATE mnemonic',
    preview: 'Pick u in the order: Logarithm, Inverse trig, Algebraic, Trig, Exponential',
    body: `# LIATE — picking u in integration by parts

**L**ogarithmic · ln(x), log(x)
**I**nverse trig · arctan(x), arcsin(x)
**A**lgebraic · x, x², polynomials
**T**rigonometric · sin(x), cos(x)
**E**xponential · eˣ, 2ˣ

Whichever comes first in LIATE, that's your u. It works because things earlier in the list become *simpler* when differentiated; things later become simpler when integrated. So du·v is easier than u·dv.

Counter-example worth memorizing: ∫ eˣ·cos(x) dx — LIATE says u=cos(x), but actually you need to do IBP twice and recover the original.`,
    x: 820, y: -620, w: 320, h: 200, color: '#0e8ee8', updated: '30m ago',
    meta: { words: 92 },
  },
  {
    id: 'calc-3', workspaceId: 'calc', kind: 'thread',
    title: 'Arctan integral walkthrough',
    preview: 'Need help with ∫ arctan(x) dx — tried LIATE, got stuck at ∫ x/(1+x²) dx',
    messages: [
      { role: 'user', text: 'I picked u=arctan(x), dv=dx. Got x·arctan(x) − ∫ x/(1+x²) dx. Now stuck.' },
      { role: 'ai', text: 'That last integral is a substitution, not parts. Let w = 1+x², then dw = 2x dx, so x dx = dw/2. The integral becomes ½∫ dw/w = ½ ln|1+x²|.' },
      { role: 'user', text: 'So final answer is x·arctan(x) − ½ln(1+x²) + C?' },
      { role: 'ai', text: 'Exactly. That\'s the full answer.' },
    ],
    x: 420, y: -280, w: 320, h: 240, color: '#0e8ee8', updated: '5m ago',
    meta: { msgs: 6 },
  },
  {
    id: 'calc-4', workspaceId: 'calc', kind: 'reading',
    title: 'Stewart §7.1 — IBP',
    preview: 'Textbook · 14 pages · 4 worked examples',
    x: 820, y: -340, w: 320, h: 160, color: '#0e8ee8', updated: '2 days ago',
    meta: { pages: 14 },
  },
  {
    id: 'calc-5', workspaceId: 'calc', kind: 'schedule',
    title: 'Pset due Fri 11:59pm',
    preview: 'Submit on Gradescope · 8 problems',
    x: 620, y: -60, w: 260, h: 120, color: '#0e8ee8', updated: '',
    meta: { when: 'Fri', time: '23:59' },
  },

  // ─── ENGLISH ──────────────────────────────────────────────
  {
    id: 'eng-1', workspaceId: 'eng', kind: 'essay',
    title: 'Great Gatsby — Green Light motif',
    preview: 'Working draft · Thesis: the green light is not hope but unavailability — Gatsby worships its distance.',
    body: `# The Green Light as Monument to Distance

## Draft I · 872 words

Gatsby doesn't want Daisy. He wants the version of Daisy that exists on the far side of the bay — the one who is perpetually **unreachable**, her dock marked by a single green lamp he has never touched. When Fitzgerald writes that Gatsby "stretched out his arms toward the dark water in a curious way," he is not describing longing for a woman. He is describing a man reaching for the condition of reaching itself.

The novel enacts this distinction structurally. Every proximity to Daisy — the reunion in Nick's cottage, the afternoon at the Buchanans', the final confrontation at the Plaza — flattens her. She becomes ordinary. Her voice, famously "full of money," is recognizable only once Gatsby is close enough to hear it plainly; the enchantment required distance.

So when the green light vanishes in chapter five — "his count of enchanted objects had diminished by one" — the light has not been achieved. It has been *destroyed*.`,
    x: -1280, y: 320, w: 380, h: 280, color: '#b67616', updated: 'just now',
    meta: { words: 872, target: 1500 },
  },
  {
    id: 'eng-2', workspaceId: 'eng', kind: 'reading',
    title: 'Gatsby — annotated copy',
    preview: 'PDF · 182 pages · 34 highlights',
    x: -820, y: 320, w: 300, h: 180, color: '#b67616', updated: '3 days ago',
    meta: { pages: 182, highlights: 34 },
  },
  {
    id: 'eng-3', workspaceId: 'eng', kind: 'thread',
    title: 'Counterargument brainstorm',
    preview: 'What if Daisy is more than symbol? Is Gatsby\'s worship actually love?',
    messages: [
      { role: 'user', text: 'My prof wants a counterargument. What if Gatsby genuinely loves Daisy and the green light is just longing, not fetishization of distance?' },
      { role: 'ai', text: 'Strongest version: Nick\'s narration is unreliable and romanticizes Gatsby\'s pathology as love. If we trust the scenes with Daisy (not Nick\'s framing), Gatsby notices specifics about her — her voice, her hand. That\'s attention, not symbol-worship.' },
      { role: 'user', text: 'Can you give me three textual anchors for that?' },
      { role: 'ai', text: 'Ch. 5 "he revalued everything in his house according to the measure of response it drew from her well-loved eyes" — this is specific, present-tense attention. Ch. 7 his insistence on the hotel suite — bodily reality over symbol. Ch. 8 Gatsby\'s wait outside her window — a lover, not a worshipper.' },
    ],
    x: -1280, y: 680, w: 320, h: 220, color: '#b67616', updated: '45m ago',
    meta: { msgs: 10 },
  },
  {
    id: 'eng-4', workspaceId: 'eng', kind: 'note',
    title: 'Outline + feedback from Prof.',
    preview: 'Intro → body 1 (distance) → body 2 (proximity = collapse) → counter → conclusion',
    x: -820, y: 580, w: 320, h: 200, color: '#b67616', updated: 'yesterday',
    meta: { words: 240 },
  },
  {
    id: 'eng-5', workspaceId: 'eng', kind: 'schedule',
    title: 'Draft due Mon 9am',
    preview: '1500 words · double-spaced · MLA',
    x: -1060, y: 900, w: 260, h: 120, color: '#b67616', updated: '',
    meta: { when: 'Mon', time: '9:00' },
  },

  // ─── SPANISH ──────────────────────────────────────────────
  {
    id: 'span-1', workspaceId: 'span', kind: 'flashcards',
    title: 'Subjunctive triggers',
    preview: '24 cards · WEIRDO mnemonic',
    cards: [
      { q: 'What does WEIRDO stand for?', a: 'Wishes, Emotion, Impersonal, Requests, Doubt, Ought (recommendations)' },
      { q: 'Trigger: "Espero que..."', a: 'Wishes → subjunctive. "Espero que vengas."' },
      { q: 'Trigger: "No creo que..."', a: 'Doubt → subjunctive. "No creo que sea verdad."' },
      { q: 'Indicative or subjunctive: "Sé que tiene razón"?', a: 'Indicative — certainty, no WEIRDO trigger.' },
    ],
    x: 420, y: 320, w: 320, h: 260, color: '#e05137', updated: '12m ago',
    meta: { count: 24, mastered: 15 },
  },
  {
    id: 'span-2', workspaceId: 'span', kind: 'note',
    title: 'Irregular preterite stems',
    preview: 'tener→tuv, estar→estuv, poder→pud, poner→pus, saber→sup…',
    body: `# Irregular preterite stems — memorize

| Verb | Stem | Example |
|------|------|---------|
| tener | tuv- | tuve, tuviste |
| estar | estuv- | estuve |
| poder | pud- | pude |
| poner | pus- | puse |
| saber | sup- | supe |
| venir | vin- | vine |
| hacer | hic- (hiz- 3s) | hice, hizo |
| querer | quis- | quise |
| decir | dij- | dije |
| traer | traj- | traje |

Endings are always: -e, -iste, -o, -imos, -isteis, -ieron
(with -eron for dij-/traj- — drops the i)`,
    x: 820, y: 320, w: 320, h: 220, color: '#e05137', updated: '1h ago',
    meta: { words: 84 },
  },
  {
    id: 'span-3', workspaceId: 'span', kind: 'thread',
    title: 'Ser vs. Estar with adjectives',
    preview: 'When "ser rico" vs "estar rico" — meaning actually changes',
    messages: [
      { role: 'user', text: 'I keep mixing up ser/estar with adjectives like rico, listo, aburrido.' },
      { role: 'ai', text: 'These three are infamous because the meaning *changes*:\n• ser rico = to be rich\n• estar rico = to be delicious (or hot)\n• ser listo = to be clever\n• estar listo = to be ready\n• ser aburrido = to be boring (as a person)\n• estar aburrido = to be bored' },
    ],
    x: 420, y: 660, w: 320, h: 220, color: '#e05137', updated: '2h ago',
    meta: { msgs: 4 },
  },
  {
    id: 'span-4', workspaceId: 'span', kind: 'reading',
    title: 'Conjugation tables',
    preview: 'Reference · all regular + irregular',
    x: 820, y: 600, w: 300, h: 160, color: '#e05137', updated: '',
    meta: { pages: 8 },
  },
  {
    id: 'span-5', workspaceId: 'span', kind: 'schedule',
    title: 'Oral quiz Wed',
    preview: '10 min · prompts on preterite + subjunctive',
    x: 600, y: 940, w: 260, h: 120, color: '#e05137', updated: '',
    meta: { when: 'Wed', time: '14:00' },
  },
];

// Topic clusters (for Topic view)
const TOPICS = {
  bio: [
    { id: 'bio-metabolism', label: 'Metabolism', ids: ['bio-1','bio-3','bio-4'] },
    { id: 'bio-practice',   label: 'Practice & review', ids: ['bio-2'] },
    { id: 'bio-logistics',  label: 'Logistics', ids: ['bio-5'] },
  ],
  calc: [
    { id: 'calc-ibp', label: 'Integration by parts', ids: ['calc-1','calc-2','calc-3','calc-4'] },
    { id: 'calc-logistics', label: 'Logistics', ids: ['calc-5'] },
  ],
  eng: [
    { id: 'eng-thesis', label: 'Thesis & draft', ids: ['eng-1','eng-4'] },
    { id: 'eng-source', label: 'Source material', ids: ['eng-2','eng-3'] },
    { id: 'eng-logistics', label: 'Logistics', ids: ['eng-5'] },
  ],
  span: [
    { id: 'span-grammar', label: 'Grammar', ids: ['span-2','span-3','span-4'] },
    { id: 'span-vocab',   label: 'Vocab cycle', ids: ['span-1'] },
    { id: 'span-logistics', label: 'Logistics', ids: ['span-5'] },
  ],
};

// Quick-start prompts — each spawns a scaffold on empty or on request
const QUICK_STARTS = [
  { id: 'exam-prep',   title: 'Plan my exam week',        blurb: 'Creates a study plan across workspaces with focus blocks.', tone: '#0e8ee8' },
  { id: 'cram',        title: 'Cram session for tomorrow',blurb: 'Generates flashcards + 90-min plan from your weakest items.', tone: '#e05137' },
  { id: 'essay',       title: 'Help me finish this essay',blurb: 'Outline, counter-arg, and a streamlined draft review.', tone: '#b67616' },
  { id: 'holiday',     title: 'Plan a 3-day break',       blurb: 'Time-blocks study around a break respecting deadlines.', tone: '#20b8b2' },
  { id: 'research',    title: 'Start a research project', blurb: 'Sets up source library, outline, and citation scratch.', tone: '#148f5d' },
];

const WIDGETS_INITIAL = [];

window.SPECTRA_DATA = { WORKSPACES, ITEMS, TOPICS, QUICK_STARTS, WIDGETS_INITIAL };
