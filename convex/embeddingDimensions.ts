/**
 * Vector size requested from the provider and declared by every vector index. It lives alone
 * because the schema needs it, and the schema may not reach anything that reads the environment.
 */
export const EMBEDDING_DIMENSIONS = 256;
