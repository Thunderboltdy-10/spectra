# Spectra

Spectra is an AI-native school workspace. It is built with Next.js, Convex, Yjs real-time collaboration and a Rust desktop Bridge for native Office files.

https://github.com/user-attachments/assets/a19a1e71-8a6b-437f-881f-c435cff57344

Start with the [engineering overview](docs/README.md) for the architecture, development workflow and cross-system contracts. See the [environment guide](docs/ENVIRONMENT.md) for configuration and the [launch guide](docs/LAUNCH.md) for deployment.

## Repository map

| Path | Contents |
| --- | --- |
| [`src/`](src/) | Next.js app, product features, components and styles |
| [`convex/`](convex/), [`shared/`](shared/) | Backend functions and shared contracts |
| [`bridge/`](bridge/) | Rust/Tauri desktop Bridge for native Office files |
| [`scripts/`](scripts/), [`fixtures/`](fixtures/) | Development tools, verification harnesses and test fixtures |
| [`deploy/`](deploy/), [`workers/`](workers/) | Collaboration gateway deployment and optional Cloudflare realtime provider |
| [`docs/`](docs/) | Engineering, product and design docs, launch audits and archived plans |

## Quick start

```sh
npm ci
cp .env.example .env.local # configure keys and model settings using the environment guide
npm run convex:dev         # in one terminal
npm run dev                # web app and collaboration gateway, in another terminal
npx vitest run <files>     # focused tests
```

## Local files

Local instances and data live in `.spectra-local/`; review captures live in `.shots/`.
Local film projects and recording assets also stay on disk and are ignored by Git.
Historical audit reports may refer to local captures that are unavailable in a fresh clone.
