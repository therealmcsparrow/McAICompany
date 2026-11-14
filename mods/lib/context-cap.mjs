// The one context cap formula. Pure: no Node import, no npm.
export const CONTEXT_CAP_DEFAULT = 180000;
export const CONTEXT_CAP_MIN = 60000;
export const CONTEXT_CAP_MAX = 1000000;

// The hand-over point for a cap: nine tenths, rounded down.
export const handoverOf = (cap) => Math.floor((cap * 9) / 10);
