/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as env from "../env.js";
import type * as identity from "../identity.js";
import type * as identityShared from "../identityShared.js";
import type * as spectraArtifactLinks from "../spectraArtifactLinks.js";
import type * as spectraArtifacts from "../spectraArtifacts.js";
import type * as spectraOperations from "../spectraOperations.js";
import type * as spectraRunLifecycle from "../spectraRunLifecycle.js";
import type * as spectraRuns from "../spectraRuns.js";
import type * as spectraSeed from "../spectraSeed.js";
import type * as spectraShared from "../spectraShared.js";
import type * as spectraThreads from "../spectraThreads.js";
import type * as spectraWorkspaceItems from "../spectraWorkspaceItems.js";
import type * as spectraWorkspaces from "../spectraWorkspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  env: typeof env;
  identity: typeof identity;
  identityShared: typeof identityShared;
  spectraArtifactLinks: typeof spectraArtifactLinks;
  spectraArtifacts: typeof spectraArtifacts;
  spectraOperations: typeof spectraOperations;
  spectraRunLifecycle: typeof spectraRunLifecycle;
  spectraRuns: typeof spectraRuns;
  spectraSeed: typeof spectraSeed;
  spectraShared: typeof spectraShared;
  spectraThreads: typeof spectraThreads;
  spectraWorkspaceItems: typeof spectraWorkspaceItems;
  spectraWorkspaces: typeof spectraWorkspaces;
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
