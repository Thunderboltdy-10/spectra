/*
 * Every user-facing action in Spectra, registered once, with how Spectra AI
 * reaches it.
 *
 * - A "tool" action runs through a harness tool, the same server path the
 *   user's own control uses. The AI can find it with find_commands and run it
 *   with run_command; most also have a first-class tool.
 * - A "user" action is only the user's, with the reason written down. A
 *   reason marked `gap` means nothing forbids an AI path; it does not exist
 *   yet.
 *
 * Buttons, menus and the command bar run the `app.*` commands in
 * app-registry.ts. Each one names its action here through `ui`, and the AI
 * authority the bar shows comes from this file. The parity tests fail when
 * an app command, an artifact capability or a public Convex mutation or
 * action has no entry here and no written reason.
 *
 * Nothing here imports React or the harness, so the server, the client and
 * the tests share it.
 */

export const COMMAND_AREAS = [
  "navigation",
  "conversation",
  "work",
  "library",
  "comments",
  "settings",
  "permissions",
  "calendar",
  "reminders",
  "devices",
  "connections",
  "sharing",
  "managebac",
  "memory",
  "agents",
  "study",
  "school",
] as const;

export type CommandArea = (typeof COMMAND_AREAS)[number];

export type AiReach =
  | {
      kind: "tool";
      /** The harness tool that runs it. */
      tool: string;
      /** Arguments run_command fixes for this action, such as a tool's action. */
      fixed?: Record<string, unknown>;
      /** The server application command the tool sends, when it sends one. */
      appCommand?: string;
      /** Arguments that run it, for find_commands and the parity test. */
      example?: Record<string, unknown>;
    }
  | {
      kind: "user";
      reason: string;
      /** No rule keeps the AI out; the path does not exist yet. */
      gap?: true;
    };

export type CatalogCommand = {
  id: string;
  area: CommandArea;
  title: string;
  /** What it does, in the user's words. find_commands searches this. */
  description: string;
  /** Other words people use for it. */
  keywords?: readonly string[];
  /** App commands (buttons, menus, the command bar) that run this action. */
  ui?: readonly `app.${string}`[];
  /** Public Convex functions behind it: "module:fn", or "module:*" for a whole module. */
  server?: readonly string[];
  reach: AiReach;
};

const tool = (name: string, extra: Omit<Extract<AiReach, { kind: "tool" }>, "kind" | "tool"> = {}): AiReach => ({
  kind: "tool",
  tool: name,
  ...extra,
});
const user = (reason: string): AiReach => ({ kind: "user", reason });
const gap = (reason: string): AiReach => ({ kind: "user", reason, gap: true });

const PERMISSION_REASON =
  "It changes what Spectra AI may do. Only the user changes that, in Settings, so the AI can never grant itself more.";
const NOT_A_FOLLOW_DESTINATION =
  "Following Spectra opens Library, Calendar, Settings, a workspace or a work item. This page is not a follow destination yet; adding it is a shell change.";

