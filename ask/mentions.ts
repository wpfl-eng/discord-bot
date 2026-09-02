/**
 * Every /ask send and edit that carries text somebody else wrote -- the
 * member's question, the model's tool inputs, the model's prose, a fetched
 * page quoted in it -- parses no mentions. The casino renderers do the same
 * on every payload, and for the same reason: an unescaped <@id> in real
 * message content pings. Refusal replies carry bot text only and keep the
 * default, so the person refused is still pinged (log Stage 14, decision 8).
 */
export const NO_MENTIONS = { parse: [] } as const;
