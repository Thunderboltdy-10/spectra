# Spectra

Spectra is an AI-native school workspace. It is built with Next.js, Convex, Yjs real-time collaboration and a Rust desktop Bridge for native Office files.

Start with [docs/README.md](docs/README.md). It has the architecture map, how to run and test the code, the binding cross-system contracts, the open launch risks and where the launch-audit reports live.

Quick start:

```sh
cp .env.local.example .env.local   # fill in Clerk, Convex and bridge keys
npm run convex:dev                 # in one terminal
npm run dev                        # web app and collaboration gateway
npx vitest run <files>             # focused tests
```
