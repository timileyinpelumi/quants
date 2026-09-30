import { SQL } from "bun";

export const db = (url = process.env.DATABASE_URL!) => new SQL(url);

let shared: SQL | undefined;
export const sharedDb = () => (shared ??= db());
