import { PublicKey, type Connection } from "@solana/web3.js";
import { BorshCoder } from "@coral-xyz/anchor";
import bs58 from "bs58";
import { DynamicBondingCurveIdl } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmmIdl } from "@meteora-ag/cp-amm-sdk";
import type { ChainHistory, IndexedTx, MissingTx, PoolSwap, SignatureInfo } from "./run";

const DBC = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
const DAMM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
const coders = { [DBC]: new BorshCoder(DynamicBondingCurveIdl as any), [DAMM]: new BorshCoder(CpAmmIdl as any) } as Record<string, BorshCoder>;
const PAGE = 1000;
const FIRST_READ_PAGES = 10;
const MAX_PAGES = 100;
const EVENT_IX_TAG = Buffer.from("e445a52e51cb9a1d", "hex");

const big = (v: { toString(): string }) => BigInt(v.toString());

function toSwap(program: string, data: any, eventIndex: number): PoolSwap {
  const r = data.swap_result;
  const buy = data.trade_direction === 1; // quote to base in both programs; token A is the base
  const fee = program === DBC
    ? big(r.trading_fee) + big(r.protocol_fee) + big(r.referral_fee)
    : big(r.claiming_fee) + big(r.protocol_fee) + big(r.compounding_fee) + big(r.referral_fee);
  return {
    eventIndex,
    venue: program === DBC ? "curve" : "damm",
    side: buy ? "buy" : "sell",
    baseAmount: buy ? big(r.output_amount) : big(r.included_fee_input_amount),
    quoteAmount: buy ? big(r.included_fee_input_amount) : big(r.output_amount),
    feeAmount: fee,
    sqrtPrice: big(r.next_sqrt_price),
    ...(program === DBC ? { curve: { reserve: big(data.quote_reserve_amount), threshold: big(data.migration_threshold) } } : {}),
  };
}

export class RpcHistory implements ChainHistory {
  constructor(private conn: Connection) {}

  // Pages back from the newest signature to `until`. With no cursor (first read of a pool) only the newest
  // FIRST_READ_PAGES pages are taken, so older trades on a busy pool are not backfilled. With a cursor it pages
  // all the way back, and a backlog over MAX_PAGES is an error so the cursor never jumps over unread trades.
  async signaturesSince(address: string, until: string | null): Promise<SignatureInfo[]> {
    const out: SignatureInfo[] = [];
    let before: string | undefined;
    for (let i = 0; ; i++) {
      if (until === null && i === FIRST_READ_PAGES) break;
      if (i === MAX_PAGES) throw new Error(`more than ${MAX_PAGES * PAGE} new signatures on ${address}`);
      const page = await this.conn.getSignaturesForAddress(new PublicKey(address), { before, until: until ?? undefined, limit: PAGE }, "confirmed");
      out.push(...page.map((x) => ({ signature: x.signature, blockTime: x.blockTime ?? null })));
      if (page.length < PAGE) break;
      before = page.at(-1)!.signature;
    }
    return out.reverse();
  }

  async transactions(signatures: string[], address: string): Promise<(IndexedTx | MissingTx)[]> {
    const txs = await this.conn.getTransactions(signatures, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    return txs.map((tx, i): IndexedTx | MissingTx => {
      if (!tx?.meta || !tx.blockTime) return { signature: signatures[i]!, missing: true };
      const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
      const swaps: PoolSwap[] = [];
      let eventIndex = 0;
      for (const group of tx.meta.innerInstructions ?? []) {
        for (const ix of group.instructions) {
          const program = keys.get(ix.programIdIndex)?.toBase58();
          const coder = program ? coders[program] : undefined;
          if (!coder) continue;
          const raw = Buffer.from(bs58.decode(ix.data));
          if (raw.length < 16 || !raw.subarray(0, 8).equals(EVENT_IX_TAG)) continue;
          let ev: { name: string; data: any } | null = null;
          try { ev = coder.events.decode(raw.subarray(8).toString("base64")); } catch { ev = null; }
          if (!ev) continue;
          const at = eventIndex++;
          if (ev.name === "EvtSwap2" && ev.data.pool.toBase58() === address) swaps.push(toSwap(program!, ev.data, at));
        }
      }
      return { signature: signatures[i]!, failed: tx.meta.err !== null, blockTime: tx.blockTime, slot: tx.slot, trader: keys.get(0)!.toBase58(), swaps };
    });
  }
}
