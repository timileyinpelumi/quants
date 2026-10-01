import { PublicKey, type Connection, type Transaction } from "@solana/web3.js";
import type { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { buildQuantsConfig, type QuoteSpec } from "./config";
import { quoteTokenBadge } from "./port";

/** A config key whose partner fees and leftovers go to the keeper; Token-2022 quotes carry their token badge when one exists. */
export async function createConfigTx(
  client: DynamicBondingCurveClient, conn: Pick<Connection, "getAccountInfo">, keeper: PublicKey, config: PublicKey, feeBps: number, quote: QuoteSpec,
): Promise<Transaction> {
  const quoteMint = new PublicKey(quote.mint);
  return client.partner.createConfig({
    config, feeClaimer: keeper, leftoverReceiver: keeper, quoteMint, payer: keeper,
    tokenBadge: await quoteTokenBadge(conn, quoteMint),
    ...buildQuantsConfig(feeBps, quote),
  });
}
