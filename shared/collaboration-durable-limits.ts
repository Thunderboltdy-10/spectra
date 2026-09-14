/**
 * Shared durable collaboration byte budgets.
 * Keep scripts/collaboration-update-envelope.mjs and the Cloudflare worker
 * protocol in lockstep with these values (see capacity parity tests).
 */
export const MAX_DURABLE_UPDATE_BYTES = 760 * 1024;
export const MAX_REALTIME_MESSAGE_BYTES = 1024 * 1024;
export const MAX_PROJECTION_JSON_CHARS = 900_000;
export const MAX_PROJECTION_JSON_UTF8_BYTES = 900_000;
export const MAX_COMPACTION_STATE_VECTOR_BYTES = 128 * 1024;
export const DURABLE_PAYLOAD_MANIFEST_VERSION = 1 as const;
