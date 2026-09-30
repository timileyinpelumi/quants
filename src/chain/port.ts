export interface SignedTx { signature: string; lastValidBlockHeight: bigint; send(): Promise<void> }
export type SigState = "confirmed" | "failed" | "unknown";
export interface ChainPort {
  status(sig: string): Promise<SigState>;
  blockHeight(): Promise<bigint>;
  waitForConfirmation(sig: string, lastValidBlockHeight: bigint): Promise<SigState>;
  received(sig: string, owner: string, mint: string): Promise<bigint>;
  buildTransfer(mint: string, to: string, amount: bigint): Promise<SignedTx>;
  buildBurn(mint: string, amount: bigint): Promise<SignedTx>;
  balance(owner: string, mint: string): Promise<bigint>;
}
