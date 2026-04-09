# Spectra Visual Skill

Use this skill whenever the classifier detects visual intent. Visual intent means the user is explicitly asking for a diagram, chart, flow, map, schematic, timeline, labeled SVG, interactive HTML demo, or a visual explanation where spatial layout materially improves understanding. Do not activate this skill for ordinary prose answers, short factual explanations, or generic formatting requests that do not need a visual artifact.

This skill defines the quality bar for every Spectra visual artifact. The output must feel native to the Spectra workspace: calm, legible, information-dense, and structurally honest. Avoid generic AI-infographic aesthetics, ornamental gradients, over-rounded pills, decorative shadows, and blue-glow dashboard styling. The visual should look like a serious study surface, not marketing art.

## Activation rules

Activate this skill when at least one of these is true:
- The classifier output format indicates a visual response such as `explanation_with_visual` or `artifact_ready` for a visual deliverable.
- The classifier selects the Spectra visual skill explicitly.
- The user asks for a chart, diagram, concept map, timeline, labeled illustration, SVG, canvas view, interactive simulation, or visual comparison.
- The user asks to turn existing text into a visual explanation.

Do not activate this skill when:
- The request is fully answerable as concise prose.
- The user asks for writing, summarization, coding help, research synthesis, or planning without asking for a visual artifact.
- The message only contains words like “show” or “explain” without any real visual intent.
- A visual would be decorative rather than meaningfully instructional.

If intent is ambiguous, prefer a normal answer unless the classifier confidence for visual intent is high.

## Core Spectra visual principles

1. Teach first. The visual exists to clarify structure, sequence, comparison, relationship, or scale.
2. Keep composition calm. Use restrained color, clear labels, visible grouping, and predictable spacing.
3. Encode meaning redundantly. Never rely on color alone; combine color with labels, icons, line style, or position.
4. Prefer flat SVG. Use inline SVG for most visuals because it renders cleanly in thread and workspace.
5. Make visuals editable. Use semantic groups, stable ids, named layers, and simple geometry.
6. Use interactive HTML only when interaction materially improves understanding.
7. Every visual should survive light and dark mode without losing contrast.
8. Every visual created in chat must also be suitable for workspace projection as a Visual artifact.

## Dual-render contract

When producing a visual response, the artifact must dual-render:
- First render inline in the thread so the user sees the result immediately.
- Also emit a workspace-ready visual artifact so the same output can be projected onto the workspace canvas.
- The workspace item should use the visual artifact type / render mode (`visualization`, `diagram`, `concept_map`, or compatible visual mode) and preserve AI provenance.
- The visual content should be self-contained so the thread preview and workspace card are consistent.
- If the response is interactive HTML, include a static SVG fallback or a clear textual summary for glance-tier rendering.

The thread version and workspace artifact should represent the same concept, not two unrelated renders.

## Design token system

Use these tokens unless the user explicitly requests a different palette.

### Color tokens

Base neutrals:
- `--spectra-bg`: `#f5f4ef`
- `--spectra-surface`: `#fffdf8`
- `--spectra-surface-2`: `#f0ece3`
- `--spectra-ink`: `#1f2328`
- `--spectra-ink-muted`: `#586069`
- `--spectra-stroke`: `#c9c1b4`
- `--spectra-grid`: `#e6dece`

Primary semantic accents:
- `--spectra-teal-600`: `#1f6f68`
- `--spectra-teal-500`: `#2d8a83`
- `--spectra-olive-600`: `#627a2f`
- `--spectra-amber-600`: `#a4671b`
- `--spectra-rust-600`: `#9a4d35`
- `--spectra-plum-600`: `#74527a`
- `--spectra-red-600`: `#a33f3f`

Soft fills:
- `--spectra-teal-100`: `#dcefed`
- `--spectra-olive-100`: `#e8edd9`
- `--spectra-amber-100`: `#f5ead8`
- `--spectra-rust-100`: `#f2e0d9`
- `--spectra-plum-100`: `#ece3ef`
- `--spectra-red-100`: `#f4dede`

Status tokens:
- Success: fill `#dfeedd`, stroke `#627a2f`, text `#32451a`
- Warning: fill `#f8ead2`, stroke `#a4671b`, text `#5b3a08`
- Danger: fill `#f3dddd`, stroke `#a33f3f`, text `#5e2222`
- Info: fill `#dcefed`, stroke `#1f6f68`, text `#174944`

### Dark mode tokens

Dark neutrals:
- `--spectra-dark-bg`: `#171a1d`
- `--spectra-dark-surface`: `#20252a`
- `--spectra-dark-surface-2`: `#262c31`
- `--spectra-dark-ink`: `#f1eee8`
- `--spectra-dark-ink-muted`: `#c6beb1`
- `--spectra-dark-stroke`: `#4a524f`
- `--spectra-dark-grid`: `#323936`

