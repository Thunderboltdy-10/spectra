import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {afterEach, expect, it, vi} from "vitest";
import * as Y from "yjs";
import {createCollaborationGatewayBridgeClient} from "./collaboration-gateway-bridge-client.mjs";
import {planMergedUpdatePersist} from "./collaboration-durable-capacity.mjs";
import {samePersistenceBatch} from "./collaboration-persist.mjs";
import {createCanonicalRoom, prepareCanonicalAppend, mergeCanonicalIntoLive, nativeOverlap, stateVectorHash} from "./collaboration-canonical-room.mjs";
import {MAX_DURABLE_UPDATE_BYTES} from "./collaboration-update-envelope.mjs";
import {artifactProjection} from "./collaboration-artifact-projection.mjs";
import {initializeNativeArtifactDocument, isNativeArtifactDocument, nativeArtifactProjection, nativeChangedRegionIds} from "./collaboration-native-projection.mjs";

afterEach(() => vi.unstubAllGlobals());

it.each([true, false].flatMap(native => [[false, true], [true, false], [true, true], [false, false]].map(([published, nextPublished]) => [native, published, nextPublished])))(
  "projects quiz publication (native %s) %s → %s in the existing append only when the gate changes",
  async (native, published, nextPublished) => {
    const doc = new Y.Doc();
    if (native) initializeNativeArtifactDocument(doc, { title: "Quiz", typeKey: "quiz", schemaVersion: 4, tags: [], content: { published, questions: [] } });
    else {
      const metadata = doc.getMap("spectra:artifact-meta");
      for (const [key, value] of Object.entries({ initialized: true, title: "Quiz", typeKey: "quiz", schemaVersion: 4, tags: [], rootTemplate: JSON.stringify({ published: { $spectraRegion: "quiz:published" }, questions: [] }) })) metadata.set(key, value);
      doc.getMap("spectra:artifact-regions").set("quiz:published", JSON.stringify({ value: published }));
    }
    const initial = Y.encodeStateAsUpdate(doc), vector = Y.encodeStateVector(doc);
    const before = nativeArtifactProjection(doc, 4);
    if (native) {
      doc.getMap("spectra:work-v2").set("published", nextPublished);
      doc.getMap("spectra:work-v2").set("publishedAt", 123);
    } else doc.getMap("spectra:artifact-regions").set("quiz:published", JSON.stringify({ value: nextPublished }));
    const after = nativeArtifactProjection(doc, 4), delta = Y.encodeStateAsUpdate(doc, vector);
    const room = createCanonicalRoom({ expectedRoomId: "room", load: async () => ({ roomId: "room", nextSequence: 2, updates: [{ sequence: 1, update: initial }] }) });
    const append = vi.fn(async prepare => {
      const prepared = await prepare();
      expect(prepared.payload.projectionJson === null).toBe(published === nextPublished);
      if (prepared.payload.projectionJson) expect(JSON.parse(prepared.payload.projectionJson).content.published).toBe(nextPublished);
      return { ...prepared, result: { sequence: 2, duplicate: false } };
    });
    const source = readFileSync("scripts/collaboration-gateway.mjs", "utf8");
    const modelCode = source.slice(source.indexOf("function artifactModelState("), source.indexOf("function extractYjsUpdate("));
    const model = new Function("META_MAP", "REGION_MAP", `${modelCode}; return {artifactModelState, changedArtifactRegions};`)("spectra:artifact-meta", "spectra:artifact-regions");
    const deps = { ...model, Y, createHash, samePersistenceBatch, isNativeArtifactDocument, nativeChangedRegionIds, nativeOverlap,
      NATIVE_PROJECTION_REGION: "$spectra:native-projection", planMergedUpdatePersist, MAX_DURABLE_UPDATE_BYTES,
      canonicalRoom: () => room, prepareCanonicalAppend, mergeCanonicalIntoLive, appendWithRetry: append,
      artifactProjection,
      documentPersistenceQueues: new WeakMap(), unappliedDocumentMessages: new WeakSet(), openDocuments: new Map(),
      documentDurableAnchors: new WeakMap(), documentFrontierHash: () => null, durableHeadKey: () => "quiz:root", sendGatewayState: vi.fn(),
      documentStateVectorHash: stateVectorHash,
      checkpointScheduler: () => ({ note: vi.fn() }) };
    const code = source.slice(source.indexOf("async function persistAcceptedMessages("), source.indexOf("function schedulePersistence("));
    const persist = new Function(...Object.keys(deps), `${code}; return persistAcceptedMessages;`)(...Object.values(deps));
    const context = { artifactId: "quiz", partitionKey: "root", accountId: "owner", clientId: "human", actorKind: "human", schemaVersion: 4, policyVersion: 0 };
    try {
      await persist(doc, [{ context, documentUpdate: delta, nativeProjectionBefore: before, nativeProjectionAfter: after, messageId: "publish" }]);
      expect(append).toHaveBeenCalledOnce();
    } finally { await room.dispose(); doc.destroy(); }
  },
);

