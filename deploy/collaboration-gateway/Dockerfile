# Build from the repository root so package.json is in the Docker context:
#   docker build -f deploy/collaboration-gateway/Dockerfile .
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV SPECTRA_COLLAB_PORT=1234
ENV SPECTRA_COLLAB_HOST=0.0.0.0
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY scripts/collaboration-gateway.mjs \
     scripts/collaboration-artifact-projection.mjs \
     scripts/collaboration-canonical-room.mjs \
     scripts/serve-collaboration-gateway.mjs \
     scripts/load-collaboration-env.mjs \
     scripts/collaboration-gateway-process.mjs \
     scripts/collaboration-gateway-bridge-client.mjs \
     scripts/collaboration-durable-capacity.mjs \
     scripts/collaboration-persist.mjs \
     scripts/collaboration-update-envelope.mjs \
     scripts/collaboration-native-projection.mjs \
     scripts/collaboration-checkpoint.mjs \
     scripts/collaboration-health.mjs \
     scripts/collaboration-reconnect.mjs \
     scripts/collaboration-room-state.mjs \
     ./scripts/
COPY shared/collaboration-framing.mjs \
     shared/collaboration-durable-frontier.mjs \
     shared/collaboration-recovery.mjs \
     shared/sheet-regions.mjs \
     shared/document-projection.mjs \
     shared/durable-dependencies.mjs \
     shared/convex-error.mjs \
     shared/sync-retry-policy.json \
     ./shared/
EXPOSE 1234
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SPECTRA_COLLAB_PORT||1234)+'/_spectra/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/serve-collaboration-gateway.mjs"]