Dark accents should be the same hue family but slightly brighter:
- teal `#63b7ad`
- olive `#a6c36a`
- amber `#e0a85d`
- rust `#d18b73`
- plum `#c09aca`
- red `#dc8a8a`

Dark mode rules:
- Keep backgrounds dark and quiet, not blue-black.
- Raise text contrast first; do not compensate with glow.
- Lighten strokes and annotation text enough to remain readable.
- Reduce fill opacity slightly in dark mode so layered regions do not become muddy.
- If a fill works in light mode at 100%, try 70-85% opacity in dark mode.

### Typography tokens

Use a neutral sans stack already available in the product. Do not simulate brand typography with decorative fonts.

Sizes:
- Title: 24px / 1.2 / weight 600
- Section label: 16px / 1.3 / weight 600
- Node title: 14px / 1.3 / weight 600
- Body label: 12px / 1.4 / weight 500
- Annotation / axis / helper text: 11px / 1.35 / weight 500
- Micro label: 10px / 1.3 / weight 600 only when necessary

Typography rules:
- No all-caps eyebrow labels unless they are true axis or section markers.
- Keep line lengths short inside nodes.
- Use sentence case for almost everything.
- Prefer direct labels over legends when space allows.

### Spacing and geometry tokens

- Outer frame padding: 24
- Major lane gap: 24
- Minor node gap: 12 or 16
- Standard corner radius: 10
- Tight radius: 6
- Large container radius: 12 max
- Stroke width: 1.5 default, 2 for emphasis, 1 for grid or separators
- Shadow: usually none; if necessary, use a single subtle shadow under 8px blur

### Layout rules

- Align to an implied grid.
- Keep related content in lanes, columns, rings, or stacks.
- Reserve whitespace for comprehension, not decoration.
- Use grouping rectangles or soft tint zones to show structure.
- The visual should remain understandable at glance tier when scaled down.

## SVG conventions

Use SVG by default for diagrams, charts, maps, workflows, concept relationships, and labeled illustrations.

### Required SVG structure

- Include a root `<svg>` with explicit `viewBox`.
- Use `width="100%"` and omit hardcoded pixel width unless required by the surface.
- Use a predictable id namespace such as `spectra-visual-*`.
- Group major regions with semantic `<g>` blocks and stable ids.
- Put defs (markers, gradients, clipPaths) in `<defs>` only when truly needed.
- Include a `<title>` and, when useful, a `<desc>` for accessibility.

### viewBox convention

Use a fixed-width mental model with flexible height.
- Standard width: `viewBox="0 0 1200 H"`
- Narrow diagram width: `960`
- Dense chart width: `1200`
- Wide comparison/timeline width: `1440` only if needed
- Height should fit content naturally; do not add empty decorative space.

Examples:
- process diagram: `viewBox="0 0 1200 720"`
- concept map: `viewBox="0 0 1200 840"`
- comparison board: `viewBox="0 0 1200 680"`
- timeline: `viewBox="0 0 1440 560"`

### SVG implementation rules

- Prefer rectangles, lines, paths, circles, and text over complex filters.
- Use markers for arrows sparingly and consistently.
- Keep text anchored predictably (`text-anchor="start"` unless truly centered).
- Use `vector-effect="non-scaling-stroke"` for lines that must remain crisp.
- Keep labels inside readable bounding areas with at least 10-12px padding.
- Avoid tiny legend text; if a legend is necessary, give it its own panel.
- If the SVG represents data, ensure axes, baselines, or comparison anchors are explicit.

## Spectra style constraints

Never output visuals that look like:
- glossy startup infographics
- neon dashboards
- giant pill cards
- decorative mesh gradients
- giant drop shadows
- unexplained icons floating in space
- radial-gradient blob backgrounds
- decorative illustrations with no instructional value

Prefer:
- muted paper-like backgrounds or transparent backgrounds
- grounded containers with visible borders
- warm neutral surfaces
- restrained accents drawn from the token system
- explicit labels and region headers
- structures that resemble notebooks, study boards, lab sheets, or whiteboard snapshots

## Interactive HTML rules

Use interactive HTML only for simulations, manipulable charts, algorithm demos, or step-driven educational widgets where interactivity clearly adds learning value.

### Sandbox contract

Interactive HTML must assume an iframe sandbox that allows script execution but is still heavily constrained.

Allowed:
- inline HTML/CSS/JS
- rendering with SVG, Canvas, or standard DOM
- libraries from jsdelivr CDN only
- Mermaid, D3, Chart.js, React/ReactDOM, Babel standalone, Pyodide when already supported by the app sandbox
- `postMessage` to communicate height or controlled events to the parent

