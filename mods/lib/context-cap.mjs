// The context cap constants and formula for readers outside the engine. The numbers live in hooks/rules/cap.mjs.
import { DEFAULT_THRESHOLD, MIN_THRESHOLD, MAX_THRESHOLD, freezeAt } from '../../hooks/rules/cap.mjs';

export const CONTEXT_CAP_DEFAULT = DEFAULT_THRESHOLD;
export const CONTEXT_CAP_MIN = MIN_THRESHOLD;
export const CONTEXT_CAP_MAX = MAX_THRESHOLD;

// The hand-over point for a cap: nine tenths, rounded down.
export const handoverOf = freezeAt;