export const COMMAND_CATALOG: readonly CatalogCommand[] = [
  // Navigation
  {
    id: "navigation.open_library",
    area: "navigation",
    title: "Open Library",
    description: "Show the user's Library, the home of their workspaces and work.",
    keywords: ["home", "files", "workspace hub", "go to"],
    ui: ["app.page.library", "app.page.workspace", "app.navigate"],
    reach: tool("open_in_spectra", { fixed: { destination: "library" }, appCommand: "navigate_spectra", example: {} }),
  },
  {
    id: "navigation.open_workspace",
    area: "navigation",
    title: "Open a workspace",
    description: "Show one workspace to the user.",
    keywords: ["class", "project", "go to"],
    reach: tool("open_in_spectra", { fixed: { destination: "workspace" }, appCommand: "navigate_spectra", example: { targetId: "ws1" } }),
  },
  {
    id: "navigation.open_work",
    area: "navigation",
    title: "Open a work item",
    description: "Open a document, deck, sheet or other work for the user. It opens the work; the region Spectra edits shows through Follow.",
    keywords: ["show", "artifact", "document", "jump to", "reveal"],
    ui: ["app.work.open", "app.work.reveal-anchor"],
    reach: tool("open_in_spectra", { fixed: { destination: "artifact" }, appCommand: "navigate_spectra", example: { targetId: "wx1" } }),
  },
  {
    id: "navigation.open_calendar",
    area: "navigation",
    title: "Open Calendar",
    description: "Show the user's calendar.",
    keywords: ["schedule", "agenda", "week"],
    ui: ["app.page.calendar", "app.calendar.open"],
    reach: tool("open_in_spectra", { fixed: { destination: "calendar" }, appCommand: "navigate_spectra", example: {} }),
  },
  {
    id: "navigation.open_devices",
    area: "navigation",
    title: "Open Devices",
    description: "Show the Devices page: this computer, the user's other computers, their folders and health.",
    keywords: ["bridge", "computers", "desktop", "go to"],
    ui: ["app.devices.open"],
    reach: tool("open_in_spectra", { fixed: { destination: "devices" }, appCommand: "navigate_spectra", example: {} }),
  },
  {
    id: "navigation.open_settings",
    area: "navigation",
    title: "Open Settings",
    description: "Show Settings, or one section of it (targetId: appearance, ai, account and so on).",
    keywords: ["preferences", "options", "account", "manage account"],
    ui: ["app.page.settings", "app.settings.manage-account"],
    reach: tool("open_in_spectra", { fixed: { destination: "settings" }, appCommand: "navigate_spectra", example: { targetId: "appearance" } }),
  },
  {
    id: "navigation.open_agents",
    area: "navigation",
    title: "Open Agents",
    description: "Show the specialist agents page.",
    ui: ["app.page.agents"],
    reach: gap(NOT_A_FOLLOW_DESTINATION),
  },
  {
    id: "navigation.open_school",
    area: "navigation",
    title: "Open School",
    description: "Show school data and class shelves.",
    ui: ["app.page.school"],
    reach: gap(NOT_A_FOLLOW_DESTINATION),
  },
  {
    id: "navigation.open_analytics",
    area: "navigation",
    title: "Open Analytics",
    description: "Show learning analytics.",
    ui: ["app.page.analytics"],
    reach: gap(NOT_A_FOLLOW_DESTINATION),
  },

  // Conversation
  {
    id: "conversation.find_thread",
    area: "conversation",
    title: "Find a past conversation",
    description: "Find an earlier chat by what was said and read it.",
    keywords: ["thread", "history", "earlier", "last time", "chat"],
    ui: ["app.thread.open", "app.run.open-conversation"],
    server: ["semantic:searchThreads"],
    reach: tool("read_thread", { example: { query: "photosynthesis" } }),
  },
  {
    id: "conversation.send",
    area: "conversation",
    title: "Send a message",
    description: "Send Spectra a message, start a new chat or pick a suggested reply.",
    ui: ["app.page.chat", "app.chat.new"],
    server: ["spectraRuns:beginRun", "spectraThreads:create", "spectraThreads:appendMessage", "spectraThreads:selectMessageChoice"],
    reach: user("The user's message is what starts Spectra; Spectra replies inside the conversation it was asked in."),
  },
  {
    id: "conversation.manage",
    area: "conversation",
    title: "Rename or tidy a conversation",
    description: "Rename a conversation or hide and keep its result cards and tabs.",
    server: ["spectraThreads:update", "spectraRuns:hideTab", "spectraRuns:selectTab", "spectraRuns:hideResultCard", "spectraRuns:keepResultCard"],
    reach: gap("These change how the user's own chat list looks. No AI command exists for them yet."),
  },
  {
    id: "conversation.continuation",
    area: "conversation",
    title: "Continue the current conversation",
    description: "Choose whether new messages continue the current conversation or start a new one. Pass {patch: {ai: {continueCurrentConversation: true or false}}}.",
    keywords: ["new chat", "keep going", "same thread"],
    ui: ["app.chat.continue", "app.settings.toggle-continuation"],
    reach: tool("change_settings", { appCommand: "change_spectra_settings", example: { patch: { ai: { continueCurrentConversation: true } } } }),
  },
  {
    id: "conversation.stop",
    area: "conversation",
    title: "Stop Spectra",
    description: "Stop the run in progress.",
    ui: ["app.run.stop"],
    server: ["spectraRuns:stopRun"],
    reach: user("Stop is the user's control over Spectra. Spectra ends its own turn by replying."),
  },
  {
    id: "conversation.stop_following",
    area: "conversation",
    title: "Stop following Spectra",
    description: "Stop the view from following where Spectra works.",
    ui: ["app.follow.stop"],
    reach: user("Follow is the user's view of Spectra's work, so only the user leaves it."),
  },
  {
    id: "conversation.answer",
    area: "conversation",
    title: "Answer Spectra or approve a change",
    description: "Answer a question Spectra asked, or approve or reject a change it proposed.",
    server: ["spectraHarness:answer", "spectraRuns:claimConfirmation", "spectraRuns:rejectConfirmation", "spectraRuns:reviseConfirmation"],
    reach: user("An answer or an approval is the user's decision about Spectra's work."),
  },
  {
    id: "conversation.review_ai_edit",
    area: "conversation",
    title: "Review or undo Spectra's changes",
    description: "Dismiss an AI edit or revert what a Spectra run changed.",
    server: ["spectraArtifacts:dismissAiEdit", "changeGroups:revertPlanForRun"],
    reach: user("Reviewing and reverting Spectra's work is the user's control over it."),
  },

  // Work
  {
    id: "work.create",
    area: "work",
    title: "Create work",
    description: "Create a document, presentation, sheet, quiz, flashcard deck, planner, timetable, whiteboard, code or agent.",
    keywords: ["new", "make", "write", "build", "artifact"],
    server: ["spectraArtifacts:create"],
    reach: tool("create_artifact"),
  },
  {
    id: "work.edit",
    area: "work",
    title: "Edit work",
    description: "Change the content of any work: text, slides, cells, questions, cards, tasks, board objects, files. Every editor command that changes content is reached this way.",
    keywords: ["change", "format", "insert", "fix", "rewrite", "update"],
    reach: tool("edit_artifact"),
  },
  {
    id: "work.read",
    area: "work",
    title: "Read work",
    description: "Read the content of a work item.",
    keywords: ["open", "look at", "check"],
    reach: tool("read_artifact"),
  },
  {
    id: "work.search",
    area: "work",
    title: "Search everything",
    description: "Search work, conversations, calendar events, school records and memory by meaning.",
    keywords: ["find", "look up", "where is"],
    server: ["semantic:search", "semantic:related"],
    reach: tool("search", { example: { query: "cell biology" } }),
  },
  {
    id: "work.insert_reference",
    area: "work",
    title: "Insert a live reference",
    description: "Insert a live reference to one work inside another (hostWorkId, targetWorkId, label?).",
    keywords: ["link", "embed", "cite", "connect"],
    ui: ["app.reference.insert"],
    server: ["spectraArtifactLinks:create", "spectraArtifactLinks:remove"],
    reach: tool("insert_reference", { appCommand: "insert_reference", example: { hostWorkId: "wx1", targetWorkId: "wx2" } }),
  },
  {
    id: "work.pick_reference",
    area: "work",
    title: "Pick a reference target",
    description: "Start picking a place in the open work to reference.",
    ui: ["app.reference.begin-picking"],
    reach: user("Picking is a pointer gesture in the user's editor. Spectra inserts a reference by id with work.insert_reference."),
  },
  {
    id: "work.embeds",
    area: "work",
    title: "Place or refresh a living embed",
    description: "Embed live work in other work, update or remove embeds.",
    server: ["artifactEmbeds:*", "artifactEmbedPlacementActions:refresh"],
    reach: gap("Living embeds are placed from the editor. An AI path for embeds is not built yet."),
  },
  {
    id: "work.versions",
    area: "work",
    title: "Save or restore a version",
    description: "Name a checkpoint of a work item or restore an earlier version.",
    keywords: ["history", "checkpoint", "undo", "restore"],
    server: ["changeGroups:createNamedCheckpoint", "changeGroups:commitRestore"],
    reach: gap("Spectra changes work forward with edit_artifact; restoring a named version has no AI command yet."),
  },
  {
    id: "work.request_access",
    area: "work",
    title: "Ask for access",
    description: "Ask the owner for access to work, or answer such a request.",
    server: ["artifactAccessRequests:*"],
    reach: user("Asking for and granting access happens between people, under their own names."),
  },
  {
    id: "work.publish_runtime",
    area: "work",
    title: "Publish a code runtime",
    description: "Publish or unpublish the live build of a code work.",
    server: ["spectraRuntimeBuilds:*"],
    reach: gap("Publishing puts a build in front of other people. Spectra has no publish command yet."),
  },

  // Library
  {
    id: "library.organize",
    area: "library",
    title: "Organize the library",
    description: "Create a folder, rename, move or add a shortcut to items in the library.",
    keywords: ["folder", "rename", "move", "tidy", "sort", "shortcut"],
    ui: ["app.library.organize"],
    server: ["orgTree:createFolder", "orgTree:rename", "orgTree:move", "orgTree:createReference", "orgTree:placeWork", "orgTree:removeFromWorkspace"],
    reach: tool("organize_library", { appCommand: "organize_library", example: { action: "create_folder", name: "Biology" } }),
  },
  {
    id: "library.trash",
    area: "library",
    title: "Move to the Trash",
    description: "Move work or folders to the Trash, where the user can restore them.",
    keywords: ["delete", "remove", "bin", "get rid of"],
    ui: ["app.library.delete"],
    server: ["orgTree:trash", "spectraArtifacts:archive", "spectraArtifactWrites:archive", "spectraWorkspaces:archive"],
    reach: tool("move_to_trash", { appCommand: "delete_library_items", example: { targetIds: ["n1"] } }),
  },
  {
    id: "library.restore",
    area: "library",
    title: "Restore from the Trash",
    description: "Bring items back from the Trash.",
    server: ["orgTree:restore"],
    reach: gap("No AI command restores from the Trash yet."),
  },
  {
    id: "library.delete_forever",
    area: "library",
    title: "Delete permanently",
    description: "Empty the Trash or delete work and workspaces for good.",
    server: ["orgTree:purge", "spectraArtifacts:permanentlyDelete", "spectraWorkspaces:permanentlyDelete", "spectraArtifactDeletion:*"],
    reach: user("Spectra never deletes permanently. It moves things to the Trash, and the user empties it."),
  },
  {
    id: "library.pin",
    area: "library",
    title: "Pin in the library",
    description: "Pin or unpin items and their sources.",
    server: ["orgTree:setPinned", "orgTree:pinSources"],
    reach: gap("Pinning arranges the user's own view of the library. No AI command exists for it yet."),
  },
  {
    id: "library.workspaces",
    area: "library",
    title: "Create or rename a workspace",
    description: "Create a workspace or change its name and details.",
    server: ["spectraWorkspaces:create", "spectraWorkspaces:update"],
    reach: gap("Spectra creates folders with organize_library. A workspace command for the AI is not built yet."),
  },
  {
    id: "library.import",
    area: "library",
    title: "Import files",
    description: "Import a file or a workspace package from the user's device.",
    keywords: ["upload", "add file"],
    ui: ["app.library.import", "app.workspace.import"],
    server: ["artifactImports:*", "spectraWorkspaces:importPortableManifest", "spectraArtifacts:createImportedResource"],
    reach: user("Files come from the browser's file picker, which only the user can open."),
  },
  {
    id: "library.sync_policy",
    area: "library",
    title: "Change how items sync",
    description: "Change where items are stored and how they sync with the user's computer: preset, contentDirection, discovery, structure, cloudContent, timing, protectedOriginal, includeGlobs, excludeGlobs.",
    keywords: ["storage", "sync", "offline", "device", "mirror"],
    ui: ["app.sync.policy.change"],
    server: ["syncPolicy:*"],
    reach: tool("change_sync_policy", { appCommand: "change_sync_policy", example: { targetIds: ["n1"], patch: { timing: "manual" } } }),
  },

  // Comments
  {
    id: "comments.add",
    area: "comments",
    title: "Add a comment",
    description: "Leave a comment on a work item, on one region or the whole item.",
    keywords: ["feedback", "note", "annotate", "review"],
    ui: ["app.comments.add"],
    server: ["artifactComments:create"],
    reach: tool("add_comment", { appCommand: "add_comment", example: { artifactId: "wx1", body: "Cite this claim." } }),
  },
  {
    id: "comments.open",
    area: "comments",
    title: "Open comments",
    description: "Show the comments panel of the open work.",
    ui: ["app.comments.open"],
    reach: user("It only shows a panel in the user's editor. Spectra reads work with read_artifact."),
  },
  {
    id: "comments.manage",
    area: "comments",
    title: "Edit, resolve or delete comments",
    description: "Edit a comment, resolve it, move its anchor or delete it.",
    server: ["artifactComments:updateBody", "artifactComments:setResolved", "artifactComments:reanchor", "artifactComments:remove"],
    reach: gap("Spectra adds comments; changing existing ones has no AI command yet."),
  },
  {
    id: "comments.notifications",
    area: "comments",
    title: "Comment notifications",
    description: "Mark comment notifications read or choose which ones arrive.",
    server: ["artifactComments:setNotificationPreference", "artifactComments:markNotificationsRead"],
    reach: user("Notifications record what the user has seen and wants to see."),
  },

  // Settings
  {
    id: "settings.change",
    area: "settings",
    title: "Change settings",
    description: "Change appearance (theme, density, text size, contrast, motion), general, AI, writing, notifications, privacy or accessibility settings.",
    keywords: ["dark mode", "light mode", "theme", "preferences", "font size", "compact"],
    ui: ["app.settings.change"],
    server: ["accountPreferences:writeLayer"],
    reach: tool("change_settings", { appCommand: "change_spectra_settings", example: { patch: { appearance: { theme: "dark" } } } }),
  },
  {
    id: "settings.clear_cache",
    area: "settings",
    title: "Clear the local compute cache",
    description: "Clear the cache this browser keeps for running code and previews.",
    ui: ["app.settings.clear-compute-cache"],
    reach: user("The cache lives in the user's browser. Spectra works on the server and cannot reach it."),
  },

  // Permissions
  {
    id: "permissions.ai",
    area: "permissions",
    title: "Change Spectra AI permissions",
    description: "Choose Ask, Always allow or Never per category, or give Spectra full control.",
    keywords: ["full control", "always allow", "approval"],
    ui: ["app.security.authority-mode"],
    reach: user(PERMISSION_REASON),
  },
  {
    id: "permissions.credentials",
    area: "permissions",
    title: "Change sign-in and credentials",
    description: "Change passwords, sign-in methods or stored secrets.",
    ui: ["app.security.credentials"],
    server: ["secretBridge:write", "secretBridge:revoke", "secretBridge:eraseDeletedIdentity"],
    reach: user("Credentials are never handled by Spectra AI."),
  },
  {
    id: "permissions.delete_account",
    area: "permissions",
    title: "Delete the account",
    description: "Delete the user's Spectra account.",
    ui: ["app.security.delete-account"],
    reach: user("Deleting an account is never done by Spectra AI."),
  },

  // Calendar
  {
    id: "calendar.add_event",
    area: "calendar",
    title: "Add a calendar event",
    description: "Add a personal event to the calendar: title, start, end?, allDay?, notes?.",
    keywords: ["schedule", "meeting", "appointment", "remind", "book"],
    server: ["calendar:createPersonalItem"],
    reach: tool("calendar", { fixed: { action: "add_event" }, appCommand: "create_calendar_personal_event", example: { title: "Dentist", start: "2026-10-06T09:00" } }),
  },
  {
    id: "calendar.schedule_task",
    area: "calendar",
    title: "Schedule a task",
    description: "Put a work block for a planner task on the calendar: taskId, start, end.",
    keywords: ["plan", "block time", "study session"],
    server: ["calendar:scheduleTask"],
    reach: tool("calendar", { fixed: { action: "schedule_task" }, appCommand: "schedule_calendar_task", example: { taskId: "wx1", start: "2026-10-06T16:00", end: "2026-10-06T17:00" } }),
  },
  {
    id: "calendar.move_block",
    area: "calendar",
    title: "Move a work block",
    description: "Move a scheduled work block: itemId, start, end?, expectedRevision.",
    keywords: ["reschedule", "drag"],
    server: ["calendar:moveWorkBlock"],
    reach: tool("calendar", { fixed: { action: "move_block" }, appCommand: "move_calendar_block", example: { itemId: "b1", start: "2026-10-07T16:00", expectedRevision: 1 } }),
  },
  {
    id: "calendar.resize_block",
    area: "calendar",
    title: "Resize a work block",
    description: "Change when a scheduled work block ends: itemId, end, expectedRevision.",
    keywords: ["longer", "shorter", "extend"],
    server: ["calendar:resizeWorkBlock"],
    reach: tool("calendar", { fixed: { action: "resize_block" }, appCommand: "resize_calendar_block", example: { itemId: "b1", end: "2026-10-07T18:00", expectedRevision: 1 } }),
  },
  {
    id: "calendar.complete_or_remove",
    area: "calendar",
    title: "Complete a block or remove an event",
    description: "Mark a work block done, or remove a personal event.",
    server: ["calendar:completeWorkBlock", "calendar:removePersonalItem"],
    reach: gap("Not on the AI's server command path yet."),
  },

  // Reminders
  {
    id: "reminders.mark_read",
    area: "reminders",
    title: "Mark reminders read",
    description: "Mark planner and timetable reminders as read.",
    server: ["plannerReminders:markRead", "timetableReminders:markRead"],
    reach: user("Marking a reminder read records that the user saw it."),
  },

  // Devices: Spectra Bridge on the user's computers
  {
    id: "devices.status",
    area: "devices",
    title: "Check devices",
    description: "Read the user's computers connected through Spectra Bridge: each one's state, folders, last sync and any problem, with ids for the other device actions.",
    keywords: ["bridge", "computer", "desktop", "laptop", "sync status", "folders", "is my computer connected", "explain a problem"],
    reach: tool("devices", { fixed: { action: "status" }, appCommand: "read_devices", example: {} }),
  },
  {
    id: "devices.pair",
    area: "devices",
    title: "Connect this computer",
    description: "Connect the user's computer to Spectra through Spectra Bridge. Spectra offers the download if Bridge is missing; the user confirms a code on the computer.",
    keywords: ["pair", "bridge", "set up", "install", "connect my computer", "local files", "desktop files"],
    ui: ["app.devices.pair"],
    server: ["bridge:requestPairing"],
    reach: tool("devices", { fixed: { action: "pair" }, appCommand: "pair_device", example: {} }),
  },
  {
    id: "devices.add_folder",
    area: "devices",
    title: "Add a folder",
    description: "Open the folder picker on the user's computer so they choose a folder to use in Spectra.",
    keywords: ["sync a folder", "choose folder", "select location", "bridge folder"],
    ui: ["app.devices.add-folder"],
    reach: tool("devices", { fixed: { action: "add_folder" }, appCommand: "control_device", example: {} }),
  },
  {
    id: "devices.retry_folder",
    area: "devices",
    title: "Retry a folder",
    description: "Try a folder that stopped syncing again (grantId from devices status).",
    keywords: ["fix folder", "folder unavailable", "resync"],
    reach: tool("devices", { fixed: { action: "retry_folder" }, appCommand: "control_device", example: { grantId: "grant_1" } }),
  },
  {
    id: "devices.pause_folder",
    area: "devices",
    title: "Pause or resume a folder",
    description: "Pause syncing for one folder, or resume it (grantId from devices status).",
    keywords: ["stop syncing folder", "resume folder"],
    reach: tool("devices", { fixed: { action: "pause_folder" }, appCommand: "control_device", example: { grantId: "grant_1" } }),
  },
  {
    id: "devices.remove_folder",
    area: "devices",
    title: "Remove a folder",
    description: "Stop using a folder in Spectra. Its files stay on the computer.",
    keywords: ["unsync folder", "forget folder"],
    reach: tool("devices", { fixed: { action: "remove_folder" }, appCommand: "control_device", example: { grantId: "grant_1" } }),
  },
  {
    id: "devices.pause",
    area: "devices",
    title: "Pause or resume syncing",
    description: "Pause syncing for every folder on the user's computer, or resume it.",
    keywords: ["stop syncing", "resume syncing", "pause bridge"],
    ui: ["app.devices.pause"],
    reach: tool("devices", { fixed: { action: "pause_syncing" }, appCommand: "control_device", example: {} }),
  },
  {
    id: "devices.show_logs",
    area: "devices",
    title: "Show Bridge logs",
    description: "Open Spectra Bridge's log file on the user's computer, to see what went wrong.",
    keywords: ["logs", "diagnose bridge", "what happened"],
    reach: tool("devices", { fixed: { action: "show_logs" }, appCommand: "control_device", example: {} }),
  },
  {
    id: "devices.update",
    area: "devices",
    title: "Update Spectra Bridge",
    description: "Install the new version of Spectra Bridge on the user's computer when one is ready.",
    keywords: ["upgrade bridge", "out of date"],
    reach: tool("devices", { fixed: { action: "update" }, appCommand: "control_device", example: {} }),
  },
  {
    id: "devices.remove",
    area: "devices",
    title: "Remove a device",
    description: "Unpair one of the user's computers (deviceId from devices status) and stop its syncing. Files on that computer stay.",
    keywords: ["unpair", "disconnect computer", "forget device", "revoke"],
    server: ["bridge:revokeDevice"],
    reach: tool("devices", { fixed: { action: "remove_device" }, appCommand: "remove_device", example: { deviceId: "d1" } }),
  },
  {
    id: "devices.native_writes",
    area: "devices",
    title: "Change native writes",
    description: "Choose when Spectra may write back to desktop files: always, ask first, or never.",
    keywords: ["write back", "desktop files", "bridge trust"],
    reach: user(PERMISSION_REASON),
  },
  {
    id: "devices.conflicts",
    area: "devices",
    title: "Resolve a desktop file conflict",
    description: "Choose which version of a changed desktop file to keep.",
    server: ["replicas:resolveExternalConflict", "replicas:applyProtectedPending", "replicas:discardProtectedPending", "replicas:forkProtectedPending"],
    reach: user("Choosing which version of a file on the user's computer survives is the user's decision."),
  },

  // Connections
  {
    id: "connections.providers",
    area: "connections",
    title: "Connect an account",
    description: "Connect or disconnect an outside service.",
    ui: ["app.providers.connect"],
    server: ["managebac:configure", "managebac:disconnect"],
    reach: user("Connecting a service goes through its own sign-in, which only the user completes."),
  },

  // Sharing
  {
    id: "sharing.change",
    area: "sharing",
    title: "Share work",
    description: "Invite someone to view or edit work, change their access or remove it.",
    keywords: ["invite", "access", "collaborate", "permission"],
    ui: ["app.sharing.change"],
    server: ["authority:invite", "authority:changeAcceptedLevel", "authority:revoke"],
    reach: tool("share", { appCommand: "change_sharing", example: { action: "invite", resourceType: "artifact", resourceId: "wx1", subjectId: "acct2", level: "read" } }),
  },
  {
    id: "sharing.respond",
    area: "sharing",
    title: "Accept or decline a share",
    description: "Accept or decline work someone shared.",
    server: ["authority:acceptShareInvitation", "authority:declineShareInvitation", "memberships:acceptInvitation"],
    reach: user("Accepting access is the recipient's own decision."),
  },
  {
    id: "sharing.links_and_exceptions",
    area: "sharing",
    title: "Public links and access exceptions",
    description: "Create or revoke a public link, withdraw a pending invitation, or set a per-work access exception.",
    server: ["authority:createPublicLink", "authority:revokePublicLink", "authority:revokePendingInvitation", "authority:setArtifactException", "authority:clearArtifactException"],
    reach: gap("Spectra changes sharing through the share tool. These finer controls have no AI command yet."),
  },

  // ManageBac
  {
    id: "managebac.sync",
    area: "managebac",
    title: "Sync ManageBac",
    description: "Refresh school records from ManageBac: deadlines, class resources, timetable, classes or CAS.",
    keywords: ["school", "refresh", "deadlines", "update"],
    ui: ["app.managebac.sync"],
    server: ["managebac:requestAiRefresh"],
    reach: tool("managebac", { fixed: { action: "sync" }, appCommand: "trigger_managebac_sync", example: { purpose: "upcoming_deadlines" } }),
  },
  {
    id: "managebac.select_classes",
    area: "managebac",
    title: "Choose ManageBac classes",
    description: "Choose which ManageBac classes sync into Spectra.",
    keywords: ["subjects", "courses"],
    ui: ["app.managebac.select-classes"],
    server: ["managebac:setSelectedClasses"],
    reach: tool("managebac", { fixed: { action: "select_classes" }, appCommand: "select_managebac_classes", example: { classIds: ["c1"] } }),
  },
  {
    id: "managebac.import_resource",
    area: "managebac",
    title: "Import a school resource",
    description: "Import a resource from a ManageBac class shelf into the library.",
    ui: ["app.managebac.import-resource"],
    server: ["managebac:beginResourceImport"],
    reach: user("Import a resource from the class shelf. The school route checks the provider identity and keeps a receipt."),
  },
  {
    id: "managebac.mapping",
    area: "managebac",
    title: "Change ManageBac mapping",
    description: "Change how ManageBac records and periods map into Spectra.",
    ui: ["app.managebac.mapping"],
    server: ["managebac:upsertCalendarPeriodMap", "managebac:removeCalendarPeriodMap", "managebac:setOverlay", "managebac:resolveConflict"],
    reach: user("Mapping changes use the dedicated school flow, where the user checks each record."),
  },
  {
    id: "managebac.class_workspaces",
    area: "managebac",
    title: "Class workspaces",
    description: "Create, release or remove the workspaces made for ManageBac classes.",
    server: ["managebac:materializeClassWorkspaces", "managebac:purgeAutoCreatedClassWorkspaces", "managebac:releaseClassWorkspaces"],
    reach: gap("No AI command manages class workspaces yet."),
  },
  {
    id: "managebac.sync_preferences",
    area: "managebac",
    title: "School sync preferences",
    description: "Choose, per kind of school record and per class, whether ManageBac syncs automatically, on demand or not at all.",
    keywords: ["school", "sync", "automatic", "manual", "off"],
    server: ["school:setMode", "school:setClassOverride"],
    reach: gap("What syncs from school is the student's own setting on the School page; no AI command changes it yet."),
  },
  {
    id: "managebac.sync_now",
    area: "managebac",
    title: "Sync school records now",
    description: "Sync chosen kinds of school records from ManageBac now.",
    server: ["school:syncNow"],
    reach: user("The School page's Sync now button. Spectra refreshes the same records through Sync ManageBac."),
  },
  {
    id: "managebac.school_files",
    area: "managebac",
    title: "School files",
    description: "Remove a dropbox or task file kept from ManageBac.",
    server: ["school:removeSchoolFile"],
    reach: user("Removing a kept school file is the student's choice on the School page."),
  },
  {
    id: "managebac.cas",
    area: "managebac",
    title: "CAS reflections and evidence",
    description: "Write or delete a CAS reflection, set its learning outcomes, or attach evidence.",
    keywords: ["cas", "creativity", "activity", "service", "reflection"],
    server: ["school:saveCasReflection", "school:deleteCasReflection", "school:setCasOutcomes", "school:beginCasEvidenceUpload", "school:attachCasEvidence"],
    reach: user("CAS reflections must be the student's own words under IB rules. Spectra can help think one through in a document, but only the student saves it."),
  },

  // Memory
  {
    id: "memory.remember",
    area: "memory",
    title: "Remember something",
    description: "Save or correct something lasting about the user.",
    keywords: ["note", "keep in mind", "preference"],
    ui: ["app.memory.write"],
    server: ["memory:remember", "memory:correct"],
    reach: tool("remember", { appCommand: "write_memory", example: { content: "Prefers short answers." } }),
  },
  {
    id: "memory.manage",
    area: "memory",
    title: "Forget or dispute memories",
    description: "Forget a memory, clear all of them, dispute one or change memory settings.",
    server: ["memory:forget", "memory:clearAll", "memory:setDisputed", "memory:updatePreferences"],
    reach: user("What Spectra may keep about the user is the user's choice."),
  },

  // Agents
  {
    id: "agents.use",
    area: "agents",
    title: "Hand a request to an agent",
    description: "Pass the request to one of the user's specialist agents.",
    reach: tool("use_agent"),
  },
  {
    id: "agents.manage",
    area: "agents",
    title: "Publish, follow or improve agents",
    description: "Publish or release an agent, follow one, rate it or accept an improvement.",
    server: ["agents:*", "spectraArtifacts:publishAgent", "spectraArtifacts:manageAgentRelease", "spectraArtifacts:addPublicAgent"],
    reach: user("Releasing an agent to others and judging its work are the owner's decisions. Spectra builds agents as work with create_artifact and edit_artifact."),
  },

  // Study
  {
    id: "study.practice",
    area: "study",
    title: "Practise a quiz or deck",
    description: "Answer quiz questions, submit an attempt or review flashcards.",
    server: ["quizPractice:*", "flashcardStudy:*"],
    reach: user("These are the learner's own answers. Spectra answering them would fake the learner's progress."),
  },

  // School
  {
    id: "school.administration",
    area: "school",
    title: "School administration",
    description: "School profile, members, groups, announcements, feedback, incidents, limits and data requests.",
    server: ["administration:*", "schools:*", "memberships:invite", "metering:setLimitPolicy"],
    reach: user("School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account."),
  },
];

