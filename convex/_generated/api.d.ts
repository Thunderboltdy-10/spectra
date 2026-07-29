/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as administration from "../administration.js";
import type * as agents from "../agents.js";
import type * as artifactAccessRequests from "../artifactAccessRequests.js";
import type * as artifactAssets from "../artifactAssets.js";
import type * as artifactComments from "../artifactComments.js";
import type * as artifactEmbeds from "../artifactEmbeds.js";
import type * as artifactImports from "../artifactImports.js";
import type * as artifactSnapshots from "../artifactSnapshots.js";
import type * as artifactUserStates from "../artifactUserStates.js";
import type * as audit from "../audit.js";
import type * as auditShared from "../auditShared.js";
import type * as authority from "../authority.js";
import type * as authorityShared from "../authorityShared.js";
import type * as changeGroups from "../changeGroups.js";
import type * as collaboration from "../collaboration.js";
import type * as collaborationGatewayBridge from "../collaborationGatewayBridge.js";
import type * as collaborationGatewayStore from "../collaborationGatewayStore.js";
import type * as crons from "../crons.js";
import type * as env from "../env.js";
import type * as executionScheduler from "../executionScheduler.js";
import type * as flashcardStudy from "../flashcardStudy.js";
import type * as identity from "../identity.js";
import type * as identityShared from "../identityShared.js";
import type * as managebac from "../managebac.js";
import type * as memberships from "../memberships.js";
import type * as memory from "../memory.js";
import type * as memoryEmbedding from "../memoryEmbedding.js";
import type * as metering from "../metering.js";
import type * as operationalCounters from "../operationalCounters.js";
import type * as operatorSessions from "../operatorSessions.js";
import type * as plannerReminders from "../plannerReminders.js";
import type * as quizPractice from "../quizPractice.js";
import type * as quizPrivacy from "../quizPrivacy.js";
import type * as regionClaims from "../regionClaims.js";
import type * as schools from "../schools.js";
import type * as secretBridge from "../secretBridge.js";
import type * as secretStore from "../secretStore.js";
import type * as spectraArtifactLinks from "../spectraArtifactLinks.js";
import type * as spectraArtifacts from "../spectraArtifacts.js";
import type * as spectraOperations from "../spectraOperations.js";
import type * as spectraRunLifecycle from "../spectraRunLifecycle.js";
import type * as spectraRuns from "../spectraRuns.js";
import type * as spectraRuntimeBuilds from "../spectraRuntimeBuilds.js";
import type * as spectraShared from "../spectraShared.js";
import type * as spectraThreads from "../spectraThreads.js";
import type * as spectraWorkspaceItems from "../spectraWorkspaceItems.js";
import type * as spectraWorkspaces from "../spectraWorkspaces.js";
import type * as timetableReminders from "../timetableReminders.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  administration: typeof administration;
  agents: typeof agents;
  artifactAccessRequests: typeof artifactAccessRequests;
  artifactAssets: typeof artifactAssets;
  artifactComments: typeof artifactComments;
  artifactEmbeds: typeof artifactEmbeds;
  artifactImports: typeof artifactImports;
  artifactSnapshots: typeof artifactSnapshots;
  artifactUserStates: typeof artifactUserStates;
  audit: typeof audit;
  auditShared: typeof auditShared;
  authority: typeof authority;
  authorityShared: typeof authorityShared;
  changeGroups: typeof changeGroups;
  collaboration: typeof collaboration;
  collaborationGatewayBridge: typeof collaborationGatewayBridge;
  collaborationGatewayStore: typeof collaborationGatewayStore;
  crons: typeof crons;
  env: typeof env;
  executionScheduler: typeof executionScheduler;
  flashcardStudy: typeof flashcardStudy;
  identity: typeof identity;
  identityShared: typeof identityShared;
  managebac: typeof managebac;
  memberships: typeof memberships;
  memory: typeof memory;
  memoryEmbedding: typeof memoryEmbedding;
  metering: typeof metering;
  operationalCounters: typeof operationalCounters;
  operatorSessions: typeof operatorSessions;
  plannerReminders: typeof plannerReminders;
  quizPractice: typeof quizPractice;
  quizPrivacy: typeof quizPrivacy;
  regionClaims: typeof regionClaims;
  schools: typeof schools;
  secretBridge: typeof secretBridge;
  secretStore: typeof secretStore;
  spectraArtifactLinks: typeof spectraArtifactLinks;
  spectraArtifacts: typeof spectraArtifacts;
  spectraOperations: typeof spectraOperations;
  spectraRunLifecycle: typeof spectraRunLifecycle;
  spectraRuns: typeof spectraRuns;
  spectraRuntimeBuilds: typeof spectraRuntimeBuilds;
  spectraShared: typeof spectraShared;
  spectraThreads: typeof spectraThreads;
  spectraWorkspaceItems: typeof spectraWorkspaceItems;
  spectraWorkspaces: typeof spectraWorkspaces;
  timetableReminders: typeof timetableReminders;
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