it("does not acknowledge semantically unchanged Yjs structs before their durable append", async () => {
  const source=readFileSync("scripts/collaboration-gateway.mjs","utf8");
  const code=source.slice(source.indexOf("async function persistAcceptedMessages("),source.indexOf("function schedulePersistence("));
  const doc=new Y.Doc();
  initializeNativeArtifactDocument(doc,{title:"Sheet",typeKey:"sheets",schemaVersion:4,tags:[],content:{sheets:[{id:"s",name:"Sheet",cells:{A1:{value:1}}}]}});
  const before=nativeArtifactProjection(doc,4);
  const initial=Y.encodeStateAsUpdate(doc);
  const vector=Y.encodeStateVector(doc);
  doc.getMap("causal-only-metadata").set("operation","one");
  const delta=Y.encodeStateAsUpdate(doc,vector);
  const ack=vi.fn();
  const append=vi.fn(async prepare => {
    const prepared = await prepare();
    expect(prepared.payload.regionIds).toEqual(["$spectra:native-projection"]);
    throw new Error("fixture persistence failure");
  });
  const room=createCanonicalRoom({expectedRoomId:"room",load:async()=>({roomId:"room",nextSequence:2,
    updates:[{sequence:1,update:initial}]})});
  const deps={Y, samePersistenceBatch, isNativeArtifactDocument, nativeArtifactProjection, nativeChangedRegionIds,
    NATIVE_PROJECTION_REGION:"$spectra:native-projection",sendGatewayState:ack,planMergedUpdatePersist,
    MAX_DURABLE_UPDATE_BYTES,canonicalRoom:()=>room,prepareCanonicalAppend,mergeCanonicalIntoLive,
    nativeOverlap,
    artifactProjection:document=>JSON.stringify(nativeArtifactProjection(document,4)),
    createHash,appendWithRetry:append,checkpointScheduler:()=>({note:vi.fn()})};
  const persist=new Function(...Object.keys(deps),`${code}; return persistAcceptedMessages;`)(...Object.values(deps));
  const context={artifactId:"a",partitionKey:"root",accountId:"owner",clientId:"human",actorKind:"human",schemaVersion:4,policyVersion:0};
  try {
    await expect(persist(doc,[{context,documentUpdate:delta,nativeProjectionBefore:before,baseStateVectorHash:"base-hash",stateVectorHash:"new-hash",messageId:"m"}],Y.encodeStateAsUpdate(doc))).rejects.toThrow("fixture persistence failure");
    expect(append).toHaveBeenCalledOnce();
    expect(ack).not.toHaveBeenCalled();
  } finally {await room.dispose();doc.destroy();}
});

it.each(["missing", "digest", "sequence", "generation"])("refuses incomplete replay: %s", async failure => {
  const body=Buffer.from([1,2,3]);
  const payload={url:"https://fixture.invalid/blob",digest:createHash("sha256").update(body).digest("hex"),byteLength:body.length};
  vi.stubGlobal("fetch", vi.fn(async () => new Response(failure === "digest" ? new Uint8Array([4,5,6]) : body,{status:failure === "missing" ? 404 : 200})));
  let page=0;
  const bridge=createCollaborationGatewayBridgeClient({convexUrl:"https://fixture.invalid",bridgeKey:"fixture-key".repeat(4),
    client:{action:async()=> {
      page++;
      if(failure === "generation") return page===1
        ? {roomId:"one",nextSequence:3,afterSequence:1,hasMore:true,updates:[{sequence:1,update:"AQ=="}]}
        : {roomId:"two",nextSequence:3,afterSequence:2,updates:[{sequence:2,update:"Ag=="}]};
      return {roomId:"one",nextSequence:2,afterSequence:1,updates:[{sequence:failure === "sequence" ? 2 : 1,payload}]};
    }}});
  await expect(bridge("load",{artifactId:"a",partitionKey:"root"})).rejects.toThrow(/COLLABORATION_(DURABLE_PAYLOAD|REPLAY_GENERATION)/);
});
