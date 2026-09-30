import type { ChainPort, SigState, SignedTx } from "../../src/chain/port";

export class FakeChain implements ChainPort {
  height = 100n;
  states = new Map<string, SigState>();
  receipts = new Map<string, bigint>();
  balances = new Map<string, bigint>();
  sent: string[] = [];
  nextOutcome: SigState = "confirmed";
  sendThrows = false;
  private n = 0;

  tx(label = "tx"): SignedTx {
    const signature = `${label}-${++this.n}`;
    return {
      signature,
      lastValidBlockHeight: this.height + 150n,
      send: async () => {
        if (this.sendThrows) throw new Error("rpc down");
        this.sent.push(signature);
        this.states.set(signature, this.nextOutcome);
      },
    };
  }
  async status(sig: string) { return this.states.get(sig) ?? "unknown"; }
  async blockHeight() { return this.height; }
  async waitForConfirmation(sig: string) { return this.status(sig); }
  async received(sig: string) { return this.receipts.get(sig) ?? 0n; }
  async buildTransfer() { return this.tx("transfer"); }
  async buildBurn() { return this.tx("burn"); }
  async balance(owner: string, mint: string) { return this.balances.get(`${owner}:${mint}`) ?? 0n; }
}
