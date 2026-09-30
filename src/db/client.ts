import { SQL } from "bun";
export const db = (url = process.env.DATABASE_URL!) => new SQL(url);
