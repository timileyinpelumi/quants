import { getContext } from "@/web/server/context";
import { subscribeTicker } from "@/web/server/ticker";

export const dynamic = "force-dynamic";

/** Server-sent events: the home ticker's shared stream, one item every few seconds. */
export async function GET(req: Request) {
  const { sql } = getContext();
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(ctl) {
      const send = (s: string) => { try { ctl.enqueue(enc.encode(s)); } catch {} };
      const off = subscribeTicker(sql, (row) => send(`data: ${JSON.stringify(row)}\n\n`));
      const beat = setInterval(() => send(": keep alive\n\n"), 15_000);
      stop = () => { off(); clearInterval(beat); try { ctl.close(); } catch {} };
      req.signal.addEventListener("abort", () => stop());
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}
