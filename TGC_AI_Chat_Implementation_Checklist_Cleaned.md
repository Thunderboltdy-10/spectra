TGC AI Chat — Implementation Checklist (Cleaned + Non-Redundant)
Paste-ready backlog for an AI agent with repo access. Includes: cleaned list + what was changed/added.

A) Cleaned backlog (no omissions)
1) Modes, agents, and orchestration
Improve agent mode icons (remove weak emoji defaults like brain for 'no agent'; make icons more creative and consistent).
Improve agent capabilities and ensure they are auto-selected when appropriate.
Push core modes heavily: Learn, Quiz, Flashcards, Research (quality + reliability + clarity).
Improve orchestration visibility: show what is happening (which agents are deployed, why, and progress) in the right-side panel; only use agents when needed.
Improve sources handling end-to-end:
  - Web sources: clearly labeled with working URLs; if a search-capable agent is used, capture URL + metadata and render in Sources.
  - RAG sources from personal files: enforce a max files limit; show which files were used; render citations cleanly.
2) UI/UX and layout
Fix side panel resizing: opening a side panel must resize page content correctly (no squashed containers, no text overflow).
Make panel-opening UI smaller on small devices until it becomes an overlay (percentage-based breakpoint behavior).
All side panels must share identical shell styling (same close button, header, spacing), regardless of content.
If a panel is already open and the user opens another: swap content in the same container (do not stack multiple panels).
Closing the panel should fully close it (do not re-render previously opened panels).
Make layouts reactive and dynamic for different screen sizes (different layout patterns per breakpoint).
Add lots of in-product tips/help (contextual hints, recommendations, warnings like 'start a new conversation due to context length').
Improve UI for model dropdown and toggles so controls don’t feel clogged together.
Major UI redesign: reduce generic AI-ish boxiness (especially analytics). Keep clean, modern, professional with a subtle study/journal aesthetic.
3) Sidebar, command palette, onboarding
Fix K-bar: after opening and closing once, it must reopen reliably; prevent overflow in results.
Make K-bar discoverable (mention it in onboarding/help).
Create detailed onboarding (students + teachers/admins).
Sidebar: collapse page selection (too many pages). Hover to expand; improve recent search components (currently too big).
4) Chat quality and memory
Work heavily on compaction; add a manual 'Compact' button.
Automatically update the personal soul/memory without excessive token growth (since it is fed into chat context).
AI-generate chat titles from the first user message using an extremely cheap model (3–5 word summary).
5) Export and theming
Rebrand the MD download to 'Export conversation' with better formats; fix PDF export (currently blank).
Dark mode: fix white UI elements (e.g., scrollbars) that look bad.
6) Models, providers, and icons
Remove current SVGs and use LobeHub icons for providers/models (consistent backgrounds/sizes/colors).
Models page provider selection: improve search UX (search filters provider grid below, not a separate awkward dropdown at right).
Providers displayed in responsive grid; support multi-select.
Rename 'OpenRouter popular' to 'Popular'.
Remove default tags in model selector (physics/vision/etc).
Remove pricing indications in usage bar and remove 'free' wording anywhere outside prompt/response content.
7) Usage limits, budgets, and routing
When out of usage (monthly reset): route to free models only; if none, disable usage (no errors; models are unavailable/grey).
When nearing limits (e.g., 20% remaining): make most expensive models unavailable; apply progressive restrictions elsewhere too.
Hard caps derived from per-user price and margin: set one org variable in superadmin; auto-compute soft/hard thresholds and routing behavior.
8) Admin, superadmin, and collaboration
Extend admin/superadmin:
  - Superadmin hard-coded to pablo.martinez.dovale@gmail.com and extremely protected.
  - Superadmin can allocate admins; superadmin also has admin access.
  - Admins can customise school soul, manage accounts, set logo, and see school-wide analytics.
  - Admins must NOT access user chat history or user files.
  - Provide extensive onboarding for admins.
Agent collaboration: agent owner can invite collaborators from the same school to co-edit files/settings.
9) Sources UX
Improve sources UI: avoid inline [1], [2] in the message body; use clean source tags and show a working URL list at the end.
10) Storage, security, privacy, and cost control
Strict security and privacy checks across the app.
Manage Convex storage/DB carefully to avoid bandwidth/pricing issues (free tier).
Ensure admin tools cannot leak student content (no access to chats/files).
11) Bugs and deployment blockers
Fix deployment-breaking PDF/canvas/PDF.js errors (currently prevents app from working):
  - Cannot load @napi-rs/canvas; pdfjs-dist legacy build errors; DOMMatrix/ImageData/Path2D polyfill warnings; /500 page missing in server build.
Audit and fix remaining bugs end-to-end.
12) New: in-app feedback chat widget (temporary for Alpha/Beta)
Add bottom-left chat-style feedback widget site-wide.
Not account-specific for now: anyone with access can send feedback; remove/disable after Beta.
Support categories (Bug/Confusing/Feature/Safety), optional screenshot, auto-attached context (mode/page/device/trace ID).
Add superadmin 'Feedback Inbox' to view, reply, and triage (New/In progress/Shipped).
13) Optional but high-impact: ManageBac + timetable/CAS + notifications
ManageBac: pursue approved read-only API integration with IT (avoid cookie scraping).
Timetable/CAS/important announcements: consider read-only integrations; serverless approach: in-app notifications + email driven by client polling and/or scheduled jobs (Vercel Cron or external scheduler).
