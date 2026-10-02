import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import type { MeteoraPort, GraduatedPosition, LaunchTxInput, NewConfig } from "../../src/meteora/port";
import type { FakeChain } from "./fake-chain";

export class FakeMeteora implements MeteoraPort {
  partnerFee = new Map<string, bigint>();
  curve = new Map<string, { migrated: boolean; complete: boolean }>();
  graduated = new Map<string, GraduatedPosition>();
  launches: LaunchTxInput[] = [];
  configTxs: { creator: string; quoteMint: string; create: NewConfig }[] = [];
  pools = new Map<string, { baseMint: string; config: string; creator: string }>();
  progress = new Map<string, { quoteReserve: bigint; threshold: bigint; migrated: boolean }>();
  firstBuyQuotes: { configKey: string; amount: bigint }[] = [];
  firstBuyOut = async (_configKey: string, amount: bigint) => amount;
  thresholds = new Map<string, bigint>();
  configs = new Map<string, { feeClaimer: string; quoteMint: string; threshold: bigint }>();
  constructor(private chain: FakeChain) {}
  async configThreshold(configKey: string) { return this.thresholds.get(configKey) ?? 0n; }
  async configState(configKey: string) { return this.configs.get(configKey) ?? null; }
  async firstBuyMaxOut(config: string | { feeBps: number }, amount: bigint) {
    const configKey = typeof config === "string" ? config : `new:${config.feeBps}`;
    this.firstBuyQuotes.push({ configKey, amount });
    return this.firstBuyOut(configKey, amount);
  }
  async pendingPartnerQuoteFee(pool: string) { return this.partnerFee.get(pool) ?? 0n; }
  async buildClaimPartnerFee(pool: string) {
    const t = this.chain.tx(`claim-${pool}`);
    return { ...t, send: async () => { await t.send(); this.partnerFee.set(pool, 0n); } };
  }
  async buildClaimPositionFee(p: GraduatedPosition) { return this.chain.tx(`claimpos-${p.dammPool}`); }
  async curveState(pool: string) { return this.curve.get(pool) ?? { migrated: false, complete: false }; }
  async curveProgress(pool: string) { return this.progress.get(pool) ?? { quoteReserve: 0n, threshold: 1n, migrated: false }; }
  async poolInfo(pool: string) { return this.pools.get(pool) ?? null; }
  async buildMigrate(pool: string) { return this.chain.tx(`migrate-${pool}`); }
  async findGraduatedPosition(_c: string, baseMint: string) { return this.graduated.get(baseMint) ?? null; }
  // Shaped like the live ones: the creator pays, and the new account (mint or config) has signed already.
  async buildLaunchTx(input: LaunchTxInput) {
    this.launches.push(input);
    const baseMint = Keypair.generate();
    const creator = new PublicKey(input.creator);
    const tx = new Transaction({ feePayer: creator, recentBlockhash: "11111111111111111111111111111111" })
      .add(SystemProgram.createAccount({ fromPubkey: creator, newAccountPubkey: baseMint.publicKey, lamports: 1, space: 82, programId: SystemProgram.programId }));
    if (input.keeperTopUp) tx.add(SystemProgram.transfer({ fromPubkey: creator, toPubkey: new PublicKey(input.keeperTopUp.to), lamports: input.keeperTopUp.lamports }));
    tx.partialSign(baseMint);
    return { tx, baseMint, pool: `pool-${baseMint.publicKey.toBase58()}` };
  }
  async buildConfigTx(input: { creator: string; quoteMint: string; create: NewConfig }) {
    this.configTxs.push(input);
    const creator = new PublicKey(input.creator);
    const tx = new Transaction({ feePayer: creator, recentBlockhash: "11111111111111111111111111111111" })
      .add(SystemProgram.createAccount({ fromPubkey: creator, newAccountPubkey: input.create.config.publicKey, lamports: 1, space: 1000, programId: SystemProgram.programId }));
    tx.partialSign(input.create.config);
    return tx;
  }
}
