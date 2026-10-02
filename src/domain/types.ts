/** `lp`: fees claimed from a graduated launch's locked DAMM v2 position; they all go to the treasury, never split. */
export type Bucket = "unsplit" | "lp" | "basket" | "reward" | "creator" | "treasury" | "penalty";
export interface FeeSplit { basketBps: number; platformBps: number; creatorBps: number }
export interface LockTier { id: string; lockSeconds: number; multiplierBps: number }
export const BPS = 10_000n;
export const NATIVE_MINT = "So11111111111111111111111111111111111111112";
