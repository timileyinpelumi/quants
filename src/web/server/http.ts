import { ZodError } from "zod";
import { LaunchError } from "@/launch/prepare";

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) { super(message); }
}

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, replacer), { status, headers: { "content-type": "application/json" } });

export function jsonError(e: unknown): Response {
  if (e instanceof LaunchError) return json({ error: { code: e.code, message: e.message } }, 400);
  if (e instanceof AuthError) return json({ error: { code: e.status === 401 ? "unauthorized" : "forbidden", message: e.message } }, e.status);
  if (e instanceof ZodError) return json({ error: { code: "invalid_input", message: e.issues.map((i) => i.message).join("; ") } }, 400);
  console.error(e);
  return json({ error: { code: "internal", message: "Something went wrong" } }, 500);
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new LaunchError("invalid_input", "Body must be JSON");
  }
}
