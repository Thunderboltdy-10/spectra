/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as agents from "../agents.js";
import type * as analytics from "../analytics.js";
import type * as auditLog from "../auditLog.js";
import type * as bookmarks from "../bookmarks.js";
import type * as catalogSync from "../catalogSync.js";
import type * as chats from "../chats.js";
import type * as compaction from "../compaction.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as curatedModelRegistry from "../curatedModelRegistry.js";
import type * as feedback from "../feedback.js";
import type * as flashcards from "../flashcards.js";
import type * as gamification from "../gamification.js";
import type * as helpers from "../helpers.js";
import type * as images from "../images.js";
import type * as ingestQueue from "../ingestQueue.js";
import type * as memory from "../memory.js";
import type * as models from "../models.js";
import type * as notifications from "../notifications.js";
import type * as packs from "../packs.js";
import type * as personalSoul from "../personalSoul.js";
import type * as quizzes from "../quizzes.js";
import type * as rag from "../rag.js";
import type * as resources from "../resources.js";
import type * as schoolAdmin from "../schoolAdmin.js";
import type * as seed from "../seed.js";
import type * as shared from "../shared.js";
import type * as soul from "../soul.js";
import type * as streakLogic from "../streakLogic.js";
import type * as superAdmin from "../superAdmin.js";
import type * as usage from "../usage.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  agents: typeof agents;
  analytics: typeof analytics;
  auditLog: typeof auditLog;
  bookmarks: typeof bookmarks;
  catalogSync: typeof catalogSync;
  chats: typeof chats;
  compaction: typeof compaction;
  constants: typeof constants;
  crons: typeof crons;
  curatedModelRegistry: typeof curatedModelRegistry;
  feedback: typeof feedback;
  flashcards: typeof flashcards;
  gamification: typeof gamification;
  helpers: typeof helpers;
  images: typeof images;
  ingestQueue: typeof ingestQueue;
  memory: typeof memory;
  models: typeof models;
  notifications: typeof notifications;
  packs: typeof packs;
  personalSoul: typeof personalSoul;
  quizzes: typeof quizzes;
  rag: typeof rag;
  resources: typeof resources;
  schoolAdmin: typeof schoolAdmin;
  seed: typeof seed;
  shared: typeof shared;
  soul: typeof soul;
  streakLogic: typeof streakLogic;
  superAdmin: typeof superAdmin;
  usage: typeof usage;
  users: typeof users;
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

export declare const components: {};
