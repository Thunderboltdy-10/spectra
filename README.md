# Spectra Rebuild

Spectra is being rebuilt as a school-first, admin-light AI workspace.

Authoritative rebuild direction lives in:

```txt
docs/spectra-rebuild/
```

Generated repo audit and Wave 0 planning live in:

```txt
docs/spectra-rebuild/generated/
```

## Current Wave

Wave 0 establishes the foundation:

- shared Spectra primitives
- built-in artifact blueprint registry
- operation validation scaffolding
- fixed OpenRouter model configuration
- AIRun and ResultCard lifecycle scaffolding
- new `/workspace` cards/panes shell
- new `/artifacts` library/inbox shell
- legacy workspace/artifact import guard

## Development

```bash
npm install
npm run dev
```

Convex:

```bash
npm run convex:dev
```

Verification:

```bash
npm run lint
npm run test:run
npm run build
```

## Environment

Copy `.env.example` to `.env.local` and fill required keys.

The rebuild AI path uses:

```txt
SPECTRA_MODEL_ID=deepseek/deepseek-v4-pro
```
