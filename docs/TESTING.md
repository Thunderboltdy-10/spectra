# Testing Spectra

Run `npm ci` before running checks. Tests use fixed model settings from
`src/test/setup.ts` and do not need production credentials.

```sh
npm run test:node
npx vitest run <files>
npm run test:run
npx tsc --noEmit
```

`test:run` runs the Node tests and the full available Vitest suite. Vitest excludes
private local instances, build caches and film projects.

## Office integration corpus

Some Office integration suites use files authored in Microsoft Office or taken
from an external preservation corpus. The binary packages remain local in `fixtures/office/` and are not distributed
with the repository. Reviewed provenance, assertion sidecars and evaluation
reports are retained in [`testing/office-corpus/`](testing/office-corpus/) as
reference material; the runnable local corpus keeps its original layout.
The application does not read them at runtime. Other tests create their inputs
in code, including the local ManageBac resource-download fixture.

When the complete corpus is present, the normal Vitest run includes these
integration suites. When it is absent or incomplete, Vitest prints a notice and
excludes those suites; a passing public-clone run does not certify the external
Office round trips. The exact suites and required inputs are listed in
[`scripts/office-corpus.mjs`](../scripts/office-corpus.mjs).

To verify the corpus and run those suites explicitly:

```sh
npm run test:office
npm run fidelity:docx
npm run fidelity:office
npm run fidelity:seam
```

These commands fail if required corpus inputs are missing. Restore the local
`fixtures/office/` directory before running them. They do not download or replace
Office-authored fixtures with synthetic files.

## Collaboration gateway

The supported gateway is Hocuspocus/Yjs, hosted on Fly.io in production. Run
`npm run test:realtime` for collaboration checks and `npm run build:realtime` to
build its Docker image. The latter requires Docker.

Gateway package tests verify that the Dockerfile copies the complete runtime
import graph. The Docker build context allows only the gateway package inputs;
local environments, databases, recovery archives and media stay outside it.

## Native Bridge and live checks

Run `cargo test` in `bridge/` for the Rust tests. Live Office COM, paired Bridge,
two-browser collaboration and hosted-service checks require their respective
local applications or configured services. Their reusable tooling is in
`scripts/fidelity-harness/` and `scripts/final-verification/`.

Engineering reports describe the checks performed at the time they were written.
Private screenshots and machine-specific run state remain local. Reviewed
product screenshots may accompany public reports. An archived report is not
evidence of a current successful run.
