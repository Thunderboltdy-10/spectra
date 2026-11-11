/*
 * Every user-facing action in Spectra, registered once, with how Spectra AI
 * reaches it.
 *
 * - A "tool" action runs through a harness tool, the same server path the
 *   user's own control uses. The AI can find it with find_commands and run it
 *   with run_command; most also have a first-class tool.
 * - A "user" action is only the user's, with the reason written down.
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

const PERMISSION_REASON =
  "It changes what Spectra AI may do. Only the user changes that, in Settings, so the AI can never grant itself more.";

export const COMMAND_CATALOG: readonly CatalogCommand[] = [
  // Navigation
  {
    id: "navigation.open_library",
    area: "navigation",
    title: "Open Library",
    description: "Show the user's Library, the home of their workspaces and artifacts.",
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
    title: "Open an artifact",
    description: "Open a document, deck, sheet or other artifact for the user. It opens the artifact; the region Spectra edits shows through Follow.",
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
    description: "Show the specialist agents page, or one agent (targetId: the agent's id).",
    keywords: ["specialists", "go to"],
    ui: ["app.page.agents"],
    reach: tool("open_in_spectra", { fixed: { destination: "agents" }, appCommand: "navigate_spectra", example: {} }),
  },
  {
    id: "navigation.open_school",
    area: "navigation",
    title: "Open School",
    description: "Show school data and class shelves.",
    keywords: ["classes", "grades", "go to"],
    ui: ["app.page.school"],
    reach: tool("open_in_spectra", { fixed: { destination: "school" }, appCommand: "navigate_spectra", example: {} }),
  },
  {
    id: "navigation.open_analytics",
    area: "navigation",
    title: "Open Analytics",
    description: "Show learning analytics.",
    keywords: ["progress", "insights", "go to"],
    ui: ["app.page.analytics"],
    reach: tool("open_in_spectra", { fixed: { destination: "analytics" }, appCommand: "navigate_spectra", example: {} }),
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
    description: "Rename, pin, archive or restore a conversation in the chat list.",
    keywords: ["title", "chat", "archive", "pin"],
    server: ["spectraThreads:update"],
    reach: tool("manage_conversation", { appCommand: "manage_conversation", example: { title: "Biology revision" } }),
  },
  {
    id: "conversation.result_cards",
    area: "conversation",
    title: "Hide or keep result cards",
    description: "Hide, keep or switch between the result cards and tabs under a reply.",
    server: ["spectraRuns:hideTab", "spectraRuns:selectTab", "spectraRuns:hideResultCard", "spectraRuns:keepResultCard"],
    reach: user("These arrange what the user is looking at under a reply while they read it. Spectra's work is the same either way; the artifact itself stays in the library."),
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
    description: "Stop the view from following where Spectra artifacts.",
    ui: ["app.follow.stop"],
    reach: user("Follow is the user's view of Spectra's artifact, so only the user leaves it."),
  },
  {
    id: "conversation.answer",
    area: "conversation",
    title: "Answer Spectra or approve a change",
    description: "Answer a question Spectra asked, or approve or reject a change it proposed.",
    server: ["spectraHarness:answer", "spectraRuns:claimConfirmation", "spectraRuns:rejectConfirmation", "spectraRuns:reviseConfirmation"],
    reach: user("An answer or an approval is the user's decision about Spectra's artifact."),
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
    id: "conversation.undo_previous_run",
    area: "conversation",
    title: "Undo the previous Spectra run",
    description: "Reverse the preceding run in this thread using its saved state, preserving later human edits.",
    keywords: ["undo that", "revert", "previous change"],
    server: ["spectraRunUndo:reverseWrites"],
    reach: tool("undo_previous_run"),
  },

  {
    id: "work.create",
    area: "work",
    title: "Create artifact",
    description: "Create a document, presentation, sheet, quiz, flashcard deck, planner, timetable, whiteboard, code or agent.",
    keywords: ["new", "make", "write", "build", "artifact"],
    server: ["spectraArtifacts:create"],
    reach: tool("create_artifact"),
  },
  {
    id: "work.edit",
    area: "work",
    title: "Edit artifact",
    description: "Change the content of any artifact: text, slides, cells, questions, cards, tasks, board objects, files. Every editor command that changes content is reached this way.",
    keywords: ["change", "format", "insert", "fix", "rewrite", "update"],
    reach: tool("edit_artifact"),
  },
  {
    id: "work.read",
    area: "work",
    title: "Read artifact",
    description: "Read the content of an artifact.",
    keywords: ["open", "look at", "check"],
    reach: tool("read_artifact"),
  },
  {
    id: "work.search",
    area: "work",
    title: "Search everything",
    description: "Search artifact, conversations, calendar events, school records and memory by meaning.",
    keywords: ["find", "look up", "where is"],
    server: ["semantic:search", "semantic:related"],
    reach: tool("search", { example: { query: "cell biology" } }),
  },
  {
    id: "work.insert_reference",
    area: "work",
    title: "Insert a live reference",
      description: "Insert a live reference to one artifact inside another (hostWorkId, targetWorkId, label?, after?). In a document, after names a heading and places the reference at the end of that section, before the next heading.",
    keywords: ["link", "embed", "cite", "connect"],
    ui: ["app.reference.insert"],
    server: ["artifactEmbeds:create", "spectraArtifactLinks:create", "spectraArtifactLinks:remove"],
    reach: tool("insert_reference", { appCommand: "insert_reference", example: { hostWorkId: "wx1", targetWorkId: "wx2" } }),
  },
  {
    id: "work.pick_reference",
    area: "work",
    title: "Pick a reference target",
    description: "Start picking a place in the open artifact to reference.",
    ui: ["app.reference.begin-picking"],
    reach: user("Picking is a pointer gesture in the user's editor. Spectra inserts a reference by id with work.insert_reference."),
  },
  {
    id: "work.embeds",
    area: "work",
    title: "Read the embeds in an artifact",
    description: "See the live embeds inside an artifact: what each shows, where it sits, and whether it follows the live artifact or a pinned version.",
    keywords: ["embed", "reference", "linked artifact", "what does this include"],
    reach: tool("read_embeds", { example: { artifactId: "wx1" } }),
  },
  {
    id: "work.manage_embed",
    area: "work",
    title: "Change or remove an embed",
    description: "Resize a live embed, make it follow the live artifact or pin it to a version, check a pinned one again, or remove it from the artifact.",
    keywords: ["embed", "embedded", "reference", "pin", "unpin", "resize", "expand", "compact", "remove", "refresh"],
    server: ["artifactEmbeds:update", "artifactEmbeds:remove", "artifactEmbedPlacementActions:refresh"],
    reach: tool("manage_embed", { appCommand: "manage_embed", example: { artifactId: "wx1", embedId: "e1", action: "resize", mode: "expanded" } }),
  },
  {
    id: "work.show_in_reply",
    area: "work",
    title: "Show an artifact in the reply",
    description: "Place a live, usable artifact in Spectra's reply: a deck to study, a quiz to take, slides to step through.",
    keywords: ["show", "embed", "inline", "play", "study", "here", "in the chat"],
    server: ["artifactEmbeds:create"],
    reach: tool("show_work", { appCommand: "show_work", example: { artifactId: "wx1" } }),
  },
  {
    id: "work.save_version",
    area: "work",
    title: "Save a version",
    description: "Name a checkpoint of an artifact that the user can return to from its history.",
    keywords: ["history", "checkpoint", "snapshot", "keep"],
    server: ["changeGroups:createNamedCheckpoint"],
    reach: tool("save_version", { appCommand: "save_version", example: { artifactId: "wx1", name: "Before the rewrite" } }),
  },
  {
    id: "work.history",
    area: "work",
    title: "Read version history",
    description: "See an artifact's saved versions: when each was made, by whom, and its name.",
    keywords: ["history", "versions", "earlier", "changes", "who changed"],
    reach: tool("read_versions", { example: { artifactId: "wx1" } }),
  },
  {
    id: "work.restore_version",
    area: "work",
    title: "Restore a version",
    description: "Bring an artifact back to an earlier version from its history. The current artifact is saved as a version first.",
    keywords: ["history", "undo", "restore", "go back", "revert"],
    reach: tool("restore_version", { appCommand: "restore_version", example: { artifactId: "wx1", versionId: "v1" } }),
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
    description: "Publish or unpublish the live build of a code artifact.",
    server: ["spectraRuntimeBuilds:*"],
    keywords: ["publish", "deploy", "release", "go live", "take down"],
    reach: tool("publish_code", { appCommand: "publish_code", example: { artifactId: "wx1", action: "publish" } }),
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
    description: "Move artifact or folders to the Trash, where the user can restore them.",
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
    keywords: ["undelete", "bring back", "trash", "recover"],
    server: ["orgTree:restore"],
    reach: tool("restore_from_trash", { appCommand: "restore_library_items", example: { targetIds: ["n1"] } }),
  },
  {
    id: "library.delete_forever",
    area: "library",
    title: "Delete permanently",
    description: "Empty the Trash or delete artifacts and workspaces for good.",
    server: ["orgTree:purge", "spectraArtifacts:permanentlyDelete", "spectraWorkspaces:permanentlyDelete", "spectraArtifactDeletion:*"],
    reach: user("Spectra never deletes permanently. It moves things to the Trash, and the user empties it."),
  },
  {
    id: "library.pin",
    area: "library",
    title: "Pin in the library",
    description: "Pin or unpin items and their sources.",
    keywords: ["favourite", "star", "keep at the top"],
    server: ["orgTree:setPinned", "orgTree:pinSources"],
    reach: tool("organize_library", { fixed: { action: "pin" }, appCommand: "pin_library_item", example: { targetIds: ["n1"] } }),
  },
  {
    id: "library.workspaces",
    area: "library",
    title: "Create or rename a workspace",
    description: "Create a workspace or change its name and details.",
    keywords: ["class", "project", "new workspace"],
    server: ["spectraWorkspaces:create", "spectraWorkspaces:update"],
    reach: tool("organize_library", { fixed: { action: "create_workspace" }, appCommand: "organize_library", example: { name: "Physics" } }),
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
    description: "Leave a comment on an artifact, on one region or the whole item.",
    keywords: ["feedback", "note", "annotate", "review"],
    ui: ["app.comments.add"],
    server: ["artifactComments:create"],
    reach: tool("add_comment", { appCommand: "add_comment", example: { artifactId: "wx1", body: "Cite this claim." } }),
  },
  {
    id: "comments.read",
    area: "comments",
    title: "Read comments",
    description: "Read the comment threads on an artifact: who said what, where, and whether it is resolved.",
    keywords: ["feedback", "review notes", "what did they say"],
    reach: tool("read_comments", { example: { artifactId: "wx1" } }),
  },
  {
    id: "comments.open",
    area: "comments",
    title: "Open comments",
    description: "Show the comments panel of the open artifact.",
    ui: ["app.comments.open"],
    reach: user("It only shows a panel in the user's editor. Spectra reads work with read_artifact."),
  },
  {
    id: "comments.manage",
    area: "comments",
    title: "Edit, resolve or delete comments",
    description: "Edit a comment, resolve it, move its anchor or delete it.",
    server: ["artifactComments:updateBody", "artifactComments:setResolved", "artifactComments:reanchor", "artifactComments:remove"],
    reach: tool("manage_comment", { appCommand: "manage_comment", example: { artifactId: "wx1", commentId: "c1", action: "resolve" } }),
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
    description: "Add a personal event to the calendar: title, start, end?, allDay?, notes?, alreadyHappened? (only to log something that already happened).",
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
    id: "calendar.complete_block",
    area: "calendar",
    title: "Complete a work block",
    description: "Mark a scheduled work block done: itemId and expectedRevision from read_calendar.",
    keywords: ["done", "finished", "tick off"],
    server: ["calendar:completeWorkBlock"],
    reach: tool("calendar", { fixed: { action: "complete_block" }, appCommand: "complete_calendar_block", example: { itemId: "b1", expectedRevision: 1 } }),
  },
  {
    id: "calendar.remove_event",
    area: "calendar",
    title: "Remove a calendar event",
    description: "Take a personal event or a work block off the calendar: itemId from read_calendar.",
    keywords: ["delete event", "cancel", "clear"],
    server: ["calendar:removePersonalItem"],
    reach: tool("calendar", { fixed: { action: "remove_event" }, appCommand: "remove_calendar_event", example: { itemId: "e1" } }),
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
    id: "devices.list_names",
    area: "devices",
    title: "See file names on a computer",
    description: "Read the names of files and folders in Documents, Desktop, Downloads and OneDrive on the user's computer, one level at a time. Names only, never contents. Use it to offer syncing something relevant.",
    keywords: ["files on my computer", "what files do i have", "find a file", "my documents", "downloads", "desktop files"],
    reach: tool("devices", { fixed: { action: "list_names" }, appCommand: "read_computer_names", example: { path: "Documents" } }),
  },
  {
    id: "devices.sync_path",
    area: "devices",
    title: "Sync a file or folder by name",
    description: "After the user agrees, ask to bring a file or folder from list_names into Spectra. A prompt on the computer decides; it only comes in if they agree there.",
    keywords: ["sync this file", "bring it in", "import from my computer", "add this to spectra"],
    reach: tool("devices", { fixed: { action: "sync_path" }, appCommand: "control_device", example: { path: "Documents/IB/Lab report.docx" } }),
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
    id: "devices.add_files",
    area: "devices",
    title: "Add files",
    description: "Open the native picker so the user chooses one or more individual files to sync, without granting access to their folder.",
    keywords: ["sync files", "select files", "single file", "multiple files", "bridge files"],
    ui: ["app.devices.add-files"],
    reach: tool("devices", { fixed: { action: "add_files" }, appCommand: "control_device", example: {} }),
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
    server: ["managebac:configure", "managebac:disconnect", "managebac:reopenBlocked", "managebac:confirmSchoolSetup"],
    reach: user("Connecting a service goes through its own sign-in, which only the user completes."),
  },

  // Sharing
  {
    id: "sharing.audience",
    area: "sharing",
    title: "Choose a workspace's sharing audience",
    description: "Choose whether everyone can edit, whether new artifact is shared, which works share access, and which class or workspace is linked.",
    server: ["sharingPeople:setEveryoneCanEdit", "workspaceSharing:setShareNewWork", "workspaceSharing:setWorksShared", "workspaceSharing:link", "workspaceSharing:unlink", "workspaceSharing:inviteClass"],
    reach: user("Changing an entire audience or the default access of future artifact requires the user's own choice in sharing settings. Spectra can propose individual invitations through share."),
  },
  {
    id: "sharing.change",
    area: "sharing",
    title: "Share artifact",
    description: "Invite someone to view or edit an artifact, change their access or remove it.",
    keywords: ["invite", "access", "collaborate", "permission"],
    ui: ["app.sharing.change"],
    server: ["authority:invite", "authority:changeAcceptedLevel", "authority:revoke"],
    reach: tool("share", { appCommand: "change_sharing", example: { action: "invite", resourceType: "artifact", resourceId: "wx1", subjectId: "acct2", level: "read" } }),
  },
  {
    id: "sharing.invitations",
    area: "sharing",
    title: "See invitations waiting for you",
    description: "See what other people shared with the user that waits for their answer: artifacts, workspaces or agents.",
    keywords: ["invited me", "shared with me", "pending invitations"],
    reach: tool("read_share_invitations"),
  },
  {
    id: "sharing.respond",
    area: "sharing",
    title: "Accept or decline a share",
    description: "Accept or decline an artifact someone shared with the user.",
    keywords: ["accept invitation", "decline invitation", "join shared artifact"],
    server: ["authority:acceptShareInvitation", "authority:declineShareInvitation"],
    reach: tool("respond_to_share", { appCommand: "respond_share_invitation", example: { invitationId: "i1", response: "accept" } }),
  },
  {
    id: "sharing.join_school",
    area: "sharing",
    title: "Join a school",
    description: "Accept an invitation to join a school.",
    server: ["memberships:acceptInvitation"],
    reach: user("Joining a school changes the account itself, its school and who administers it. Only the user accepts that, from the invitation."),
  },
  {
    id: "sharing.read",
    area: "sharing",
    title: "See who can open an artifact",
    description: "See who is invited to an artifact, workspace or agent, who reaches it through a shared workspace, any access exceptions, and its public links.",
    keywords: ["who has access", "shared with", "collaborators", "invitations", "public link"],
    reach: tool("read_sharing", { example: { resourceType: "artifact", resourceId: "wx1" } }),
  },
  {
    id: "sharing.withdraw_invitation",
    area: "sharing",
    title: "Withdraw an invitation",
    description: "Withdraw a sharing invitation nobody has accepted yet.",
    keywords: ["cancel invite", "uninvite", "pending"],
    server: ["authority:revokePendingInvitation"],
    reach: tool("share", { fixed: { action: "withdraw_invitation" }, appCommand: "change_sharing", example: { resourceType: "artifact", resourceId: "wx1", invitationId: "inv1" } }),
  },
  {
    id: "sharing.exceptions",
    area: "sharing",
    title: "Set an access exception",
    description: "Stop one member of a shared workspace from opening a single artifact, or let them only view it; or lift that exception.",
    keywords: ["exclude", "hide from", "view only", "restrict", "deny"],
    server: ["authority:setArtifactException", "authority:clearArtifactException"],
    reach: tool("share", { fixed: { action: "set_exception" }, appCommand: "change_sharing", example: { resourceType: "artifact", resourceId: "wx1", accountId: "acct2", effect: "restrict" } }),
  },
  {
    id: "sharing.public_link",
    area: "sharing",
    title: "Make or turn off a public link",
    description: "Make a read-only link anyone can open, or turn one off. Only the user sees the link's address.",
    keywords: ["public", "publish", "anyone with the link", "link sharing"],
    server: ["authority:createPublicLink", "authority:revokePublicLink"],
    reach: tool("share", { fixed: { action: "create_public_link" }, appCommand: "change_sharing", example: { resourceType: "artifact", resourceId: "wx1", expiresInDays: 30 } }),
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
    description: "Copy a resource from a ManageBac class shelf into the Library, as an editable artifact when it is an Office file.",
    keywords: ["class shelf", "worksheet", "teacher file", "download", "copy into library"],
    ui: ["app.managebac.import-resource"],
    server: ["managebac:beginResourceImport"],
    reach: tool("managebac", { fixed: { action: "import_resource" }, appCommand: "import_managebac_resource", example: { resourceId: "r1" } }),
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
    server: ["managebac:materializeClassWorkspaces", "managebac:releaseClassWorkspaces"],
    reach: tool("managebac", { fixed: { action: "create_class_workspaces" }, appCommand: "manage_class_workspaces", example: { classIds: ["c1"] } }),
  },
  {
    id: "managebac.purge_class_workspaces",
    area: "managebac",
    title: "Remove auto-created class workspaces",
    description: "Remove every workspace Spectra made automatically for ManageBac classes.",
    server: ["managebac:purgeAutoCreatedClassWorkspaces"],
    reach: user("It removes every auto-created class workspace at once, behind a phrase the user types on the ManageBac page. Spectra releases class workspaces one class at a time with the managebac tool."),
  },
  {
    id: "managebac.sync_preferences",
    area: "managebac",
    title: "School sync preferences",
    description: "Choose, per kind of school record and per class, whether ManageBac syncs automatically, on demand or not at all.",
    keywords: ["school", "sync", "automatic", "manual", "off"],
    server: ["school:setMode", "school:setClassOverride"],
    reach: tool("managebac", { fixed: { action: "set_sync_mode" }, appCommand: "set_school_sync_mode", example: { kind: "grades", mode: "manual" } }),
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
    server: ["spectraMemory:update"],
    reach: tool("update_memory", { example: { file: "preferences", add: "Everywhere: prefers short answers." } }),
  },
  {
    id: "memory.forget",
    area: "memory",
    title: "Forget a memory",
    description: "Erase one saved memory for good when the user asks Spectra to forget it.",
    keywords: ["forget", "erase memory", "delete memory"],
    server: ["spectraMemory:update"],
    reach: tool("update_memory", { example: { file: "topic", slug: "mit-interview", remove: true } }),
  },
  {
    id: "memory.manage",
    area: "memory",
    title: "Clear, dispute or configure memory",
    description: "Clear every memory at once, flag one as disputed or change what Spectra may remember.",
    server: ["memory:clearAll", "memory:setDisputed", "memory:updatePreferences"],
    reach: user(
      "What Spectra may keep is the user's choice: clearing everything takes typed confirmation and memory settings are Spectra's own permissions. Spectra revises a wrong memory or forgets one instead of disputing it.",
    ),
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
    id: "agents.releases",
    area: "agents",
    title: "Read an agent's releases",
    description: "See an agent's releases, who each one reaches, and whether its current draft passed its checks.",
    keywords: ["release history", "live version", "checks", "evaluation"],
    reach: tool("read_agent_releases", { example: { agentId: "ag1" } }),
  },
  {
    id: "agents.release",
    area: "agents",
    title: "Release an agent",
    description: "Release an agent's current draft to yourself or to everyone who can use it, take a staged release live, roll back to an earlier release or suspend one.",
    keywords: ["publish agent", "make private", "release privately", "promote", "roll back", "suspend", "go live"],
    server: ["spectraArtifacts:publishAgent", "spectraArtifacts:manageAgentRelease"],
    reach: tool("release_agent", { appCommand: "release_agent", example: { agentId: "ag1", action: "release_private" } }),
  },
  {
    id: "agents.checks",
    area: "agents",
    title: "Run an agent's checks",
    description: "Run an agent draft's evaluation checks, which publishing it to everyone needs.",
    keywords: ["evaluate", "test agent", "run checks", "evals"],
    server: ["agents:beginEvalRun", "agents:settleEvalRun", "agents:admitModelWork", "agents:recordModelWork"],
    reach: tool("run_agent_checks", { appCommand: "run_agent_checks", example: { agentId: "ag1" } }),
  },
  {
    id: "agents.bench_run",
    area: "agents",
    title: "Try an agent on the bench",
    description: "Ask an agent's draft, or one of its releases, a question on the bench and read its answer.",
    keywords: ["bench", "try agent", "test question", "ask my agent", "compare with release"],
    server: ["agents:recordBenchRun"],
    reach: tool("run_agent_bench", { appCommand: "run_agent_bench", example: { agentId: "ag1", prompt: "Mark my essay" } }),
  },
  {
    id: "agents.bench_read",
    area: "agents",
    title: "Read an agent's bench",
    description: "See the tests kept from an agent's bench and its recent bench answers.",
    keywords: ["bench tests", "saved tests", "bench answers"],
    reach: tool("read_agent_bench", { example: { agentId: "ag1" } }),
  },
  {
    id: "agents.bench_save_test",
    area: "agents",
    title: "Keep a bench question as a test",
    description: "Keep a bench question as one of an agent's tests, with what a good answer must or must not say, or change a kept test.",
    keywords: ["save test", "keep as test", "must include", "must not say", "regression"],
    server: ["agents:saveBenchCase"],
    reach: tool("save_agent_bench_case", {
      appCommand: "save_agent_bench_case",
      example: { agentId: "ag1", prompt: "Mark my essay", mustInclude: ["one next step"] },
    }),
  },
  {
    id: "agents.bench_remove_test",
    area: "agents",
    title: "Remove a bench test",
    description: "Delete one of the tests kept from an agent's bench, so its checks no longer include it.",
    keywords: ["delete test", "drop test"],
    server: ["agents:removeBenchCase"],
    reach: tool("remove_agent_bench_case", { appCommand: "remove_agent_bench_case", example: { agentId: "ag1", caseId: "case1" } }),
  },
  {
    id: "agents.compile",
    area: "agents",
    title: "Compile an agent in the Foundry",
    description: "Compile an agent's skills, routing and release notes from its mission, answers and sources in the Foundry.",
    keywords: ["compile", "foundry", "skills", "draft skills", "routing"],
    server: ["agents:beginCompilerJob", "agents:updateCompilerJob", "agents:cancelCompilerJob"],
    reach: tool("compile_agent", { appCommand: "compile_agent", example: { agentId: "ag1" } }),
  },
  {
    id: "agents.approve_skills",
    area: "agents",
    title: "Approve an agent's drafted skills",
    description: "Approve the skills the Foundry drafted for an agent, with its compiled routing and release notes.",
    keywords: ["approve skills", "accept skills", "drafted skills"],
    reach: tool("approve_agent_skills", { example: { agentId: "ag1" } }),
  },
  {
    id: "agents.manage",
    area: "agents",
    title: "Follow or improve agents",
    description: "Follow an agent, add a public one, rate its answers or accept an improvement.",
    server: ["agents:follow", "agents:submitFeedback", "agents:proposeImprovement", "agents:decideImprovement", "spectraArtifacts:addPublicAgent"],
    reach: user("Following an agent, rating its answers and accepting an improvement are the user's own judgment of it. Spectra builds agents as work with create_artifact and edit_artifact."),
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
    server: ["administration:*", "schools:*", "memberships:invite", "metering:setLimitPolicy", "feedbackInbox:setStatus", "platformControls:setStopped"],
    reach: user("School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account."),
  },
];

/**
 * Public Convex functions that are not user actions: protocols, the AI's own
 * run machinery, uploads and housekeeping. Each says why.
 */
