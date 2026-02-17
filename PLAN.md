AI School - Comprehensive Bug Fix, UX Overhaul & School System Plan

 Context

 The AI School platform has numerous bugs across chat streaming, quiz/flashcard modes, image generation, and UI components. Major new features are needed: an "Auto" meta-mode, AI-powered agent creation, dynamic quiz interactions, and a full school management system with
 two-layer SOUL personalization. This plan addresses every reported issue and proactively adds features to make the platform production-grade.

 Architecture: Next.js 14 (App Router) + Convex (backend DB + functions) + Clerk (auth) + OpenRouter (LLM inference). State managed via useChatState hook + SidebarContext. Streaming via NDJSON over fetch.

 ---
 Phase 1: Critical Bug Fixes

 ---
 1.1 Image Generation 1MB Limit + Display in Chat

 Problem: convex/chats.ts appendMessage fails with "Value too large (1.70 MiB > 1 MiB)" because the image pipeline at pipeline.ts:784 embeds a full base64 data URL directly into message content. Additionally, in-chat display just shows text "Prompt: ... Generated Image" instead
 of the actual image.

 Root Cause: openRouterGenerateImage() in src/lib/openrouter.ts returns a base64 data URL from the model response. This gets embedded as ![Generated image](data:image/png;base64,...) in the message content string, exceeding Convex's 1MB document limit.

 Files to modify:
 - src/lib/openrouter.ts — after receiving base64 image, upload to Convex storage
 - convex/images.ts — add storeImageBlob mutation that accepts base64, writes to _storage, returns serving URL
 - src/lib/orchestrator/pipeline.ts (lines 764-906) — use storage URL instead of data URL
 - src/components/chat/markdown-renderer.tsx — ensure image mode parsing handles /api/images/serve/ URLs
 - src/components/chat/image-reveal.tsx — add lightbox modal, copy-to-clipboard, enlarge

 Implementation details:

 1. convex/images.ts — Add new action:
 // New action: storeImageFromBase64
 // Args: base64Data (string), mimeType (string), actorClerkId
 // 1. Decode base64 to Uint8Array
 // 2. Store via ctx.storage.store(new Blob([uint8], { type: mimeType }))
 // 3. Return storageId
 // 4. Get serving URL via ctx.storage.getUrl(storageId)
 // 5. Return { storageId, servingUrl }

 2. src/lib/openrouter.ts — In openRouterGenerateImage():
 - After getting response, check if imageUrl starts with data:image
 - If yes, call convexAction("images:storeImageFromBase64", { base64Data, mimeType, actorClerkId })
 - Replace imageUrl with the returned servingUrl
 - This ensures message content stays small (URL is ~100 chars vs 1.7MB)

 3. pipeline.ts line 784 — Change:
 // FROM:
 const finalizedResponse = `![Generated image](${imageUrl})\n\nPrompt: ${refinedPrompt}`;
 // TO:
 const finalizedResponse = `![Generated image](${imageUrl})\n\n**Prompt:** ${refinedPrompt}`;
 And ensure imageUrl is always the Convex serving URL (not base64).

 4. Remove hardcoded image size — pipeline.ts line 771: Make size dynamic:
 // Accept from request body with default
 const imageSize = body.imageSize ?? "1024x1024";
 Add imageSize to ChatRequestBody type.

 5. markdown-renderer.tsx — In image mode detection:
 - Parse ![alt](url) from content
 - If URL is a valid http(s) URL or Convex storage URL, render <ImageReveal>
 - If URL is empty or malformed, don't render broken img tag

 6. image-reveal.tsx — Add:
 - Click-to-enlarge: Full-screen modal with <dialog> element
 - Copy button: Use fetch(url).then(r => r.blob()) then navigator.clipboard.write([new ClipboardItem({"image/png": blob})])
 - Share button (optional): navigator.share({ url }) if available

 ---
 1.2 Chat Streaming Isolation (Cross-Chat Bleeding)

 Problem: When navigating away from a chat that's streaming, the stream content appears in the new chat. Stop button shows everywhere. No notification for background completions.

 Root Cause: use-chat-state.ts:314 has draftResponse as a single string state, not scoped to a chat. The sending boolean is also global. Although streamChatIdRef exists (line 340), it's not used to gate display.

 Files to modify:
 - src/hooks/use-chat-state.ts — scope draft to chatId, track per-chat streaming state
 - src/components/chat/chat-messages.tsx — only show draft for matching chat
 - src/components/chat/chat-layout.tsx — conditional stop button, toast for background completion

 Implementation details:

 1. use-chat-state.ts — Replace single draft with per-chat map:
 // REPLACE (line 314-315):
 const [draftResponse, setDraftResponse] = useState("");
 const [draftThinking, setDraftThinking] = useState("");

 // WITH:
 const [draftResponses, setDraftResponses] = useState<Map<string, string>>(new Map());
 const [draftThinkings, setDraftThinkings] = useState<Map<string, string>>(new Map());

 2. Computed draft for current chat:
 const draftResponse = draftResponses.get(selectedChatId) ?? "";
 const draftThinking = draftThinkings.get(selectedChatId) ?? "";

 3. In stream handler (inside sendMessage): Use streamChatIdRef.current to key the draft:
 // When receiving delta events:
 setDraftResponses(prev => {
   const next = new Map(prev);
   next.set(streamChatIdRef.current!, (next.get(streamChatIdRef.current!) ?? "") + chunk);
   return next;
 });

 4. sending state — Replace global boolean with per-chat tracking:
 // Already exists: activeStreamsRef = useRef<Set<string>>(new Set())
 // Derive sending for current chat:
 const sending = activeStreamsRef.current.has(selectedChatId);
 // But since refs don't trigger re-render, also keep:
 const [activeStreamIds, setActiveStreamIds] = useState<Set<string>>(new Set());
 const sending = activeStreamIds.has(selectedChatId);

 5. On stream done event — Check if user navigated away:
 // In done handler:
 const completedChatId = streamChatIdRef.current;
 setActiveStreamIds(prev => { const next = new Set(prev); next.delete(completedChatId); return next; });

 if (completedChatId !== selectedChatIdRef.current) {
   // User is in a different chat — show toast
   const chatTitle = chats.find(c => c._id === completedChatId)?.title ?? "Chat";
   toast.success(`Response ready in "${chatTitle}"`, {
     action: { label: "Go", onClick: () => setSelectedChatId(completedChatId) }
   });
   // Store completed messages for when user navigates back
   pendingCompletionsRef.current.set(completedChatId, [...newMessages]);
 }

 // Clear draft for completed chat
 setDraftResponses(prev => { const next = new Map(prev); next.delete(completedChatId); return next; });

 6. Stop button — In chat-layout.tsx, only pass onStop when current chat is streaming:
 <ChatHeader
   sending={activeStreamIds.has(selectedChatId)}  // only true for THIS chat
   onStop={activeStreamIds.has(selectedChatId) ? chat.stopGeneration : undefined}
   ...
 />

 7. Allow concurrent sends in different chats — Remove the guard at line 752:
 // FROM:
 if (!text || (sending && retryAttempt === 0)) return;
 // TO:
 if (!text) return;
 if (activeStreamIds.has(targetChatId) && retryAttempt === 0) return; // only block same-chat

 ---
 1.3 Wrong Content Generation (Off-Topic Quizzes/Flashcards)

 Problem: Quiz about "microeconomics" generates respiratory system questions. WW2 flashcards produce photosynthesis content.

 Root Cause: Two issues:
 1. The quiz/flashcard repair pipeline (pipeline.ts:964-1039) reformats content but loses the original topic context
 2. buildSystemPrompt() in src/lib/prompts/policy.ts may not strongly anchor the topic for quiz/flashcard modes

 Files to modify:
 - src/lib/orchestrator/pipeline.ts (lines 964-1039) — pass original topic to repair
 - src/lib/prompts/policy.ts — add topic anchoring for quiz/flashcard modes
 - src/lib/auto-settings.ts — ensure enhancement preserves core topic

 Implementation details:

 1. pipeline.ts repair prompt (line 968) — Include original message:
 // FROM:
 content: needsQuizRepair
   ? `Reformat into strict quiz syntax only...`
   : `Reformat into strict flashcard syntax only...`

 // TO:
 content: needsQuizRepair
   ? `The student asked: "${normalizedMessage}". Reformat the following response into strict quiz syntax about EXACTLY this topic. Do NOT change the subject. Output at least ${MIN_QUIZ_QUESTIONS} questions with A-D options, a "Correct: [letter]" line per question, then "##
 Answers & Explanations".`
   : `The student asked: "${normalizedMessage}". Reformat into strict flashcard syntax about EXACTLY this topic. Do NOT change the subject. Output at least ${MIN_FLASHCARD_PAIRS} FRONT/BACK pairs.`

 2. pipeline.ts regeneration repair (line 1011) — Same treatment:
 content: stillNeedsQuizRepair
   ? `The student wants a quiz about: "${normalizedMessage}". Generate a complete quiz about EXACTLY this topic...`
   : `The student wants flashcards about: "${normalizedMessage}". Generate flashcard pairs about EXACTLY this topic...`

 3. src/lib/prompts/policy.ts — In buildSystemPrompt(), for quiz/flashcard modes, add explicit anchor:
 // Add to quiz/flashcard system prompt sections:
 if (mode === "quiz" || mode === "flashcard" || mode === "exam") {
   parts.push("CRITICAL: Generate content STRICTLY about the topic the student asked about. Never deviate to unrelated subjects. If the topic is unclear, ask for clarification before generating.");
 }

 4. auto-settings.ts — In prompt enhancement, validate topic preservation:
 // After enhancing prompt, check that key nouns from original are in enhanced version
 // If not, prepend original topic: "Topic: {original_topic}. {enhanced_prompt}"

 ---
 1.4 Sources [1][2] Without Actual Sources

 Problem: Citation markers [1] [2] appear in AI responses but link to nothing — no actual sources listed.

 Root Cause: When a search model (Perplexity Sonar) is used, it embeds [1], [2] references in its output. But inferCitations() in post-process.ts may fail to match these to actual URLs if searchUrls is empty (search model returned inline refs but no separate URL list) or if RAG
 retrieval returned nothing.

 Files to modify:
 - src/lib/orchestrator/post-process.ts — strip orphan citation markers
 - src/components/chat/chat-message.tsx — only show citations UI if valid citations exist

 Implementation details:

 1. post-process.ts — After rewriteCitationMarkers(), add cleanup:
 export function stripOrphanCitations(text: string, citations: Citation[]): string {
   // Build set of valid citation numbers
   const validNums = new Set(citations.map((_, i) => i + 1));
   // Replace [N] where N has no matching citation
   return text.replace(/\[(\d+)\]/g, (match, numStr) => {
     const num = parseInt(numStr, 10);
     return validNums.has(num) ? match : '';
   });
 }
 Call this after rewriteCitationMarkers in the pipeline:
 const rewritten = rewriteCitationMarkers(correctedResponse, citations);
 const finalizedResponse = stripOrphanCitations(rewritten, citations);

 2. chat-message.tsx — Only render citation cards if citations have valid data:
 const validCitations = (citations ?? []).filter(c => c.url || c.resourceId || c.filename);
 // Only show citations section if validCitations.length > 0

 ---
 1.5 Quiz/Flashcard Mode — User Query Disappears + Answers Pre-Filled + No AI Text

 Problem: In quiz/flashcard mode, the user's message vanishes when the styled component appears. Only the quiz/flashcard UI shows — no AI explanatory text. Selected answers show a CheckCircle2 icon that looks like a "correct" indicator.

 Root Cause: chat-messages.tsx lines 148-161 — when isQuizContent(msg.content) is true, it renders ONLY <QuizReveal>, completely replacing the <ChatMessage> wrapper that would show the user message context. Also, the user message itself (role: "user") IS still rendered
 separately, but the quiz QuizReveal replaces the ENTIRE assistant message, losing any preamble text.

 Files to modify:
 - src/components/chat/chat-messages.tsx (lines 148-280) — render mixed content
 - src/components/chat/quiz-reveal.tsx (line 349) — replace CheckCircle2 with highlight
 - src/components/chat/flashcard-reveal.tsx — same pattern for flashcards
 - src/lib/structured-stream-buffer.ts — preserve preamble during streaming

 Implementation details:

 1. Add content splitter utility — New function in chat-messages.tsx:
 function splitMixedContent(content: string, mode: StudyMode): { preamble: string; structuredContent: string } {
   if (mode === "quiz" || mode === "exam") {
     // Find first question marker (Q1, Question 1, 1., 1))
     const match = content.match(/(?:^|\n)\s*(?:Q(?:uestion)?\s*)?1[.):-]\s/m);
     if (match?.index !== undefined && match.index > 0) {
       return {
         preamble: content.slice(0, match.index).trim(),
         structuredContent: content.slice(match.index).trim(),
       };
     }
   }
   if (mode === "flashcard") {
     const match = content.match(/(?:^|\n)\s*(?:Card\s*1|FRONT\s*:)/im);
     if (match?.index !== undefined && match.index > 0) {
       return {
         preamble: content.slice(0, match.index).trim(),
         structuredContent: content.slice(match.index).trim(),
       };
     }
   }
   return { preamble: "", structuredContent: content };
 }

 2. chat-messages.tsx lines 148-161 — Render preamble + component:
 if (msg.role === "assistant" && (mode === "quiz" || mode === "exam")) {
   if (isQuizContent(msg.content)) {
     const { preamble, structuredContent } = splitMixedContent(msg.content, mode);
     return (
       <ChatMessage key={msg._id} role={msg.role} ... >
         {preamble && <MarkdownRenderer content={preamble} citations={[]} />}
         <QuizReveal content={structuredContent} onSubmitAnswers={...} />
       </ChatMessage>
     );
   }
   // ... existing clarifying text handling
 }
 Same pattern for flashcard mode (lines 231-253).

 3. quiz-reveal.tsx line 349 — Replace CheckCircle2 with a radio-style indicator:
 // FROM:
 {!submitted && selected ? <CheckCircle2 className="h-4 w-4 text-[var(--accent-cyan)]" /> : null}

 // TO:
 {!submitted && selected ? (
   <span className="h-4 w-4 rounded-full border-2 border-[var(--accent-cyan)] bg-[var(--accent-cyan)]" />
 ) : null}

 4. Update system prompts — In buildSystemPrompt() for quiz/flashcard modes, instruct AI to include preamble:

 "Before the quiz questions, include 1-2 sentences of context about the topic and what the quiz covers. Then output the questions."


 5. structured-stream-buffer.ts — In processQuizBuffer(), preserve text before first question marker:
 // Don't strip content before Q1 — it's the preamble

 ---
 1.6 Conversation Title — Replace Not Append

 Problem: Auto-generated title appears alongside existing title in sidebar. Time-ago display gets overwritten.

 Files to modify:
 - src/components/chat/chat-sidebar.tsx — verify title rendering
 - src/hooks/use-chat-state.ts — handle chat_title stream event correctly

 Implementation details:

 1. use-chat-state.ts — In stream handler, when chat_title event arrives:
 // When receiving chat_title event from stream:
 if (payload.type === "chat_title" && payload.chatTitle) {
   setChats(prev => prev.map(c =>
     c._id === streamChatId
       ? { ...c, title: payload.chatTitle }  // REPLACE title, don't append
       : c
   ));
 }
 Also handle the chatTitle field in the done event the same way.

 2. chat-sidebar.tsx — Verify the sidebar item renders:
 // Title: chat.title (single field, not concatenated)
 // Subtitle: formatDistanceToNow(chat.updatedAt) — always shows time-ago
 // Never show both title and description — title IS the description
 Search for any place where both chat.title and another description field are concatenated or displayed together.

 ---
 1.7 Mode Auto-Selection — UI Not Updating

 Problem: When pipeline auto-switches mode (e.g., "create image" in chat mode → image mode), the UI doesn't reflect the change.

 Files to modify:
 - src/hooks/use-chat-state.ts — update mode from suggestedMode in done event
 - src/components/chat/chat-mode-selector.tsx — add "Auto" option
 - src/lib/modes.ts — add "auto" to registry
 - convex/shared.ts — add "auto" to vStudyMode
 - src/types/index.ts — add "auto" to StudyMode type

 Implementation details:

 1. src/types/index.ts — Add "auto" to StudyMode:
 export type StudyMode = "auto" | "tutor" | "marker" | ... | "image";

 2. convex/shared.ts — Add "auto" to validator:
 export const vStudyMode = v.union(
   v.literal("auto"),
   v.literal("tutor"),
   // ... existing
 );

 3. src/lib/modes.ts — Add auto to registry:
 auto: {
   key: "auto",
   label: "Auto",
   icon: "Sparkles",
   color: "linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899)",
   cssVar: "var(--accent-cyan)",
   description: "AI automatically selects the best mode for your message",
 },

 4. chat-mode-selector.tsx — Show "Auto" first with special gradient styling:
 // Insert Auto at top of mode list
 const modes = [MODE_REGISTRY.auto, ...ALL_MODES.filter(m => m.key !== "auto")];
 // Auto button gets gradient border and Sparkles icon

 5. use-chat-state.ts — In done event handler:
 if (payload.suggestedMode && payload.suggestedMode !== mode) {
   setMode(payload.suggestedMode);
   const modeLabel = getModeConfig(payload.suggestedMode)?.label ?? payload.suggestedMode;
   toast.info(`Mode switched to ${modeLabel}`, { duration: 3000 });
 }

 6. pipeline.ts — Enhance auto-detection for "auto" mode:
 // If mode is "auto", always run suggestMode
 const effectiveMode = safeMode === "auto"
   ? (auto.suggestedMode ?? "general") as StudyMode
   : (auto.suggestedMode && (safeMode === "tutor" || safeMode === "general") && safeMode !== auto.suggestedMode)
     ? auto.suggestedMode as StudyMode
     : safeMode;

 7. auto-settings.ts — Enhance suggestMode detection:
 function suggestMode(message: string): string | null {
   const lower = message.toLowerCase();
   // Image generation
   if (/\b(create|generate|draw|make|design)\s+(an?\s+)?(image|picture|photo|illustration|art)\b/i.test(message)) return "image";
   // Quiz
   if (/\b(quiz|test me|practice questions|multiple choice)\b/i.test(lower)) return "quiz";
   // Flashcard
   if (/\b(flashcard|flash card|memorize|review cards|study cards)\b/i.test(lower)) return "flashcard";
   // Research
   if (/\b(research|find sources|evidence|cite|bibliography)\b/i.test(lower)) return "research";
   // Explain
   if (/\b(explain|what is|how does|teach me|eli5)\b/i.test(lower)) return "explain";
   // Review/Mark
   if (/\b(review|grade|mark|feedback on|rubric)\b/i.test(lower)) return "marker";
   // Draft coaching
   if (/\b(write|essay|draft|composition|improve my writing)\b/i.test(lower)) return "draft_coach";
   return null;
 }

 ---
 1.8 Empty src="" Attribute Warnings

 Problem: Browser console shows "An empty string was passed to the src attribute" from multiple components.

 Files to modify:
 - src/app/page.tsx
 - src/components/chat/chat-layout.tsx
 - src/components/chat/markdown-renderer.tsx
 - src/components/chat/chat-sidebar.tsx (org logo)

 Implementation details:

 Search for all <Image and <img elements across these files. For each:
 // FROM:
 <Image src={someUrl} ... />
 // TO:
 {someUrl ? <Image src={someUrl} ... /> : null}

 Specific locations:
 - chat-sidebar.tsx: orgLogoUrl may be undefined — wrap in conditional
 - markdown-renderer.tsx: Image tags parsed from markdown may have empty src — filter during parsing
 - chat-layout.tsx: Any avatar or icon images — guard against empty strings

 Also add to markdown renderer's image handler:
 // In rehype/remark plugin or custom renderer:
 if (!node.properties.src || node.properties.src === '') return null;

 ---
 1.9 Usage Indicator Shows 0

 Problem: Usage meter in sidebar shows 0 despite messages being sent.

 Files to modify:
 - src/hooks/use-chat-state.ts — ensure spending update is applied
 - src/context/sidebar-context.tsx — verify userSpending state
 - src/components/chat/chat-sidebar.tsx — verify meter rendering

 Implementation details:

 1. In stream done handler — The pipeline sends spendingUpdate in the done payload. Make sure it's applied:
 if (payload.spendingUpdate) {
   setUserSpending(payload.spendingUpdate);
 }

 2. In sidebar-context.tsx — Verify userSpending is fetched on mount:
 // On mount, call /api/usage or convex query to get current spending
 // Verify this happens and state is set

 3. In chat-sidebar.tsx — Verify meter calculation:
 const spentCents = userSpending?.totalCostCents ?? 0;
 const percentage = Math.min(100, (spentCents / MONTHLY_HARD_LIMIT_CENTS) * 100);
 // Ensure this renders and the meter width is set to percentage%

 ---
 Phase 2: UI/UX Improvements

 ---
 2.1 Model Selector — Compact Display

 Files to modify: Find model selector/picker component (likely dropdown in chat-composer.tsx or a child component)

 Changes:
 1. Heading: Reduce from current size to text-xs font-medium
 2. Model name: Show only codename (after /):
 function modelDisplayName(modelId: string): string {
   const parts = modelId.split('/');
   return parts[parts.length - 1] ?? modelId;
 }
 3. Info line: Compact to single line:
 // FROM: Provider: Google | Context: 128,000 | Input: $0.15/M | Output: $0.60/M
 // TO: 128k ctx · Free    or    128k · $0.15/$0.60
 function compactModelInfo(model: ModelOption): string {
   const ctx = model.contextLength ? `${Math.round(model.contextLength / 1000)}k` : '';
   if (model.isFree) return `${ctx} · Free`;
   const inCost = model.inputCostPerM?.toFixed(2) ?? '?';
   const outCost = model.outputCostPerM?.toFixed(2) ?? '?';
   return `${ctx} · $${inCost}/$${outCost}`;
 }
 4. Layout: Use a compact popover instead of full list. Max height with scroll. Group by free/paid.

 ---
 2.2 "Why This Response" — Separate Section

 Files to modify: src/components/chat/chat-message.tsx

 Changes:
 1. Move whyThisResponse out of message body
 2. Add small info button (Info icon) in message footer
 3. On click, open collapsible section below message:
 const [showWhy, setShowWhy] = useState(false);
 // In message footer:
 {whyThisResponse && (
   <button onClick={() => setShowWhy(!showWhy)}>
     <Info className="h-3.5 w-3.5" />
   </button>
 )}
 // Below message:
 {showWhy && (
   <div className="mt-2 rounded-lg bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]">
     <p className="font-medium mb-1">Why this response</p>
     <p>{whyThisResponse}</p>
     {routeTrace && (
       <div className="mt-2 flex flex-wrap gap-1">
         {routeTrace.toolchain.map(tool => (
           <span key={tool} className="rounded-full bg-[var(--bg-primary)] px-2 py-0.5 text-[10px]">{tool}</span>
         ))}
       </div>
     )}
   </div>
 )}

 ---
 2.3 Right Panel Fixes

 Files to modify:
 - src/components/chat/model-leaderboard-drawer.tsx
 - src/components/chat/quiz-panel.tsx
 - src/components/chat/route-trace-drawer.tsx

 Changes:

 1. Leaderboard doesn't close: Verify onClose prop is wired to the X button and backdrop click. Check if open state is managed by parent — the parent may not toggle it off. Add onOpenChange pattern.
 2. Quiz panel cream color: Find the container element that has a different background. Change to bg-[var(--bg-primary)] or bg-transparent. Look for any default Radix/shadcn sheet content that has a cream background.
 3. Settings button in route-trace: Wire onClick to: onClose(); openSettings(); — pass both handlers down.
 4. Standardize skeletons: Create a PanelSkeleton component used by all panels:
 function PanelSkeleton() {
   return (
     <div className="space-y-3 p-4">
       {Array.from({ length: 4 }).map((_, i) => (
         <div key={i} className="h-12 w-full animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
       ))}
     </div>
   );
 }

 ---
 2.4 Image Gallery — Open/Copy/Enlarge

 Files to modify: src/components/chat/image-reveal.tsx

 Implementation:
 // Add state for lightbox
 const [lightboxOpen, setLightboxOpen] = useState(false);

 // Clickable image:
 <button onClick={() => setLightboxOpen(true)}>
   <Image src={imageUrl} ... />
 </button>

 // Lightbox modal:
 {lightboxOpen && (
   <dialog open className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
     <div className="relative max-h-[90vh] max-w-[90vw]">
       <img src={imageUrl} className="max-h-[85vh] object-contain" />
       <div className="absolute top-2 right-2 flex gap-2">
         <Button size="sm" onClick={copyImageToClipboard}>Copy</Button>
         <Button size="sm" onClick={downloadImage}>Download</Button>
         <Button size="sm" variant="ghost" onClick={() => setLightboxOpen(false)}>X</Button>
       </div>
     </div>
   </dialog>
 )}

 async function copyImageToClipboard() {
   const res = await fetch(imageUrl);
   const blob = await res.blob();
   await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
   toast.success("Image copied!");
 }

 ---
 2.5 Provider Logos — Complete Coverage

 Files to modify: src/lib/provider-icons.ts, src/components/provider-logo.tsx

 Changes:
 1. Add SVG paths for missing providers. Search through PROVIDER_PRESETS and identify which have no icon in PROVIDER_ICONS:
   - Nous Research, Together AI, Fireworks AI, AI21 Labs, Databricks (DBRX), 01.AI (Yi)
   - For each, find official SVG or create a simplified one
 2. Add to PROVIDER_ICONS map:
 "nous": "M... (SVG path)",
 "together": "M... (SVG path)",
 "fireworks": "M... (SVG path)",
 3. In provider-logo.tsx, add memoization:
 const providerCache = new Map<string, ReturnType<typeof getProviderPresentation>>();
 function getCachedProvider(modelId: string) {
   if (!providerCache.has(modelId)) {
     providerCache.set(modelId, getProviderPresentation(modelId));
   }
   return providerCache.get(modelId)!;
 }

 ---
 2.6 Model Explorer Fixes

 Files to modify: src/app/models/page.tsx

 Changes:
 1. Reduce search input font: text-sm instead of current larger size
 2. Verify search filtering works — should filter modelCatalog by name/provider/tags
 3. Improve grid: Use responsive grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
 4. Card improvements: Use compact info format from 2.1

 ---
 Phase 3: Auto Mode System

 ---
 3.1 "Auto" Meta-Mode — Full Implementation

 This builds on 1.7 above. Additional work:

 Files to modify:
 - src/lib/auto-settings.ts — enhanced mode suggestion
 - src/lib/orchestrator/pipeline.ts — auto mode handling
 - src/hooks/use-chat-state.ts — mode suggestion UI
 - src/components/chat/chat-mode-selector.tsx — "Auto" button
 - src/components/chat/chat-messages.tsx — per-message mode badge

 Implementation:

 1. Conflict detection — Even when user manually selects a mode, detect conflicts:
 // In pipeline, after auto-settings:
 if (safeMode !== "auto" && auto.suggestedMode && safeMode !== auto.suggestedMode) {
   // Check if the mismatch is severe (e.g. "create image" in quiz mode)
   const isSevereConflict = (
     (auto.suggestedMode === "image" && safeMode !== "image") ||
     (auto.suggestedMode === "quiz" && !["quiz", "exam"].includes(safeMode)) ||
     (safeMode === "quiz" && auto.suggestedMode === "image")
   );
   if (isSevereConflict) {
     // Use the suggested mode and notify
     effectiveMode = auto.suggestedMode;
   }
 }

 2. Per-message mode badge — In ChatMessage, show a small mode badge when the message's mode differs from the chat's current mode:
 {msg.mode && msg.mode !== currentChatMode && (
   <ModeBadge mode={msg.mode} />
 )}

 3. Mode transition indicator — In chat-messages.tsx, when consecutive messages have different modes:
 {prevMsg?.mode !== msg.mode && msg.mode && (
   <div className="text-center text-xs text-[var(--text-tertiary)] py-1">
     Mode changed to {getModeConfig(msg.mode).label}
   </div>
 )}

 ---
 Phase 4: Dynamic Quiz/Flashcard Interactions

 ---
 4.1 Post-Quiz Adaptive Flow

 Files to modify:
 - src/components/chat/quiz-reveal.tsx — post-submission UI
 - src/hooks/use-chat-state.ts — auto-follow-up message
 - src/lib/orchestrator/pipeline.ts — context-aware responses

 Implementation:

 1. quiz-reveal.tsx — After submission, replace plain score with contextual UI:
 {submitted && (
   <div className="rounded-xl border bg-[var(--bg-elevated)] p-5 text-center space-y-3">
     <p className="text-3xl font-bold">{score}/{questions.length}</p>
     <p className="text-sm text-[var(--text-secondary)]">
       {score === questions.length ? "Perfect score! You've mastered this topic." :
        score >= questions.length * 0.7 ? "Great job! A few areas to review." :
        score >= questions.length * 0.3 ? "Good effort! Let's strengthen your understanding." :
        "No worries! Let's review this topic together."}
     </p>
     <div className="flex justify-center gap-2 flex-wrap">
       {score === questions.length && (
         <>
           <Button onClick={() => requestHarderQuiz()}>Harder Quiz</Button>
           <Button variant="secondary" onClick={() => requestNewTopic()}>New Topic</Button>
         </>
       )}
       {score > 0 && score < questions.length && (
         <>
           <Button onClick={() => requestExplanation()}>Explain Mistakes</Button>
           <Button variant="secondary" onClick={() => requestRetry()}>Retry Quiz</Button>
         </>
       )}
       {score === 0 && (
         <>
           <Button onClick={() => switchToLearnMode()}>Teach Me First</Button>
           <Button variant="secondary" onClick={() => requestEasierQuiz()}>Easier Quiz</Button>
         </>
       )}
     </div>
   </div>
 )}

 2. Action handlers — These send follow-up messages:
 function requestHarderQuiz() {
   onFollowUp?.(`Create a harder quiz about the same topic with more challenging questions.`);
 }
 function switchToLearnMode() {
   onFollowUp?.(`I got ${score}/${questions.length}. Please teach me about the topics I got wrong: ${incorrectTopics.join(', ')}. Switch to Learn mode.`);
   onModeChange?.("tutor");
 }
 function requestExplanation() {
   onFollowUp?.(`Explain why I got these wrong: ${incorrectDetails.join('; ')}`);
 }

 3. Add onFollowUp and onModeChange props to QuizReveal, wire from chat-messages.tsx to chat.sendMessage() and handleModeChange().

 ---
 4.2 Pre-Generation Clarification

 Files to modify:
 - src/lib/orchestrator/pipeline.ts — detect vague requests
 - src/lib/prompts/policy.ts — add clarification instruction

 Implementation:

 In buildSystemPrompt() for quiz/flashcard modes:
 // Add instruction:
 "If the student's request is vague (e.g., just 'quiz me' or 'make flashcards' without a topic), ask a clarifying question: 'What topic would you like me to quiz you on? How many questions? What difficulty level?' Do NOT generate content for an ambiguous request."

 In pipeline, add a heuristic check:
 // Before sending to model, check if message is too vague for quiz/flashcard
 const isVagueRequest = (effectiveMode === "quiz" || effectiveMode === "flashcard") &&
   normalizedMessage.split(/\s+/).length < 4 &&
   !/\b(about|on|for|regarding)\b/i.test(normalizedMessage);

 if (isVagueRequest) {
   // Don't apply quiz format repair — let the model ask for clarification
   // Lower max tokens since we expect a short clarification response
 }

 ---
 4.3 Quiz Mode — Answers Should Not Appear Pre-Filled

 Root cause investigation: The parseQuiz function in quiz-reveal.tsx line 80 extracts correct field from the answer section. The UI shows CheckCircle2 for selected answers (line 349). The issue may be that during streaming, the buffer hasn't properly hidden answers, and by the
 time the full message arrives, all answers including correct ones are visible in the raw content.

 Additional fix: In structured-stream-buffer.ts processQuizBuffer():
 - Ensure the answer section is COMPLETELY stripped before display
 - Only the rawContent should contain answers (for submission checking)
 - The safeContent used for rendering must not expose correct answers

 ---
 4.4 Store Mode Per Message for History

 Already done: Messages schema already has mode: vStudyMode field. The pipeline already stores effectiveMode when appending messages. Just need to use it in the UI.

 In chat-messages.tsx, read msg.mode instead of relying on the global mode state for determining how to render each message. This fixes the issue where changing chat mode retroactively changes how old messages render:
 // Use per-message mode for rendering decisions:
 const msgMode = msg.mode ?? mode; // fallback to current chat mode
 if (msg.role === "assistant" && (msgMode === "quiz" || msgMode === "exam")) {
   // render quiz
 }

 ---
 Phase 5: Agent Creation — AI-Powered Wizard

 ---
 5.1 Complete Agent Builder Redesign

 Files to modify:
 - src/components/agents/agent-builder-form.tsx — complete redesign
 - src/app/agents/new/page.tsx — page wrapper
 - src/app/api/agents/generate-full/route.ts — enhanced generation endpoint

 Implementation:

 1. Multi-step wizard — Replace current form with step-by-step flow:
 type WizardStep = "purpose" | "personality" | "expertise" | "boundaries" | "review";
 const [step, setStep] = useState<WizardStep>("purpose");

 2. Step 1: Purpose (1 question):

 "What should this agent help students with?"
 [Free text textarea with placeholder examples]
 - Example: "Help students understand calculus concepts through worked examples"
 - Example: "Guide students through essay writing with feedback on structure"


 3. Step 2: Personality (3 questions):

 "How should it communicate?"
 [Chips: Formal / Friendly / Encouraging / Direct / Socratic]

 "What's its teaching style?"
 [Chips: Step-by-step / Discovery-based / Example-driven / Discussion-oriented]

 "How patient should it be?"
 [Slider: Quick & Direct ←→ Very Patient & Thorough]


 4. Step 3: Expertise (2 questions):

 "What subjects?" [Multi-select chips: Math, Science, English, History, CS, Languages, Arts, Economics, Philosophy, Other]

 "What level?" [Single select: Primary / Secondary / A-Level / University / Professional]


 5. Step 4: Boundaries (2 questions):

 "What should it NOT do?" [Checkboxes]:
 ☐ Don't give direct homework answers — guide instead
 ☐ Don't generate inappropriate content
 ☐ Don't fabricate sources or facts
 ☐ Don't go off-topic
 ☐ Always ask for clarification when unsure

 "Strictness level:" [Slider: Lenient ←→ Strict]


 6. Step 5: Review & Generate:
 - Show summary of all choices
 - "Generate Agent" button → calls /api/agents/generate-full
 - Loading state with Sparkles animation
 - Shows generated: name, description, system prompt
 - Collapsible "Edit prompt" section for power users
 - "Create Agent" button to save

 7. Generation endpoint (/api/agents/generate-full):
 // POST body: { purpose, personality, teachingStyle, patience, subjects, level, boundaries, strictness }
 // Calls LLM with structured prompt to generate:
 // - name (creative, short)
 // - description (1-2 sentences)
 // - systemPrompt (detailed, multi-paragraph)
 // - suggestedMode (preferred StudyMode)
 // - suggestedCategory

 8. Remove avatar emoji picker — Replace with AI-generated or auto-assigned based on subject:
 const SUBJECT_EMOJIS: Record<string, string> = {
   math: "🧮", science: "🔬", english: "📝", history: "🏛️"
   cs: "💻", languages: "🌍", arts: "🎨", economics: "📈",
   philosophy: "🤔", default: "🎓"
 };

 9. Progress indicator — Visual steps at top:
 <div className="flex gap-2 mb-8">
   {["Purpose", "Personality", "Expertise", "Boundaries", "Review"].map((label, i) => (
     <div key={label} className={`flex-1 h-1.5 rounded-full ${
       i <= currentStepIndex ? "bg-[var(--accent-cyan)]" : "bg-[var(--border-default)]"
     }`} />
   ))}
 </div>

 ---
 Phase 6: School Management System

 ---
 6.1 Schema Changes

 File: convex/schema.ts

 Add new tables:
 schoolInvitations: defineTable({
   orgId: v.id("orgs"),
   email: v.string(),
   role: vRole,
   invitedBy: v.id("users"),
   status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired")),
   token: v.string(),
   createdAt: v.number(),
   expiresAt: v.number(),
 })
   .index("by_org", ["orgId"])
   .index("by_email", ["email"])
   .index("by_token", ["token"]),

 userSoulPreferences: defineTable({
   userId: v.id("users"),
   orgId: v.id("orgs"),
   learningStyle: v.optional(v.string()),
   preferredDifficulty: v.optional(v.string()),
   interests: v.optional(v.array(v.string())),
   weakAreas: v.optional(v.array(v.string())),
   preferredModes: v.optional(v.array(v.string())),
   communicationStyle: v.optional(v.string()),
   customGuidance: v.optional(v.string()),
   onboardingComplete: v.optional(v.boolean()),
   createdAt: v.number(),
   updatedAt: v.number(),
 })
   .index("by_user", ["userId"])
   .index("by_org", ["orgId"]),

 Modify orgs table — add fields:
 description: v.optional(v.string()),
 schoolType: v.optional(v.string()),  // "primary", "secondary", "university", "corporate", "other"
 country: v.optional(v.string()),
 timezone: v.optional(v.string()),
 maxStudents: v.optional(v.number()),
 isActive: v.optional(v.boolean()),
 createdBy: v.optional(v.string()),  // clerkId of super admin who created it

 Modify users table — add fields:
 invitedAt: v.optional(v.number()),
 lastActiveAt: v.optional(v.number()),
 onboardingComplete: v.optional(v.boolean()),

 ---
 6.2 Super Admin System

 New files to create:

 1. src/app/super-admin/page.tsx — Dashboard:
   - Total schools count, total users, total usage across all schools
   - Recent activity feed
   - Quick actions: Create school, View all schools
   - Route guard: Check SUPER_ADMIN_EMAILS env var against current user
 2. src/app/super-admin/schools/page.tsx — Schools list:
   - Table: Name, Slug, Type, Students count, Teachers count, Usage, Status
   - Search and filter
   - "Create School" button
 3. src/app/super-admin/schools/new/page.tsx — Create school form:
   - Name, Slug (auto-generated from name), Description
   - School type (dropdown)
   - Country, Timezone
   - Token budget (daily)
   - Max students
   - Feature flags (checkboxes)
   - Initial admin email (required)
   - On submit: Creates org, creates/assigns admin user
 4. src/app/super-admin/schools/[id]/page.tsx — School detail:
   - Overview tab: stats, settings
   - Members tab: list/add/remove users
   - Usage tab: charts, spending
   - Settings tab: edit school config
   - SOUL tab: view/edit school SOUL
 5. convex/superAdmin.ts — Backend functions:
 // Queries:
 listAllOrgs(actorClerkId) — returns all orgs with member counts
 getOrgDetail(actorClerkId, orgId) — full org data with members
 getGlobalStats(actorClerkId) — totals across all orgs

 // Mutations:
 createOrg(actorClerkId, { name, slug, description, type, ... }) — creates new school
 updateOrg(actorClerkId, orgId, updates) — updates school settings
 deactivateOrg(actorClerkId, orgId) — soft-deactivate school
 assignOrgAdmin(actorClerkId, orgId, userEmail) — make user admin of org
 transferUser(actorClerkId, userId, fromOrgId, toOrgId) — move user between schools

 6. src/lib/auth-server.ts — Add super admin check:
 const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS ?? "pablo.martinez.dovale@gmail.com").split(",").map(e => e.trim());

 export async function requireSuperAdmin(): Promise<SessionActor> {
   const actor = await requireActor();
   if (!SUPER_ADMIN_EMAILS.includes(actor.email)) {
     throw new Error("Super admin access required");
   }
   return actor;
 }

 ---
 6.3 School Admin Panel

 New files to create:

 1. src/app/admin/school/page.tsx — School admin dashboard:
   - School name, logo, member count
   - Quick stats: active students, messages today, avg quiz score
   - Navigation to sub-pages
 2. src/app/admin/school/members/page.tsx — Member management:
   - Table: Name, Email, Role, Last Active, Joined
   - Invite new member form (email + role selector)
   - Bulk invite via CSV upload
   - Role change dropdown per user
   - Remove member button with confirmation
   - Pending invitations section
 3. src/app/admin/school/branding/page.tsx — Branding:
   - Logo upload (drag & drop, crop/preview)
   - Primary color picker
   - Accent color picker
   - Welcome message editor (rich text)
   - Live preview sidebar
 4. src/app/admin/school/soul/page.tsx — Enhanced SOUL editor:
   - Expand existing /admin/soul with more sections
   - Add: School Values & Mission, Teaching Philosophy
   - Add: Subject-specific guidelines (per subject)
   - Preview: "Test this SOUL" — enter a sample student query, see how SOUL affects response
   - Publish button with version history
 5. src/app/admin/school/analytics/page.tsx — School analytics:
   - Student engagement heatmap (day × hour)
   - Mode usage breakdown (pie chart)
   - Quiz score trends (line chart)
   - Most active students leaderboard
   - Topics explored word cloud
   - Usage over time (bar chart)
 6. convex/schoolAdmin.ts — Backend functions:
 // Queries:
 getSchoolDashboard(actorClerkId) — stats for admin's school
 listMembers(actorClerkId, { search, role, page }) — paginated member list
 listInvitations(actorClerkId) — pending invitations
 getSchoolAnalytics(actorClerkId, { days }) — analytics data

 // Mutations:
 inviteMember(actorClerkId, { email, role }) — create invitation
 cancelInvitation(actorClerkId, invitationId) — cancel pending invite
 resendInvitation(actorClerkId, invitationId) — resend with new token
 removeMember(actorClerkId, userId) — remove from school
 updateMemberRole(actorClerkId, userId, newRole) — change role
 updateBranding(actorClerkId, { logoStorageId, primaryColor, accentColor, welcomeMessage })

 ---
 6.4 Two-Layer SOUL Personalization

 Files to modify:
 - convex/soul.ts — add personal SOUL retrieval
 - src/lib/orchestrator/pipeline.ts — inject both layers
 - NEW: src/components/settings/personal-preferences.tsx — student preferences UI
 - NEW: convex/personalSoul.ts — personal preferences CRUD

 Implementation:

 1. Layer 1 (School SOUL) — Already exists. orgSoulDocs + orgSoulChunks with vector search. Injected via retrieveSoulGuidance().
 2. Layer 2 (Personal SOUL) — New userSoulPreferences table:
   - Students fill out during onboarding or in settings
   - No vector search needed — direct key-value injection
 3. Personal preferences UI (src/components/settings/personal-preferences.tsx):
 // Form with sections:
 // Learning Style: Visual / Auditory / Reading / Kinesthetic (radio)
 // Preferred Difficulty: Easy / Medium / Hard / Challenge Me (radio)
 // Interests: [chip input — add topics you're interested in]
 // Weak Areas: [chip input — topics you struggle with]
 // Communication Style: Brief / Detailed / Step-by-step / Conversational (radio)
 // Custom Notes: [textarea — anything else the AI should know]

 4. Pipeline injection (pipeline.ts):
 // After school SOUL retrieval, also fetch personal preferences:
 const personalSoul = await convexQuery("personalSoul:getPreferences", {
   actorClerkId: actor.clerkId,
 });

 // Build personal context block:
 if (personalSoul) {
   const personalBlock = [
     `=== STUDENT PROFILE (adapt teaching accordingly) ===`,
     personalSoul.learningStyle ? `Learning style: ${personalSoul.learningStyle}` : '',
     personalSoul.preferredDifficulty ? `Preferred difficulty: ${personalSoul.preferredDifficulty}` : '',
     personalSoul.interests?.length ? `Interests: ${personalSoul.interests.join(', ')}` : '',
     personalSoul.weakAreas?.length ? `Areas needing support: ${personalSoul.weakAreas.join(', ')}` : '',
     personalSoul.communicationStyle ? `Communication preference: ${personalSoul.communicationStyle}` : '',
     personalSoul.customGuidance ? `Additional context: ${personalSoul.customGuidance}` : '',
     `===`,
   ].filter(Boolean).join('\n');
   systemPromptParts.push(personalBlock);
 }

 5. convex/personalSoul.ts:
 // Queries:
 getPreferences(actorClerkId) — returns user's preferences or null
 // Mutations:
 savePreferences(actorClerkId, { learningStyle, preferredDifficulty, interests, weakAreas, communicationStyle, customGuidance })
 completeOnboarding(actorClerkId) — marks onboarding as done

 ---
 6.5 User Invitation Flow

 Implementation:

 1. Admin invites user:
   - Enter email + role → schoolAdmin:inviteMember mutation
   - Creates schoolInvitation record with random token, 7-day expiry
   - (Future: send invite email — for now, admin shares link manually)
 2. User signs up via Clerk:
   - Clerk webhook fires user.created → users:syncFromWebhook
   - In syncFromWebhook, check for pending invitation:
 const invitation = await ctx.db.query("schoolInvitations")
   .withIndex("by_email", q => q.eq("email", email))
   .filter(q => q.eq(q.field("status"), "pending"))
   .first();

 if (invitation && invitation.expiresAt > Date.now()) {
   // Assign user to invitation's org with specified role
   orgId = invitation.orgId;
   role = invitation.role;
   // Mark invitation as accepted
   await ctx.db.patch(invitation._id, { status: "accepted" });
 } else {
   // Default: assign to demo-school (existing behavior)
 }
 3. Invitation URL format: /join?token={token} — landing page that shows school name and redirects to Clerk signup.

 ---
 6.6 Super Admin Route in Sidebar/Navigation

 Files to modify: src/components/chat/chat-sidebar.tsx

 Add conditional navigation links:
 // For super admins:
 {isSuperAdmin && (
   <Link href="/super-admin" className="...">
     <Shield className="h-4 w-4" /> Super Admin
   </Link>
 )}

 // For school admins:
 {role === "admin" && (
   <Link href="/admin/school" className="...">
     <School className="h-4 w-4" /> School Admin
   </Link>
 )}

 ---
 Phase 7: Proactive Improvements

 ---
 7.1 Onboarding Flow

 New files:
 - src/app/onboarding/page.tsx — Onboarding wizard
 - src/components/onboarding/steps.tsx — Step components

 Implementation:
 - Triggered on first login when user.onboardingComplete !== true
 - Steps: Welcome → Learning Preferences → Mode Tour → Ready
 - Collects personal SOUL preferences (feeds into 6.4)
 - Shows quick demo of key features with animated examples
 - On completion: completeOnboarding() mutation

 ---
 7.2 Notification System (Nudges)

 Existing table: nudges — already in schema but unused.

 Implementation:
 - After quiz: Create nudge with score feedback
 - After streak milestone: "5-day streak! Keep it up!"
 - When teacher adds new resource: "New study material available"
 - Background chat completion: Use toast (from 1.2) instead of nudges
 - Add NudgeBanner component in chat layout that shows/dismisses nudges

 ---
 7.3 Keyboard Shortcuts

 Files to modify: src/hooks/use-chat-state.ts (existing keydown handler at line 583)

 Add:
 // Cmd/Ctrl + K → Quick mode switch (popup)
 if (isMod && event.key.toLowerCase() === "k") {
   event.preventDefault();
   window.dispatchEvent(new Event("ai-school:toggle-mode-picker"));
 }
 // Cmd/Ctrl + N → New chat
 if (isMod && event.key.toLowerCase() === "n") {
   event.preventDefault();
   startNewChat(selectedAgentId);
 }
 // Cmd/Ctrl + / → Focus search
 if (isMod && event.key === "/") {
   event.preventDefault();
   document.querySelector<HTMLInputElement>('[data-search-input]')?.focus();
 }

 ---
 7.4 Chat History Mode Tracking + Transitions

 Already stored: Each message has mode field.

 UI additions in chat-messages.tsx:
 // Between messages, if mode changed:
 {index > 0 && messages[index - 1]?.mode !== msg.mode && (
   <div className="flex items-center gap-2 py-2">
     <div className="h-px flex-1 bg-[var(--border-default)]" />
     <span className="text-[10px] text-[var(--text-tertiary)]">
       Switched to {getModeConfig(msg.mode).label} mode
     </span>
     <div className="h-px flex-1 bg-[var(--border-default)]" />
   </div>
 )}

 ---
 7.5 Orchestration Enhancements

 Files to modify: src/lib/auto-settings.ts, src/lib/routing/heuristic.ts

 Improvements:
 1. Better complexity detection — Use word count + sentence structure + domain terms
 2. Mode-aware model selection — Quiz/flashcard should prefer fast models; research should prefer reasoning models
 3. Search intent for modes — Auto-enable search for research mode (already done), also for "current events" in any mode
 4. Thinking escalation — If first response was weak (low quality score), auto-escalate thinking for retry
 5. Memory-aware suggestions — If student has weak areas in memory, suggest relevant practice modes

 ---
 File Summary

 Files to CREATE (new):

 - src/app/super-admin/page.tsx
 - src/app/super-admin/schools/page.tsx
 - src/app/super-admin/schools/new/page.tsx
 - src/app/super-admin/schools/[id]/page.tsx
 - src/app/admin/school/page.tsx
 - src/app/admin/school/members/page.tsx
 - src/app/admin/school/branding/page.tsx
 - src/app/admin/school/soul/page.tsx
 - src/app/admin/school/analytics/page.tsx
 - src/app/onboarding/page.tsx
 - src/app/join/page.tsx (invitation landing)
 - src/components/onboarding/steps.tsx
 - src/components/settings/personal-preferences.tsx
 - convex/superAdmin.ts
 - convex/schoolAdmin.ts
 - convex/personalSoul.ts

 Files to MODIFY (existing):

 - convex/schema.ts — add tables, modify orgs/users
 - convex/shared.ts — add "auto" to StudyMode
 - convex/chats.ts — title handling
 - convex/images.ts — add storeImageFromBase64 action
 - convex/users.ts — invitation handling in syncFromWebhook
 - convex/soul.ts — personal SOUL integration
 - src/types/index.ts — add "auto" to StudyMode type
 - src/lib/modes.ts — add "auto" mode to registry
 - src/lib/auto-settings.ts — enhanced mode suggestion
 - src/lib/model-config.ts — (if needed for image size)
 - src/lib/openrouter.ts — image base64→storage conversion
 - src/lib/provider-icons.ts — add missing provider SVGs
 - src/lib/orchestrator/pipeline.ts — image fix, topic anchoring, auto mode, personal SOUL injection, pre-clarification
 - src/lib/orchestrator/post-process.ts — strip orphan citations
 - src/lib/prompts/policy.ts — topic anchoring, clarification instructions
 - src/lib/structured-stream-buffer.ts — preserve quiz preamble
 - src/lib/auth-server.ts — add requireSuperAdmin
 - src/hooks/use-chat-state.ts — streaming isolation, mode updates, spending updates, keyboard shortcuts
 - src/components/chat/chat-layout.tsx — conditional stop button, empty src fix
 - src/components/chat/chat-messages.tsx — mixed content rendering, mode transitions, per-message mode
 - src/components/chat/chat-message.tsx — why-this-response panel, citation filtering
 - src/components/chat/chat-sidebar.tsx — title display, usage meter, nav links, empty src fix
 - src/components/chat/chat-mode-selector.tsx — "Auto" button at top
 - src/components/chat/chat-composer.tsx — compact model selector
 - src/components/chat/quiz-reveal.tsx — post-quiz flow, remove CheckCircle2, adaptive actions
 - src/components/chat/flashcard-reveal.tsx — mixed content support
 - src/components/chat/image-reveal.tsx — lightbox, copy, enlarge
 - src/components/chat/markdown-renderer.tsx — empty src fix, image URL handling
 - src/components/chat/model-leaderboard-drawer.tsx — close handler fix
 - src/components/chat/quiz-panel.tsx — cream color fix
 - src/components/chat/route-trace-drawer.tsx — settings button fix
 - src/components/chat/sources-drawer.tsx — valid citations only
 - src/components/provider-logo.tsx — caching, missing providers
 - src/components/agents/agent-builder-form.tsx — complete redesign as wizard
 - src/app/page.tsx — empty src fix
 - src/app/models/page.tsx — search size, functionality fixes
 - src/app/agents/new/page.tsx — updated for wizard

 ---
 Verification Plan

 Manual Testing Checklist

 1. Image generation: Send "create image of flying lambo" in image mode → should render image inline, no 1MB error, can enlarge/copy
 2. Streaming isolation: Open Chat A, send message, immediately switch to Chat B, send another → A's stream stays in A, B's in B, toast when A completes
 3. Quiz accuracy: Send "quiz me on microeconomics" in quiz mode → quiz about microeconomics (not respiratory system), answers start empty
 4. Flashcard accuracy: Send "flashcards on WW2" → flashcards about WW2, not photosynthesis
 5. Sources: Send research query → [1][2] link to actual sources. Send simple query → no orphan markers
 6. Auto mode: Select "Auto" mode, send "create an image of a cat" → auto-switches to image mode. Send "quiz me on biology" → auto-switches to quiz mode
 7. Mixed content: Quiz response includes preamble text + quiz component (not just quiz)
 8. Post-quiz flow: Score 0 → shows "Teach Me First" button. Score 100% → shows "Harder Quiz" button
 9. Title: New chat → title updates to AI-generated title (replaces, not appends). Time-ago always visible
 10. Usage meter: Send messages → meter updates after each response
 11. Model selector: Open picker → compact display, codename only, single-line pricing
 12. Agent creation: Go through wizard → AI generates good prompt → can edit → create agent
 13. School system: Super admin creates school → assigns admin → admin invites student → student joins school → sees school branding + SOUL
 14. Personal SOUL: Student fills preferences → preferences reflected in AI responses (mentioning their learning style, interests)
 15. Right panels: Leaderboard opens and closes. Quiz panel no cream color. Settings button works in route-trace panel
 16. Provider logos: All providers show proper icons, no black squares
 17. Model explorer: Search works, text is normal size
 18. Empty src: No browser console warnings about empty src attributes
 19. Mode transitions: Mode change badges visible between messages in chat history

 Run Commands

 npm run dev          # Local development server
 npx convex dev      # Convex development sync
 npm run lint        # TypeScript/ESLint check
 npm run build       # Full production build