/**
 * Public Convex functions that are not user actions: protocols, the AI's own
 * run machinery, uploads and housekeeping. Each says why.
 */
export const SERVER_PLUMBING: Readonly<Record<string, string>> = {
  "artifactAssets:*": "Upload protocol for work assets.",
  "artifactContent:*": "Upload protocol for work content.",
  "artifactIntakeActions:*": "Upload verification.",
  "artifactUserStates:*": "Per-user view state the editors save as they are used.",
  "bridge:confirmPairing": "Spectra Bridge device protocol.",
  "bridge:resumePairing": "Spectra Bridge device protocol.",
  "bridge:reportHealth": "Spectra Bridge device protocol.",
  "bridge:registerMount": "Spectra Bridge device protocol.",
  "bridgeStructure:*": "Spectra Bridge device protocol.",
  "bridgeSync:*": "Spectra Bridge device protocol.",
  "calendar:ensureLegacyMigration": "One-time data migration.",
  "changeGroups:commitCurrent": "Saves edit history as the editors write.",
  "changeGroups:commitImport": "Saves edit history for imports.",
  "changeGroups:reconcileImports": "Saves edit history for imports.",
  "changeGroups:checkpointBeforeAi": "The checkpoint taken before Spectra edits.",
  "collaboration:*": "Live collaboration rooms.",
  "collaborationGatewayBridge:*": "Live collaboration gateway.",
  "identity:*": "Sign-in bookkeeping.",
  "localStudentRehearsal:*": "Local-only rehearsal fixtures for development.",
  "managebac:replaceCapabilityManifest": "ManageBac sync protocol.",
  "managebac:claimScheduledSync": "ManageBac sync protocol.",
  "managebac:connectorContext": "ManageBac sync protocol.",
  "managebac:beginSync": "ManageBac sync protocol.",
  "managebac:commitIdentityResolution": "ManageBac sync protocol.",
  "managebac:commitNormalizedPage": "ManageBac sync protocol.",
  "managebac:commitQuarantine": "ManageBac sync protocol.",
  "managebac:failSync": "ManageBac sync protocol.",
  "managebac:suspendSync": "ManageBac sync protocol.",
  "managebac:completeSync": "ManageBac sync protocol.",
  "managebac:migrateSourceIdentityKeys": "One-time data migration.",
  "managebac:attachResourceImportArtifact": "Steps of a resource import the user started.",
  "managebac:completeResourceImport": "Steps of a resource import the user started.",
  "managebac:failResourceImport": "Steps of a resource import the user started.",
  "managebac:beginSchoolFileFetch": "Steps of a school file fetch the School sync started.",
  "managebac:attachSchoolFile": "Steps of a school file fetch the School sync started.",
  "managebac:failSchoolFileFetch": "Steps of a school file fetch the School sync started.",
  "memory:contextForRun": "Spectra's own run machinery.",
  "memory:recordRetrieval": "Spectra's own run machinery.",
  "memory:captureExplicitSignal": "Spectra's own run machinery.",
  "operatorSessions:*": "Platform operator sessions.",
  "orgTree:ensureAccountRoots": "Creates the account's library roots on first use.",
  "payloads:*": "Upload protocol.",
  "regionClaims:*": "Editing presence between collaborators.",
  "replicas:*": "Spectra Bridge replica protocol.",
  "secretBridge:read": "Server-side secret access for connectors.",
  "secretBridge:useForSchoolConnector": "Server-side secret access for connectors.",
  "secretBridge:status": "Server-side secret access for connectors.",
  "spectraApplicationWrites:*": "Spectra AI's own path to the commands in this catalog.",
  "spectraArtifactWrites:preparePlan": "Spectra's own run machinery.",
  "spectraArtifacts:createPending": "Spectra's own run machinery.",
  "spectraArtifacts:finalizePendingLive": "Spectra's own run machinery.",
  "spectraArtifacts:pausePendingForConflict": "Spectra's own run machinery.",
  "spectraArtifacts:patchPendingContent": "Spectra's own run machinery.",
  "spectraArtifacts:updateAiEffect": "Spectra's own run machinery.",
  "spectraArtifacts:stageAiPatch": "Spectra's own run machinery.",
  "spectraArtifacts:attachResearchEvidence": "Spectra's own run machinery.",
  "spectraArtifacts:discardPendingForRun": "Spectra's own run machinery.",
  "spectraArtifacts:pausePendingForApproval": "Spectra's own run machinery.",
  "spectraArtifacts:failPendingForRun": "Spectra's own run machinery.",
  "spectraArtifacts:settleStagedForRun": "Spectra's own run machinery.",
  "spectraArtifacts:markAiState": "Spectra's own run machinery.",
  "spectraArtifacts:ensurePersonalTimetable": "Creates the personal timetable on first use.",
  "spectraHarness:saveCheckpoint": "Spectra's own run machinery.",
  "spectraHarness:recordToolOperations": "Spectra's own run machinery.",
  "spectraHarness:queueSteer": "Delivers a message the user sent while Spectra worked.",
  "spectraHarness:ensureApproved": "Spectra's own run machinery.",
  "spectraHarness:handoff": "Spectra's own run machinery.",
  "spectraOperations:*": "Spectra's own operation journal.",
  "spectraRunContinuations:*": "Spectra's own run machinery.",
  "spectraRuns:recordAuthorityDecision": "Spectra's own run machinery.",
  "spectraRuns:scheduleExecution": "Spectra's own run machinery.",
  "spectraRuns:updateStatus": "Spectra's own run machinery.",
  "spectraRuns:appendEvent": "Spectra's own run machinery.",
  "spectraRuns:appendEvents": "Spectra's own run machinery.",
  "spectraRuns:claimExecution": "Spectra's own run machinery.",
  "spectraRuns:heartbeat": "Spectra's own run machinery.",
  "spectraRuns:markTraceDegraded": "Spectra's own run machinery.",
  "spectraRuns:setSuggestedThreadMetadata": "Spectra's own run machinery.",
  "spectraRuns:patchResultCard": "Spectra's own run machinery.",
  "spectraRuns:resetForRetry": "Spectra's own run machinery.",
  "spectraRuns:setAgentRouting": "Spectra's own run machinery.",
  "spectraRuns:clearRetainedAgent": "Spectra's own run machinery.",
  "spectraRuns:setContextSnapshot": "Spectra's own run machinery.",
  "spectraRuns:setResearchEvidence": "Spectra's own run machinery.",
  "spectraRuns:beginRunAttachmentUpload": "Upload protocol for message attachments.",
  "spectraThreads:applyGeneratedMetadata": "Spectra's own run machinery.",
  "spectraThreads:createFromRun": "Spectra's own run machinery.",
  "spectraWorkspaces:createPending": "Spectra's own run machinery.",
  "spectraWorkspaces:finalizePending": "Spectra's own run machinery.",
  "spectraWorkspaces:pauseForApproval": "Spectra's own run machinery.",
  "spectraWorkspaces:resumePending": "Spectra's own run machinery.",
  "spectraWorkspaces:stageAiPatch": "Spectra's own run machinery.",
  "spectraWorkspaces:settleForRun": "Spectra's own run machinery.",
};

