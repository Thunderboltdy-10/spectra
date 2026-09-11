// Files use Convex's generated storage upload URL, whose documented file size
// is unbounded apart from the two-minute POST timeout. These remain product
// integrity ceilings, not encoded function-argument limits.
export const MAX_ASSET_BYTES = 100_000_000;
export const MAX_IMPORT_ORIGINAL_BYTES = 80_000_000;
// JSON import envelopes may carry one or more rich-image data URLs before the
// server replaces them with durable asset identities. This is a request
// transport ceiling, not the persisted semantic-content ceiling below.
export const MAX_IMPORT_REQUEST_BYTES = 32_000_000;
export const MAX_PERSISTED_CONTENT_BYTES = 900_000;
export const MAX_ATTACHMENT_BYTES = 25_000_000;
