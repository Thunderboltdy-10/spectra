/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accessControl from "../accessControl.js";
import type * as accessRequests from "../accessRequests.js";
import type * as admin from "../admin.js";
import type * as agents from "../agents.js";
import type * as analytics from "../analytics.js";
import type * as artifacts from "../artifacts.js";
import type * as auditLog from "../auditLog.js";
import type * as bookmarks from "../bookmarks.js";
import type * as catalogSync from "../catalogSync.js";
import type * as chatBranching from "../chatBranching.js";
import type * as chats from "../chats.js";
import type * as compaction from "../compaction.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as curatedModelRegistry from "../curatedModelRegistry.js";
import type * as env from "../env.js";
import type * as errorEvents from "../errorEvents.js";
import type * as feedback from "../feedback.js";
import type * as fixCounts from "../fixCounts.js";
import type * as flashcards from "../flashcards.js";
import type * as gamification from "../gamification.js";
import type * as ghosts from "../ghosts.js";
import type * as helpers from "../helpers.js";
import type * as images from "../images.js";
import type * as ingestQueue from "../ingestQueue.js";
import type * as managebacSync from "../managebacSync.js";
import type * as memory from "../memory.js";
import type * as models from "../models.js";
import type * as notes from "../notes.js";
import type * as notifications from "../notifications.js";
import type * as packs from "../packs.js";
import type * as personalSoul from "../personalSoul.js";
import type * as plannerItems from "../plannerItems.js";
import type * as platformStatsAggregates from "../platformStatsAggregates.js";
import type * as quizzes from "../quizzes.js";
import type * as rag from "../rag.js";
import type * as resources from "../resources.js";
import type * as schoolAdmin from "../schoolAdmin.js";
import type * as seed from "../seed.js";
import type * as shared from "../shared.js";
import type * as soul from "../soul.js";
import type * as spectraArtifactLinks from "../spectraArtifactLinks.js";
import type * as spectraArtifacts from "../spectraArtifacts.js";
import type * as spectraOperations from "../spectraOperations.js";
import type * as spectraRuns from "../spectraRuns.js";
import type * as spectraSeed from "../spectraSeed.js";
import type * as spectraShared from "../spectraShared.js";
import type * as spectraThreads from "../spectraThreads.js";
import type * as spectraWorkspaceItems from "../spectraWorkspaceItems.js";
import type * as spectraWorkspaces from "../spectraWorkspaces.js";
import type * as streakLogic from "../streakLogic.js";
import type * as superAdmin from "../superAdmin.js";
import type * as usage from "../usage.js";
import type * as userLifecycle from "../userLifecycle.js";
import type * as userPreferences from "../userPreferences.js";
import type * as users from "../users.js";
import type * as workspaceBlueprints from "../workspaceBlueprints.js";
import type * as workspaceCommandResults from "../workspaceCommandResults.js";
import type * as workspaceHelpers from "../workspaceHelpers.js";
import type * as workspaceItemSync from "../workspaceItemSync.js";
import type * as workspaceItems from "../workspaceItems.js";
import type * as workspaceOrchestration from "../workspaceOrchestration.js";
import type * as workspaceWidgets from "../workspaceWidgets.js";
import type * as workstreamAssignment from "../workstreamAssignment.js";
import type * as workstreamMemory from "../workstreamMemory.js";
import type * as workstreams from "../workstreams.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accessControl: typeof accessControl;
  accessRequests: typeof accessRequests;
  admin: typeof admin;
  agents: typeof agents;
  analytics: typeof analytics;
  artifacts: typeof artifacts;
  auditLog: typeof auditLog;
  bookmarks: typeof bookmarks;
  catalogSync: typeof catalogSync;
  chatBranching: typeof chatBranching;
  chats: typeof chats;
  compaction: typeof compaction;
  constants: typeof constants;
  crons: typeof crons;
  curatedModelRegistry: typeof curatedModelRegistry;
  env: typeof env;
  errorEvents: typeof errorEvents;
  feedback: typeof feedback;
  fixCounts: typeof fixCounts;
  flashcards: typeof flashcards;
  gamification: typeof gamification;
  ghosts: typeof ghosts;
  helpers: typeof helpers;
  images: typeof images;
  ingestQueue: typeof ingestQueue;
  managebacSync: typeof managebacSync;
  memory: typeof memory;
  models: typeof models;
  notes: typeof notes;
  notifications: typeof notifications;
  packs: typeof packs;
  personalSoul: typeof personalSoul;
  plannerItems: typeof plannerItems;
  platformStatsAggregates: typeof platformStatsAggregates;
  quizzes: typeof quizzes;
  rag: typeof rag;
  resources: typeof resources;
  schoolAdmin: typeof schoolAdmin;
  seed: typeof seed;
  shared: typeof shared;
  soul: typeof soul;
  spectraArtifactLinks: typeof spectraArtifactLinks;
  spectraArtifacts: typeof spectraArtifacts;
  spectraOperations: typeof spectraOperations;
  spectraRuns: typeof spectraRuns;
  spectraSeed: typeof spectraSeed;
  spectraShared: typeof spectraShared;
  spectraThreads: typeof spectraThreads;
  spectraWorkspaceItems: typeof spectraWorkspaceItems;
  spectraWorkspaces: typeof spectraWorkspaces;
  streakLogic: typeof streakLogic;
  superAdmin: typeof superAdmin;
  usage: typeof usage;
  userLifecycle: typeof userLifecycle;
  userPreferences: typeof userPreferences;
  users: typeof users;
  workspaceBlueprints: typeof workspaceBlueprints;
  workspaceCommandResults: typeof workspaceCommandResults;
  workspaceHelpers: typeof workspaceHelpers;
  workspaceItemSync: typeof workspaceItemSync;
  workspaceItems: typeof workspaceItems;
  workspaceOrchestration: typeof workspaceOrchestration;
  workspaceWidgets: typeof workspaceWidgets;
  workstreamAssignment: typeof workstreamAssignment;
  workstreamMemory: typeof workstreamMemory;
  workstreams: typeof workstreams;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  aggregate: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"aggregate">;
};