const BY_ID = new Map(COMMAND_CATALOG.map((command) => [command.id, command]));

export function catalogCommand(id: string): CatalogCommand | undefined {
  return BY_ID.get(id);
}

/** The catalog entry an app command (a button, a menu item, the command bar) runs. */
export function catalogCommandForApp(appCommandId: string): CatalogCommand | undefined {
  return COMMAND_CATALOG.find((command) => command.ui?.includes(appCommandId as `app.${string}`));
}

/** The catalog entry behind a server application command the AI sends. */
export function catalogCommandForApplicationCommand(command: string): CatalogCommand | undefined {
  return COMMAND_CATALOG.find((entry) => entry.reach.kind === "tool" && entry.reach.appCommand === command);
}

/**
 * Whether Spectra AI may run an app command, and why not. An app command with
 * no catalog entry is treated as prohibited, and the parity test fails on it.
 */
export function aiAuthorityForApp(appCommandId: string):
  | { aiAuthority: "allowed" }
  | { aiAuthority: "prohibited"; prohibitionReason: string } {
  const entry = catalogCommandForApp(appCommandId);
  if (!entry) return { aiAuthority: "prohibited", prohibitionReason: "This command is not in Spectra's command catalog." };
  return entry.reach.kind === "tool"
    ? { aiAuthority: "allowed" }
    : { aiAuthority: "prohibited", prohibitionReason: entry.reach.reason };
}

