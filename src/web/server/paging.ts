import { z } from "zod";

export const MAX_PAGE = 50;

export const pageParams = (def: number) => ({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(def),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

/** Query string as a plain object, dropping empty values so defaults apply. */
export const queryOf = (req: Request) =>
  Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ""));

/** Rows fetched with limit + 1: trims the probe row and says whether another page exists. */
export function page<T>(rows: T[], limit: number): { rows: T[]; more: boolean } {
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}