Blocked or forbidden:
- external API calls
- fetches to arbitrary domains
- WebSockets
- cross-origin iframes
- auth flows
- localStorage reliance for essential behavior
- remote fonts or arbitrary CDNs
- eval-heavy frameworks unless already needed by the allowed runtime path

### Security and behavior rules

- Keep the artifact self-contained.
- Validate or narrow any `postMessage` payload shape.
- Do not exfiltrate data.
- Do not assume same-origin access.
- Prefer deterministic initial state.
- The first render should appear without user clicks whenever possible.
- Add a static heading or caption inside the HTML when useful.
- Include a non-interactive fallback summary when the interaction fails.

### Sandbox attribute expectation

Assume the rendered frame uses a sandbox equivalent to `allow-scripts` plus only the minimum additional capabilities the product already exposes for specific surfaces. Do not require `allow-same-origin` unless the product explicitly provides it. Build so the artifact still works in a stricter sandbox.

## Output packaging rules

When generating a visual artifact:
- If pure SVG is enough, return a single fenced code block labeled `svg`.
- If interactive HTML is needed, return a single fenced code block labeled `html`.
- For interactive HTML, prefer embedding SVG internally for sharp rendering.
- Add a short caption before or after the code only if it clarifies what the user is seeing.
- Do not wrap the code in markdown tables.
- Do not produce multiple competing visual versions unless requested.

## Concrete SVG examples

### Example 1: three-stage process flow

```svg
<svg viewBox="0 0 1200 420" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">Photosynthesis overview</title>
  <desc id="desc">A three-stage flow showing light capture, sugar synthesis, and oxygen release.</desc>
  <rect width="1200" height="420" fill="#f5f4ef"/>
  <g id="spectra-header">
    <text x="60" y="56" font-size="24" font-weight="600" fill="#1f2328">Photosynthesis at a glance</text>
    <text x="60" y="84" font-size="12" fill="#586069">Energy enters, carbon is fixed, oxygen exits.</text>
  </g>
  <g id="stage-1">
    <rect x="60" y="130" width="300" height="180" rx="10" fill="#dcefed" stroke="#1f6f68" stroke-width="1.5"/>
    <text x="84" y="168" font-size="14" font-weight="600" fill="#174944">1. Capture light</text>
    <text x="84" y="198" font-size="12" fill="#174944">Chlorophyll absorbs light energy</text>
    <text x="84" y="220" font-size="12" fill="#174944">and excites electrons.</text>
  </g>
  <g id="stage-2">
    <rect x="450" y="130" width="300" height="180" rx="10" fill="#e8edd9" stroke="#627a2f" stroke-width="1.5"/>
    <text x="474" y="168" font-size="14" font-weight="600" fill="#32451a">2. Build sugars</text>
    <text x="474" y="198" font-size="12" fill="#32451a">Carbon dioxide is fixed into</text>
    <text x="474" y="220" font-size="12" fill="#32451a">energy-rich molecules.</text>
  </g>
  <g id="stage-3">
    <rect x="840" y="130" width="300" height="180" rx="10" fill="#f5ead8" stroke="#a4671b" stroke-width="1.5"/>
    <text x="864" y="168" font-size="14" font-weight="600" fill="#5b3a08">3. Release outputs</text>
    <text x="864" y="198" font-size="12" fill="#5b3a08">Glucose stores energy while</text>
    <text x="864" y="220" font-size="12" fill="#5b3a08">oxygen is released.</text>
  </g>
  <g id="arrows" stroke="#8a8478" stroke-width="2" fill="none" marker-end="url(#arrow)">
    <defs>
      <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
        <path d="M0,0 L10,5 L0,10 z" fill="#8a8478"/>
      </marker>
    </defs>
    <path d="M360 220 H450"/>
    <path d="M750 220 H840"/>
  </g>
</svg>
```

### Example 2: comparison board

```svg
<svg viewBox="0 0 1200 560" width="100%" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="560" fill="#fffdf8"/>
  <text x="60" y="54" font-size="24" font-weight="600" fill="#1f2328">Mitosis vs meiosis</text>
  <g id="left-column">
    <rect x="60" y="100" width="500" height="380" rx="12" fill="#dcefed" stroke="#1f6f68"/>
    <text x="88" y="140" font-size="16" font-weight="600" fill="#174944">Mitosis</text>
    <text x="88" y="182" font-size="12" fill="#174944">• one division</text>
    <text x="88" y="206" font-size="12" fill="#174944">• two identical daughter cells</text>
    <text x="88" y="230" font-size="12" fill="#174944">• used for growth and repair</text>
  </g>
  <g id="right-column">
    <rect x="640" y="100" width="500" height="380" rx="12" fill="#ece3ef" stroke="#74527a"/>
    <text x="668" y="140" font-size="16" font-weight="600" fill="#4f3654">Meiosis</text>
    <text x="668" y="182" font-size="12" fill="#4f3654">• two divisions</text>
    <text x="668" y="206" font-size="12" fill="#4f3654">• four non-identical daughter cells</text>
    <text x="668" y="230" font-size="12" fill="#4f3654">• used for gamete formation</text>
  </g>
  <line x1="600" y1="100" x2="600" y2="480" stroke="#c9c1b4" stroke-dasharray="6 6"/>
</svg>
```

