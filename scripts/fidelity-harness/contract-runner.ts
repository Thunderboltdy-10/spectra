import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { registeredLens } from "../../src/features/spectra/lenses/registry";
import type {
  LensOpenResult,
  SpectraLens,
} from "../../src/features/spectra/lenses/types";

const sidecarSchema = z
  .object({
    name: z.string().min(1),
    nativeFormat: z.string().min(1),
    rawFixtureContains: z.array(z.string()).default([]),
    projectionContains: z.array(z.string()).default([]),
    fidelity: z.array(
      z
        .object({
          feature: z.string().min(1),
          class: z.enum(["NATIVE", "EQUIVALENT", "PRESERVED", "EXTENSION"]),
          readOnly: z.boolean().optional(),
          reasonContains: z.string().min(1).optional(),
        })
        .strict(),
    ),
    noOpByteIdentical: z.literal(true),
    mutation: z
      .object({
        delta: z.record(z.string(), z.unknown()),
        projectionContains: z.array(z.string()).min(1),
      })
      .strict(),
  })
  .strict();

export type LensFixtureSidecar = z.infer<typeof sidecarSchema>;

export type LensFixtureContract<P, D> = {
  fixturePath: string;
  sidecarPath: string;
  projectionText: (projection: P) => string;
  parseDelta: (value: unknown) => D;
};

export type LensFixtureContractResult = {
  name: string;
  nativeFormat: string;
  sourceBytes: number;
  outputBytes: number;
  changedRegions: string[];
};

/**
 * Shared non-live L1 floor for every format/provider fixture. Sidecars are
 * asserted against source bytes, lens projection, fidelity, no-op identity,
 * mutation output, and diff visibility; write-only reports cannot pass.
 */
export async function runLensFixtureContract<P, D>(
  input: LensFixtureContract<P, D>,
): Promise<LensFixtureContractResult> {
  const [sourceBuffer, sidecarText] = await Promise.all([
    readFile(input.fixturePath),
    readFile(input.sidecarPath, "utf8"),
  ]);
  const source = Uint8Array.from(sourceBuffer);
  const sidecar = sidecarSchema.parse(JSON.parse(sidecarText));
  const lens = registeredLens<P, D>(sidecar.nativeFormat);
  const rawText = new TextDecoder("utf-8", { fatal: true }).decode(source);
  const normalizedRawText = normalizedLineEndings(rawText);
  for (const expected of sidecar.rawFixtureContains) {
    assert.ok(
      normalizedRawText.includes(normalizedLineEndings(expected)),
      `${sidecar.name}: sidecar claims source contains ${JSON.stringify(expected)}.`,
    );
  }

  const opened = await lens.open(source, "strict-native");
  assertProjectionContains(sidecar, input.projectionText(opened.projection));
  for (const expected of sidecar.fidelity) {
    const entry = opened.fidelityMap.entries.find(
      (candidate) => candidate.feature === expected.feature,
    );
    assert.ok(
      entry,
      `${sidecar.name}: missing fidelity feature ${expected.feature}.`,
    );
    assert.equal(
      entry.class,
      expected.class,
      `${sidecar.name}:${expected.feature} class`,
    );
    if (expected.readOnly !== undefined) {
      assert.equal(
        entry.readOnly,
        expected.readOnly,
        `${sidecar.name}:${expected.feature} readOnly`,
      );
    }
    if (expected.reasonContains) {
      assert.ok(
        entry.reason?.includes(expected.reasonContains),
        `${sidecar.name}:${expected.feature} reason must include ${expected.reasonContains}.`,
      );
    }
  }

  const noOp = await lens.materialize({
    projection: opened.projection,
    carry: opened.preservedCarry,
  });
  assert.deepEqual(
    noOp,
    source,
    `${sidecar.name}: a semantic no-op changed native bytes.`,
  );

  const output = await mutateFixture(
    lens,
    opened,
    input.parseDelta(sidecar.mutation.delta),
  );
  const reopened = await lens.open(output, "strict-native");
  const reopenedText = normalizedLineEndings(
    input.projectionText(reopened.projection),
  );
  for (const expected of sidecar.mutation.projectionContains) {
    assert.ok(
      reopenedText.includes(normalizedLineEndings(expected)),
      `${sidecar.name}: mutated projection does not contain ${JSON.stringify(expected)}.`,
    );
  }
  const diff = await lens.diffExternal(source, output);
  assert.ok(
    diff.changes.length,
    `${sidecar.name}: mutation is invisible to diffExternal.`,
  );
  assert.ok(
    diff.changedParts.length,
    `${sidecar.name}: changed bytes have no changed-part fact.`,
  );

  return {
    name: sidecar.name,
    nativeFormat: sidecar.nativeFormat,
    sourceBytes: source.byteLength,
    outputBytes: output.byteLength,
    changedRegions: diff.changes.map((change) => change.regionId),
  };
}

function assertProjectionContains(
  sidecar: LensFixtureSidecar,
  projectionText: string,
) {
  const normalizedProjection = normalizedLineEndings(projectionText);
  for (const expected of sidecar.projectionContains) {
    assert.ok(
      normalizedProjection.includes(normalizedLineEndings(expected)),
      `${sidecar.name}: projection does not contain ${JSON.stringify(expected)}.`,
    );
  }
}

function normalizedLineEndings(value: string) {
  return value.replace(/\r\n?|\n/gu, "\n");
}

async function mutateFixture<P, D>(
  lens: SpectraLens<P, D>,
  opened: LensOpenResult<P>,
  delta: D,
) {
  return lens.mutate(opened.preservedCarry, delta);
}
