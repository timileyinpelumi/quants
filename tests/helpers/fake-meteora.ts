import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import type { MeteoraPort, GraduatedPosition, LaunchTxInput } from "../../src/meteora/port";
import type { FakeChain } from "./fake-chain";

export class FakeMeteora implements MeteoraPort {
  partnerFee = new Map<string, bigint>();
  curve = new Map<string, { migrated: boolean; complete: boolean }>();
  graduated = new Map<string, GraduatedPosition>();
  launches: LaunchTxInput[] = [];
  constructor(private chain: FakeChain) {}
  async pendingPartnerQuoteFee(pool: string) { return this.partnerFee.get(pool) ?? 0n; }
  async buildClaimPartnerFee(pool: string) { return this.chain.tx(`claim-${pool}`); }
  async buildClaimPositionFee(p: GraduatedPosition) { return this.chain.tx(`claimpos-${p.dammPool}`); }
  async curveState(pool: string) { return this.curve.get(pool) ?? { migrated: false, complete: false }; }
  async buildMigrate(pool: string) { return this.chain.tx(`migrate-${pool}`); }
  async findGraduatedPosition(_c: string, baseMint: string) { return this.graduated.get(baseMint) ?? null; }
  async buildLaunchTx(input: LaunchTxInput) {
    this.launches.push(input);
    const baseMint = Keypair.generate();
    const tx = new Transaction({ feePayer: baseMint.publicKey, recentBlockhash: "11111111111111111111111111111111" })
      .add(SystemProgram.transfer({ fromPubkey: baseMint.publicKey, toPubkey: baseMint.publicKey, lamports: 1 }));
    return { tx, baseMint, pool: `pool-${baseMint.publicKey.toBase58()}` };
  }
}
