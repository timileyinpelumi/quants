import { test, expect, spyOn } from "bun:test";
import { POST } from "../../src/app/api/client-error/route";
import { resetRateLimits } from "../../src/web/server/http";
import { reportSendFailure } from "../../src/web/wallet/report";

const post = (b: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(b) }));

test("a client send failure is logged as one compact line", async () => {
  resetRateLimits();
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    const r = await post({ step: "launch:config", message: "Your wallet changed this transaction", wallet: "Phantom" });
    expect(r.status).toBe(200);
    const line = JSON.parse(log.mock.calls[0]![0] as string);
    expect(line.clientSendFailed).toEqual({ step: "launch:config", message: "Your wallet changed this transaction", wallet: "Phantom" });
  } finally {
    log.mockRestore();
  }
});

test("oversized or malformed reports are refused, and the route is rate limited", async () => {
  resetRateLimits();
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect((await post({ step: "x", message: "m".repeat(501) })).status).toBe(400);
    expect((await post({ message: "no step" })).status).toBe(400);
    const codes = new Set<number>();
    for (let i = 0; i < 12; i++) codes.add((await post({ step: "trade:buy", message: "m" })).status);
    expect(codes.has(429)).toBe(true);
  } finally {
    log.mockRestore();
  }
});

test("the reporter posts step, message and wallet name only, and skips cancellations", async () => {
  const sent: any[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (_u: string, init: RequestInit) => { sent.push(JSON.parse(init.body as string)); return new Response("{}"); }) as any;
  try {
    reportSendFailure("launch:launch", new Error("The network rejected the transaction: insufficient lamports"), "Phantom");
    reportSendFailure("launch:launch", new Error("Transaction cancelled in your wallet."), "Phantom");
    expect(sent).toEqual([{ step: "launch:launch", message: "The network rejected the transaction: insufficient lamports", wallet: "Phantom" }]);
  } finally {
    globalThis.fetch = orig;
  }
});
