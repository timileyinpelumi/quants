import { sharedDb } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const [r] = await sharedDb()`select 1 as ok`;
  return Response.json({ ok: r.ok === 1 });
}
