import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit } from "@/web/server/http";
import { LaunchError } from "@/launch/prepare";

export const dynamic = "force-dynamic";

const ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** One token balance through the server's providers; "amount" is null when it could not be read, never a false zero. */
export async function GET(req: Request, { params }: { params: Promise<{ owner: string }> }) {
  try {
    rateLimit(req, "balance", 120);
    const owner = (await params).owner;
    const mint = new URL(req.url).searchParams.get("mint") ?? "";
    if (!ADDR.test(owner) || !ADDR.test(mint)) throw new LaunchError("invalid_input", "Address is not valid");
    const { conn } = getContext();
    if (mint === "So11111111111111111111111111111111111111112") {
      const lamports = await conn.getBalance(new PublicKey(owner), "confirmed").catch(() => null);
      return json({ amount: lamports === null ? null : String(lamports) });
    }
    const info = await conn.getAccountInfo(new PublicKey(mint)).catch(() => undefined);
    if (info === undefined) return json({ amount: null });
    if (info === null) return json({ amount: "0" });
    const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, info.owner);
    const acct = await conn.getAccountInfo(ata).catch(() => undefined);
    if (acct === undefined) return json({ amount: null });
    if (acct === null) return json({ amount: "0" });
    const r = await conn.getTokenAccountBalance(ata).catch(() => null);
    return json({ amount: r ? r.value.amount : null });
  } catch (e) {
    return jsonError(e);
  }
}