const DEVICE_WORK_PLUMBING = "Moving and backing up work on this computer is the owner's own choice on the Devices page; the AI writes to device work through its normal artifact tools.";

export const SERVER_PLUMBING: Readonly<Record<string, string>> = {
  "spectraArtifactLinks:establish":
    "Keeps the links an artifact's own references imply; Spectra links work through spectraArtifactLinks:create.",
  "deviceWorks:choose": DEVICE_WORK_PLUMBING,
  "deviceWorks:adoptRestored": DEVICE_WORK_PLUMBING,
  "deviceWorks:touch": DEVICE_WORK_PLUMBING,
  "deviceWorks:finishCreate": DEVICE_WORK_PLUMBING,
  "deviceWorks:movedToDevice": DEVICE_WORK_PLUMBING,
  "deviceWorks:movedToCloud": DEVICE_WORK_PLUMBING,
  "deviceWorks:backupUploadUrl": DEVICE_WORK_PLUMBING,
  "deviceWorks:recordBackup": DEVICE_WORK_PLUMBING,
  "deviceWorks:deleteBackups": DEVICE_WORK_PLUMBING,
  "landingRequests:submit": "The public landing page's request form; nobody is signed in there.",
  "landingRequests:setStatus": "Operators triage landing page requests from the admin page.",
  "memory:remember": "The older memory store, kept for settings; the AI writes its notes through update_memory.",
  "memory:correct": "The older memory store, kept for settings; the AI writes its notes through update_memory.",
  "memory:forget": "The older memory store, kept for settings; the AI writes its notes through update_memory.",
  "spectraHarness:takeSteers": "The run loop collects messages the user sent while it worked.",
  "spectraHarness:discardCheckpoint": "The run loop drops a resume checkpoint it no longer needs.",
  "spectraRunUndo:bringBackCalendarItem": "Undo puts back calendar events the run removed.",
  "spectraRunUndo:recordReversal": "Records a completed conversational Undo for the current run after checking the prior run's reversal.",
  "spectraRunUndo:restoreSettingsLayer": "Undo puts back settings the run changed.",
  "spectraMemory:clear": "Settings clears the AI's notes on the user's own request.",
  "artifactAssets:*": "Upload protocol for artifact assets.",
  "artifactContent:*": "Upload protocol for artifact content.",
  "artifactEmbeds:confirmPlacement": "Confirms a provisional placement against the saved version that holds it; the change-group writer does this for Spectra's own placements.",
  "artifactEmbeds:migrateLegacy": "Upgrades an older embed node when the document opens.",
  "artifactEmbeds:removeMany": "Editors keep embed rows in step when several nodes are deleted at once.",
  "artifactEmbeds:restore": "Editors bring an embed row back when the user undoes deleting its node.",
  "artifactIntakeActions:*": "Upload verification.",
  "artifactUserStates:*": "Per-user view state the editors save as they are used.",
  "bridge:confirmPairing": "Spectra Bridge device protocol.",
  "bridge:resumePairing": "Spectra Bridge device protocol.",
  "bridge:reportHealth": "Spectra Bridge device protocol.",
  "bridge:registerMount": "Spectra Bridge device protocol.",
  "bridgeStructure:*": "Spectra Bridge device protocol.",
  "bridgeSync:*": "Spectra Bridge device protocol.",
  "calendar:ensureLegacyMigration": "One-time data migration.",
  "calendar:adoptAsTask": "Turns an older calendar entry into its task when it is opened; the calendar does it, never a command.",
  "changeGroups:commitCurrent": "Saves edit history as the editors write.",
  "dailyBriefs:claim": "Home's morning brief protocol: one writer per day.",
  "dailyBriefs:save": "Home's morning brief protocol: the written brief.",
  "dailyBriefs:mark": "Home's morning brief protocol: which suggestions the student has acted on.",
  "dailyBriefs:setSchedule": "Keeps the brief's wake-up schedule in step with the student's settings.",
  "school:ensureTaskWork": "Opens a school deadline as its task artifact, made on demand when the student opens it.",
  "changeGroups:commitImport": "Saves edit history for imports.",
  "changeGroups:commitRestore": "A refusing tombstone for older clients; restores run through the signed artifactRestore admission, which restore_version calls.",
  "changeGroups:reconcileImports": "Saves edit history for imports.",
  "changeGroups:checkpointBeforeAi": "The checkpoint taken before Spectra edits.",
  "collaboration:*": "Live collaboration rooms.",
  "collaborationGatewayBridge:*": "Live collaboration gateway.",
  "identity:*": "Sign-in bookkeeping.",
  "localStudentRehearsal:*": "Local-only rehearsal fixtures for development.",
  "managebac:replaceCapabilityManifest": "ManageBac sync protocol.",
  "managebac:claimScheduledSync": "ManageBac sync protocol.",
  "managebac:claimLoginSync": "Claims the one refresh associated with the user's sign-in; it is not a separate AI action.",
  "managebac:finishLoginSync": "Acknowledges completion of the refresh claimed during sign-in.",
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
  "spectraThreads:recordThreadNotes": "Spectra's own run machinery: a thread's running notes.",
  "spectraThreads:createFromRun": "Spectra's own run machinery.",
  "spectraWorkspaces:createPending": "Spectra's own run machinery.",
  "spectraWorkspaces:finalizePending": "Spectra's own run machinery.",
  "spectraWorkspaces:pauseForApproval": "Spectra's own run machinery.",
  "spectraWorkspaces:resumePending": "Spectra's own run machinery.",
  "spectraWorkspaces:stageAiPatch": "Spectra's own run machinery.",
  "spectraWorkspaces:settleForRun": "Spectra's own run machinery.",
  "workStacks:*": "How the shelf shows artifacts laid on one another; it never moves an artifact, so there is nothing for Spectra to do.",
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
 * whole authoring format of the type: a studio feature that changes work
 * (Designer is one) lands in that format too, so the model can do whatever the
 * bar can. The rest are only the user's; these
 * rules name which and why. They run in order and the first match wins.
 */
const ARTIFACT_RULES: ReadonlyArray<{ match: RegExp; reach: AiReach }> = [
  { match: /\.(undo|redo)$|\.history\.(undo|redo)$/, reach: user("Undo and redo step through the user's own edit history. Spectra changes artifacts forward with edit_artifact.") },
  { match: /\.(export|print|download)(\.|$)|\.export\.|\.print$/, reach: user("Exporting saves a copy to the user's device, which only the user's browser can do.") },
  { match: /\.import(\.|$)|\.files\.open$|\.add\.image$/, reach: user("Files come from the browser's file picker, which only the user can open.") },
  { match: /\.(present|presenter)(\.|$)|\.present$|\.rehearse$/, reach: user("Presenting is the user's own live performance.") },
  { match: /\.attempt\.|\.study\.|\.runtime\.interact$/, reach: user("These are the learner's own answers and study. Spectra doing them would fake the learner's progress.") },
  { match: /^code\.publish$/, reach: tool("publish_code", { fixed: { action: "publish" }, appCommand: "publish_code" }) },
  { match: /^code\.unpublish$/, reach: tool("publish_code", { fixed: { action: "unpublish" }, appCommand: "publish_code" }) },
  // A quiz opens and closes for attempts with edit_artifact's publish and unpublish.
  { match: /^agent\.private$/, reach: tool("release_agent", { fixed: { action: "release_private" }, appCommand: "release_agent" }) },
  { match: /\.clipboard\.|\.copyStyle$/, reach: user("It uses the user's clipboard.") },
  { match: /\.protect\.sheet$/, reach: user("Protection guards a sheet against edits, including Spectra's, so only the user sets it.") },
  {
    match: /^whiteboard\.fit$|^sheets\.format$|\.(view|zoom|navigate\.(find|outline)|layout\.(focus|pageCanvas|pagesSideBySide|previewReader)|panel|tool\.(select|hand)|stage\.(guides|grid)|accessibility\.readingOrder|transition\.native)(\.|$)|\.(pages|rail|files|questions|question\.details|cohort|attempts|preview|build|settings|progress|filters|find|today|previous|next|calendars|dismissed|competence|brief|refresh|browse|notes\.panel|comments|spellcheck|outline|sources\.open|design\.audit|library|explain|trace|summary|history|pivot|native|show|inspector|slidePreviews|notesPage|sources)$/,
    reach: user("It changes only what the user sees, not the artifact. Spectra reads work with read_artifact and shows it with open_in_spectra."),
  },
];

const EDIT_REACH: AiReach = { kind: "tool", tool: "edit_artifact" };

/** How Spectra AI reaches one editor command. */
export function artifactCapabilityReach(capabilityId: string): AiReach {
  return ARTIFACT_RULES.find((rule) => rule.match.test(capabilityId))?.reach ?? EDIT_REACH;
}