/** True when a public Convex function is covered by the catalog or the plumbing list. */
export function serverFunctionCoverage(name: string): { kind: "command"; id: string } | { kind: "plumbing"; reason: string } | null {
  const [moduleName] = name.split(":");
  const wildcard = `${moduleName}:*`;
  const entry = COMMAND_CATALOG.find((command) => command.server?.includes(name) || command.server?.includes(wildcard));
  if (entry) return { kind: "command", id: entry.id };
  const reason = SERVER_PLUMBING[name] ?? SERVER_PLUMBING[wildcard];
  return reason ? { kind: "plumbing", reason } : null;
}

/*
 * Editor commands (the artifact capabilities behind each studio's bar). Every
 * one that changes content is reached with edit_artifact, which writes the
 * whole authoring format of the type. The rest are only the user's; these
 * rules name which and why. They run in order and the first match wins.
 */
const ARTIFACT_RULES: ReadonlyArray<{ match: RegExp; reach: AiReach }> = [
  { match: /\.(undo|redo)$|\.history\.(undo|redo)$/, reach: user("Undo and redo step through the user's own edit history. Spectra changes work forward with edit_artifact.") },
  { match: /\.(export|print|download)(\.|$)|\.export\.|\.print$/, reach: user("Exporting saves a copy to the user's device, which only the user's browser can do.") },
  { match: /\.import(\.|$)|\.files\.open$|\.add\.image$/, reach: user("Files come from the browser's file picker, which only the user can open.") },
  { match: /\.(present|presenter)(\.|$)|\.present$|\.rehearse$/, reach: user("Presenting is the user's own live performance.") },
  { match: /\.attempt\.|\.study\.|\.runtime\.interact$/, reach: user("These are the learner's own answers and study. Spectra doing them would fake the learner's progress.") },
  { match: /\.(publish|unpublish|private)$/, reach: gap("Publishing puts work in front of other people. Spectra has no publish command yet.") },
  { match: /\.clipboard\.|\.copyStyle$/, reach: user("It uses the user's clipboard.") },
  { match: /\.protect\.sheet$/, reach: user("Protection guards a sheet against edits, including Spectra's, so only the user sets it.") },
  {
    match: /^whiteboard\.fit$|^sheets\.format$|\.(view|zoom|navigate\.(find|outline)|layout\.(focus|pageCanvas|previewReader)|panel|tool\.(select|hand)|stage\.(guides|grid)|accessibility\.readingOrder|transition\.native)(\.|$)|\.(pages|rail|files|questions|question\.details|cohort|attempts|preview|build|settings|progress|filters|find|today|previous|next|calendars|dismissed|competence|brief|refresh|browse|notes\.panel|comments|spellcheck|outline|sources\.open|design\.open|design\.audit|library|explain|trace|summary|history|pivot|native|show|inspector|slidePreviews|notesPage|sources)$/,
    reach: user("It changes only what the user sees, not the work. Spectra reads work with read_artifact and shows it with open_in_spectra."),
  },
];

const EDIT_REACH: AiReach = { kind: "tool", tool: "edit_artifact" };

/** How Spectra AI reaches one editor command. */
export function artifactCapabilityReach(capabilityId: string): AiReach {
  return ARTIFACT_RULES.find((rule) => rule.match.test(capabilityId))?.reach ?? EDIT_REACH;
}
