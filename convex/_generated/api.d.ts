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
import type * as chats from "../chats.js";
import type * as constants from "../constants.js";
import type * as helpers from "../helpers.js";
import type * as memory from "../memory.js";
import type * as models from "../models.js";
import type * as packs from "../packs.js";
import type * as rag from "../rag.js";
import type * as resources from "../resources.js";
import type * as seed from "../seed.js";
import type * as shared from "../shared.js";
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
  chats: typeof chats;
  constants: typeof constants;
  helpers: typeof helpers;
  memory: typeof memory;
  models: typeof models;
  packs: typeof packs;
  rag: typeof rag;
  resources: typeof resources;
  seed: typeof seed;
  shared: typeof shared;
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
