/**
 * The signed gateway envelope can contain both a bounded native Yjs snapshot
 * and its canonical projection during first-room bootstrap. Each part has its
 * own tighter limit; this outer allowance only accounts for their combined
 * JSON representation plus metadata.
 */
export const MAX_COLLABORATION_BRIDGE_PAYLOAD_CHARACTERS = 2_000_000;
