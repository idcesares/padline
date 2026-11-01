// ADR-0003: the limits that protect the room and the free tier. One module so
// the Worker and the interface quote the same numbers.

/**
 * Document state per pad. Past it the room stops saving and the pad shows
 * "Pad is full"; at twice this it refuses edits (ADR-0003).
 */
export const MAX_DOC_BYTES = 1024 * 1024;

/** One WebSocket message. Larger frames close the connection. */
export const MAX_MESSAGE_BYTES = 256 * 1024;

/** Live connections per pad. */
export const MAX_CONNECTIONS = 50;

/** Name of the Yjs text that holds a pad's content. */
export const TEXT_KEY = "text";

/** Application close codes, over the WebSocket (RFC 6455 4000-4999). */
export const CLOSE = {
  invalidSlug: 4400,
  removed: 4404,
  busy: 1013,
  tooLarge: 1009,
} as const;

/** Custom message the room broadcasts when a pad crosses MAX_DOC_BYTES. */
export const MSG_PAD_FULL = "pad-full";

/** Broadcast once the pad is back under the limit, so clients can drop the banner. */
export const MSG_PAD_OK = "pad-ok";