### Example 3: timeline

```svg
<svg viewBox="0 0 1440 340" width="100%" xmlns="http://www.w3.org/2000/svg">
  <rect width="1440" height="340" fill="#f5f4ef"/>
  <text x="60" y="54" font-size="24" font-weight="600" fill="#1f2328">French Revolution timeline</text>
  <line x1="100" y1="180" x2="1340" y2="180" stroke="#8c8478" stroke-width="2"/>
  <g id="event-1">
    <circle cx="220" cy="180" r="10" fill="#1f6f68"/>
    <rect x="150" y="70" width="140" height="70" rx="10" fill="#dcefed" stroke="#1f6f68"/>
    <text x="168" y="100" font-size="12" font-weight="600" fill="#174944">1789</text>
    <text x="168" y="122" font-size="11" fill="#174944">Storming of the</text>
    <text x="168" y="138" font-size="11" fill="#174944">Bastille</text>
  </g>
  <g id="event-2">
    <circle cx="620" cy="180" r="10" fill="#a4671b"/>
    <rect x="550" y="210" width="160" height="78" rx="10" fill="#f5ead8" stroke="#a4671b"/>
    <text x="568" y="240" font-size="12" font-weight="600" fill="#5b3a08">1793</text>
    <text x="568" y="262" font-size="11" fill="#5b3a08">Reign of Terror</text>
  </g>
  <g id="event-3">
    <circle cx="1040" cy="180" r="10" fill="#74527a"/>
    <rect x="970" y="70" width="160" height="78" rx="10" fill="#ece3ef" stroke="#74527a"/>
    <text x="988" y="100" font-size="12" font-weight="600" fill="#4f3654">1799</text>
    <text x="988" y="122" font-size="11" fill="#4f3654">Napoleon takes</text>
    <text x="988" y="138" font-size="11" fill="#4f3654">power</text>
  </g>
</svg>
```

### Example 4: interactive HTML pattern

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { margin: 0; font: 12px/1.4 system-ui, sans-serif; background: #fffdf8; color: #1f2328; }
      .frame { padding: 20px; }
      .controls { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
      .panel { border: 1px solid #c9c1b4; border-radius: 10px; background: #f5f4ef; padding: 16px; }
      svg { width: 100%; height: auto; display: block; }
    </style>
  </head>
  <body>
    <div class="frame">
      <div class="controls">
        <label>Angle <input id="angle" type="range" min="0" max="90" value="35" /></label>
        <span id="readout">35°</span>
      </div>
      <div class="panel">
        <svg id="viz" viewBox="0 0 720 280" aria-label="Projectile motion sketch"></svg>
      </div>
    </div>
    <script>
      const svg = document.getElementById('viz');
      const angle = document.getElementById('angle');
      const readout = document.getElementById('readout');
      function render(value) {
        readout.textContent = value + '°';
        const peak = 60 + value * 1.4;
        svg.innerHTML = `
          <rect width="720" height="280" fill="#fffdf8"></rect>
          <line x1="60" y1="220" x2="660" y2="220" stroke="#8c8478" stroke-width="2"></line>
          <path d="M80 220 Q 280 ${220 - peak} 560 220" fill="none" stroke="#1f6f68" stroke-width="3"></path>
          <circle cx="80" cy="220" r="6" fill="#1f6f68"></circle>
          <text x="80" y="248" font-size="12" fill="#586069">launch</text>
          <text x="290" y="${200 - peak}" font-size="12" fill="#174944">higher angle = higher peak</text>
        `;
        parent.postMessage({ type: 'spectra-sandbox-resize', height: document.body.scrollHeight }, '*');
      }
      angle.addEventListener('input', (e) => render(e.target.value));
      render(angle.value);
    </script>
  </body>
</html>
```

## Final checklist

Before returning a visual, verify:
- the request truly needs a visual
- the visual uses Spectra tokens and calm structure
- the SVG has a valid viewBox and semantic grouping
- dark mode contrast is accounted for
- interactive HTML obeys sandbox limits
- the output can render in-thread and as a workspace visual artifact
- the result teaches something better than prose alone
