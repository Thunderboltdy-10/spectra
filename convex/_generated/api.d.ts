/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountErasure from "../accountErasure.js";
import type * as accountPreferences from "../accountPreferences.js";
import type * as administration from "../administration.js";
import type * as agents from "../agents.js";
import type * as analytics from "../analytics.js";
import type * as analyticsReadModels from "../analyticsReadModels.js";
import type * as artifactAccessRequests from "../artifactAccessRequests.js";
import type * as artifactAssets from "../artifactAssets.js";
import type * as artifactComments from "../artifactComments.js";
import type * as artifactContent from "../artifactContent.js";
import type * as artifactDeletionScheduling from "../artifactDeletionScheduling.js";
import type * as artifactEmbedOwnership from "../artifactEmbedOwnership.js";
import type * as artifactEmbedPlacement from "../artifactEmbedPlacement.js";
import type * as artifactEmbedPlacementActions from "../artifactEmbedPlacementActions.js";
import type * as artifactEmbedPlacementEvidence from "../artifactEmbedPlacementEvidence.js";
import type * as artifactEmbeds from "../artifactEmbeds.js";
import type * as artifactImports from "../artifactImports.js";
import type * as artifactIntakeActions from "../artifactIntakeActions.js";
import type * as artifactIntakeLifecycle from "../artifactIntakeLifecycle.js";
import type * as artifactRestore from "../artifactRestore.js";
import type * as artifactSnapshots from "../artifactSnapshots.js";
import type * as artifactUserStates from "../artifactUserStates.js";
import type * as audit from "../audit.js";
import type * as auditShared from "../auditShared.js";
import type * as authority from "../authority.js";
import type * as authorityShared from "../authorityShared.js";
import type * as bridge from "../bridge.js";
import type * as bridgeIdentity from "../bridgeIdentity.js";
import type * as bridgePlacement from "../bridgePlacement.js";
import type * as bridgeStructure from "../bridgeStructure.js";
import type * as bridgeSync from "../bridgeSync.js";
import type * as bridgeWriteOperations from "../bridgeWriteOperations.js";
import type * as calendar from "../calendar.js";
import type * as calendarReadModels from "../calendarReadModels.js";
import type * as calendarShared from "../calendarShared.js";
import type * as calendarTaskWork from "../calendarTaskWork.js";
import type * as catalogCursor from "../catalogCursor.js";
import type * as catalogGraph from "../catalogGraph.js";
import type * as catalogPages from "../catalogPages.js";
import type * as changeGroups from "../changeGroups.js";
import type * as collaboration from "../collaboration.js";
import type * as collaborationClaimAuthorization from "../collaborationClaimAuthorization.js";
import type * as collaborationDurablePayload from "../collaborationDurablePayload.js";
import type * as collaborationGatewayBridge from "../collaborationGatewayBridge.js";
import type * as collaborationGatewayStore from "../collaborationGatewayStore.js";
import type * as collaborationPolicyPush from "../collaborationPolicyPush.js";
import type * as collaborationSnapshotCandidate from "../collaborationSnapshotCandidate.js";
import type * as collaborationSnapshotVerification from "../collaborationSnapshotVerification.js";
import type * as crons from "../crons.js";
import type * as dailyBriefSchema from "../dailyBriefSchema.js";
import type * as dailyBriefs from "../dailyBriefs.js";
import type * as deviceWorks from "../deviceWorks.js";
import type * as durableContentDependencies from "../durableContentDependencies.js";
import type * as durablePayloadIntegrity from "../durablePayloadIntegrity.js";
import type * as durablePayloadOwnership from "../durablePayloadOwnership.js";
import type * as durableStorageBindings from "../durableStorageBindings.js";
import type * as embeddingDimensions from "../embeddingDimensions.js";
import type * as embeddingProvider from "../embeddingProvider.js";
import type * as env from "../env.js";
import type * as executionScheduler from "../executionScheduler.js";
import type * as feedbackInbox from "../feedbackInbox.js";
import type * as flashcardStudy from "../flashcardStudy.js";
import type * as functions from "../functions.js";
import type * as identity from "../identity.js";
import type * as identityShared from "../identityShared.js";
import type * as intakeAttestation from "../intakeAttestation.js";
import type * as landingRequests from "../landingRequests.js";
import type * as localStudentRehearsal from "../localStudentRehearsal.js";
import type * as managebac from "../managebac.js";
import type * as managebacProjectionAction from "../managebacProjectionAction.js";
import type * as managebacProjectionContract from "../managebacProjectionContract.js";
import type * as managebacProjectionJobs from "../managebacProjectionJobs.js";
import type * as managebacVisibility from "../managebacVisibility.js";
import type * as memberships from "../memberships.js";
import type * as memory from "../memory.js";
import type * as memoryEmbeddingPolicy from "../memoryEmbeddingPolicy.js";
import type * as memoryEmbeddings from "../memoryEmbeddings.js";
import type * as metering from "../metering.js";
import type * as nativeAiCommit from "../nativeAiCommit.js";
import type * as nativeAiCommitContract from "../nativeAiCommitContract.js";
import type * as nativeMaterialization from "../nativeMaterialization.js";
import type * as nativeOfficeValidators from "../nativeOfficeValidators.js";
import type * as nativeReconciliation from "../nativeReconciliation.js";
import type * as notificationCenter from "../notificationCenter.js";
import type * as operationalCounters from "../operationalCounters.js";
import type * as operatorSessions from "../operatorSessions.js";
import type * as orgNodeAggregates from "../orgNodeAggregates.js";
import type * as orgNodeMutation from "../orgNodeMutation.js";
import type * as orgTree from "../orgTree.js";
import type * as orgTreeIntegrity from "../orgTreeIntegrity.js";
import type * as orgTreePagination from "../orgTreePagination.js";
import type * as orgTreeShared from "../orgTreeShared.js";
import type * as orgTreeViews from "../orgTreeViews.js";
import type * as payloadLifecycle from "../payloadLifecycle.js";
import type * as payloads from "../payloads.js";
import type * as plannerReminders from "../plannerReminders.js";
import type * as platformControls from "../platformControls.js";
import type * as quizPractice from "../quizPractice.js";
import type * as quizPrivacy from "../quizPrivacy.js";
import type * as readOnce from "../readOnce.js";
import type * as regionClaims from "../regionClaims.js";
import type * as reminderSource from "../reminderSource.js";
import type * as replicaMaterialization from "../replicaMaterialization.js";
import type * as replicas from "../replicas.js";
import type * as retainedContentAccess from "../retainedContentAccess.js";
import type * as retainedPinAccess from "../retainedPinAccess.js";
import type * as school from "../school.js";
import type * as schoolSyncSchema from "../schoolSyncSchema.js";
import type * as schoolSyncShared from "../schoolSyncShared.js";
import type * as schools from "../schools.js";
import type * as secretBridge from "../secretBridge.js";
import type * as secretStore from "../secretStore.js";
import type * as semantic from "../semantic.js";
import type * as semanticIndex from "../semanticIndex.js";
import type * as semanticKeys from "../semanticKeys.js";
import type * as semanticQueue from "../semanticQueue.js";
import type * as semanticSources from "../semanticSources.js";
import type * as sharingPeople from "../sharingPeople.js";
import type * as snapshotHash from "../snapshotHash.js";
import type * as spectraApplicationWriteScope from "../spectraApplicationWriteScope.js";
import type * as spectraApplicationWrites from "../spectraApplicationWrites.js";
import type * as spectraArtifactDeletion from "../spectraArtifactDeletion.js";
import type * as spectraArtifactLinks from "../spectraArtifactLinks.js";
import type * as spectraArtifactWriteScope from "../spectraArtifactWriteScope.js";
import type * as spectraArtifactWrites from "../spectraArtifactWrites.js";
import type * as spectraArtifacts from "../spectraArtifacts.js";
import type * as spectraContext from "../spectraContext.js";
import type * as spectraHarness from "../spectraHarness.js";
import type * as spectraMemory from "../spectraMemory.js";
import type * as spectraOperations from "../spectraOperations.js";
import type * as spectraRunContinuations from "../spectraRunContinuations.js";
import type * as spectraRunLifecycle from "../spectraRunLifecycle.js";
import type * as spectraRunProjection from "../spectraRunProjection.js";
import type * as spectraRunUndo from "../spectraRunUndo.js";
import type * as spectraRuns from "../spectraRuns.js";
import type * as spectraRuntimeBuilds from "../spectraRuntimeBuilds.js";
import type * as spectraShared from "../spectraShared.js";
import type * as spectraThreads from "../spectraThreads.js";
import type * as spectraUiObservation from "../spectraUiObservation.js";
import type * as spectraUiObservationSchema from "../spectraUiObservationSchema.js";
import type * as spectraWorkspaces from "../spectraWorkspaces.js";
import type * as syllabusGuides from "../syllabusGuides.js";
import type * as syncOperationLifecycle from "../syncOperationLifecycle.js";
import type * as syncPolicy from "../syncPolicy.js";
import type * as timetableReminders from "../timetableReminders.js";
import type * as workStacks from "../workStacks.js";
import type * as workspaceLinksShared from "../workspaceLinksShared.js";
import type * as workspaceSharing from "../workspaceSharing.js";
import type * as workspaceSyllabus from "../workspaceSyllabus.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountErasure: typeof accountErasure;
  accountPreferences: typeof accountPreferences;
  administration: typeof administration;
  agents: typeof agents;
  analytics: typeof analytics;
  analyticsReadModels: typeof analyticsReadModels;
  artifactAccessRequests: typeof artifactAccessRequests;
  artifactAssets: typeof artifactAssets;
  artifactComments: typeof artifactComments;
  artifactContent: typeof artifactContent;
  artifactDeletionScheduling: typeof artifactDeletionScheduling;
  artifactEmbedOwnership: typeof artifactEmbedOwnership;
  artifactEmbedPlacement: typeof artifactEmbedPlacement;
  artifactEmbedPlacementActions: typeof artifactEmbedPlacementActions;
  artifactEmbedPlacementEvidence: typeof artifactEmbedPlacementEvidence;
  artifactEmbeds: typeof artifactEmbeds;
  artifactImports: typeof artifactImports;
  artifactIntakeActions: typeof artifactIntakeActions;
  artifactIntakeLifecycle: typeof artifactIntakeLifecycle;
  artifactRestore: typeof artifactRestore;
  artifactSnapshots: typeof artifactSnapshots;
  artifactUserStates: typeof artifactUserStates;
  audit: typeof audit;
  auditShared: typeof auditShared;
  authority: typeof authority;
  authorityShared: typeof authorityShared;
  bridge: typeof bridge;
  bridgeIdentity: typeof bridgeIdentity;
  bridgePlacement: typeof bridgePlacement;
  bridgeStructure: typeof bridgeStructure;
  bridgeSync: typeof bridgeSync;
  bridgeWriteOperations: typeof bridgeWriteOperations;
  calendar: typeof calendar;
  calendarReadModels: typeof calendarReadModels;
  calendarShared: typeof calendarShared;
  calendarTaskWork: typeof calendarTaskWork;
  catalogCursor: typeof catalogCursor;
  catalogGraph: typeof catalogGraph;
  catalogPages: typeof catalogPages;
  changeGroups: typeof changeGroups;
  collaboration: typeof collaboration;
  collaborationClaimAuthorization: typeof collaborationClaimAuthorization;
  collaborationDurablePayload: typeof collaborationDurablePayload;
  collaborationGatewayBridge: typeof collaborationGatewayBridge;
  collaborationGatewayStore: typeof collaborationGatewayStore;
  collaborationPolicyPush: typeof collaborationPolicyPush;
  collaborationSnapshotCandidate: typeof collaborationSnapshotCandidate;
  collaborationSnapshotVerification: typeof collaborationSnapshotVerification;
  crons: typeof crons;
  dailyBriefSchema: typeof dailyBriefSchema;
  dailyBriefs: typeof dailyBriefs;
  deviceWorks: typeof deviceWorks;
  durableContentDependencies: typeof durableContentDependencies;
  durablePayloadIntegrity: typeof durablePayloadIntegrity;
  durablePayloadOwnership: typeof durablePayloadOwnership;
  durableStorageBindings: typeof durableStorageBindings;
  embeddingDimensions: typeof embeddingDimensions;
  embeddingProvider: typeof embeddingProvider;
  env: typeof env;
  executionScheduler: typeof executionScheduler;
  feedbackInbox: typeof feedbackInbox;
  flashcardStudy: typeof flashcardStudy;
  functions: typeof functions;
  identity: typeof identity;
  identityShared: typeof identityShared;
  intakeAttestation: typeof intakeAttestation;
  landingRequests: typeof landingRequests;
  localStudentRehearsal: typeof localStudentRehearsal;
  managebac: typeof managebac;
  managebacProjectionAction: typeof managebacProjectionAction;
  managebacProjectionContract: typeof managebacProjectionContract;
  managebacProjectionJobs: typeof managebacProjectionJobs;
  managebacVisibility: typeof managebacVisibility;
  memberships: typeof memberships;
  memory: typeof memory;
  memoryEmbeddingPolicy: typeof memoryEmbeddingPolicy;
  memoryEmbeddings: typeof memoryEmbeddings;
  metering: typeof metering;
  nativeAiCommit: typeof nativeAiCommit;
  nativeAiCommitContract: typeof nativeAiCommitContract;
  nativeMaterialization: typeof nativeMaterialization;
  nativeOfficeValidators: typeof nativeOfficeValidators;
  nativeReconciliation: typeof nativeReconciliation;
  notificationCenter: typeof notificationCenter;
  operationalCounters: typeof operationalCounters;
  operatorSessions: typeof operatorSessions;
  orgNodeAggregates: typeof orgNodeAggregates;
  orgNodeMutation: typeof orgNodeMutation;
  orgTree: typeof orgTree;
  orgTreeIntegrity: typeof orgTreeIntegrity;
  orgTreePagination: typeof orgTreePagination;
  orgTreeShared: typeof orgTreeShared;
  orgTreeViews: typeof orgTreeViews;
  payloadLifecycle: typeof payloadLifecycle;
  payloads: typeof payloads;
  plannerReminders: typeof plannerReminders;
  platformControls: typeof platformControls;
  quizPractice: typeof quizPractice;
  quizPrivacy: typeof quizPrivacy;
  readOnce: typeof readOnce;
  regionClaims: typeof regionClaims;
  reminderSource: typeof reminderSource;
  replicaMaterialization: typeof replicaMaterialization;
  replicas: typeof replicas;
  retainedContentAccess: typeof retainedContentAccess;
  retainedPinAccess: typeof retainedPinAccess;
  school: typeof school;
  schoolSyncSchema: typeof schoolSyncSchema;
  schoolSyncShared: typeof schoolSyncShared;
  schools: typeof schools;
  secretBridge: typeof secretBridge;
  secretStore: typeof secretStore;
  semantic: typeof semantic;
  semanticIndex: typeof semanticIndex;
  semanticKeys: typeof semanticKeys;
  semanticQueue: typeof semanticQueue;
  semanticSources: typeof semanticSources;
  sharingPeople: typeof sharingPeople;
  snapshotHash: typeof snapshotHash;
  spectraApplicationWriteScope: typeof spectraApplicationWriteScope;
  spectraApplicationWrites: typeof spectraApplicationWrites;
  spectraArtifactDeletion: typeof spectraArtifactDeletion;
  spectraArtifactLinks: typeof spectraArtifactLinks;
  spectraArtifactWriteScope: typeof spectraArtifactWriteScope;
  spectraArtifactWrites: typeof spectraArtifactWrites;
  spectraArtifacts: typeof spectraArtifacts;
  spectraContext: typeof spectraContext;
  spectraHarness: typeof spectraHarness;
  spectraMemory: typeof spectraMemory;
  spectraOperations: typeof spectraOperations;
  spectraRunContinuations: typeof spectraRunContinuations;
  spectraRunLifecycle: typeof spectraRunLifecycle;
  spectraRunProjection: typeof spectraRunProjection;
  spectraRunUndo: typeof spectraRunUndo;
  spectraRuns: typeof spectraRuns;
  spectraRuntimeBuilds: typeof spectraRuntimeBuilds;
  spectraShared: typeof spectraShared;
  spectraThreads: typeof spectraThreads;
  spectraUiObservation: typeof spectraUiObservation;
  spectraUiObservationSchema: typeof spectraUiObservationSchema;
  spectraWorkspaces: typeof spectraWorkspaces;
  syllabusGuides: typeof syllabusGuides;
  syncOperationLifecycle: typeof syncOperationLifecycle;
  syncPolicy: typeof syncPolicy;
  timetableReminders: typeof timetableReminders;
  workStacks: typeof workStacks;
  workspaceLinksShared: typeof workspaceLinksShared;
  workspaceSharing: typeof workspaceSharing;
  workspaceSyllabus: typeof workspaceSyllabus;
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
  orgNodeCountByType: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"orgNodeCountByType">;
  orgNodeCountByWorkspace: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"orgNodeCountByWorkspace">;
  orgNodeCountByParent: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"orgNodeCountByParent">;
};
