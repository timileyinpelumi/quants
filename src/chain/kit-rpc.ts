import { createDefaultRpcTransport, createSolanaRpcFromTransport, type RpcTransport } from "@solana/kit";

// A rate limit, a server error or a network failure moves on to the next provider; an answer, even an RPC error, is final.
const retryable = (e: unknown) => {
  const status = (e as { context?: { statusCode?: number } })?.context?.statusCode;
  return status === undefined || status === 429 || status >= 500;
};

/** Tries each transport in order until one answers. */
export function failover(transports: RpcTransport[]): RpcTransport {
  return (async (config: Parameters<RpcTransport>[0]) => {
    let last: unknown;
    for (const t of transports) {
      try {
        return await t(config);
      } catch (e) {
        if (!retryable(e)) throw e;
        last = e;
      }
    }
    throw last;
  }) as RpcTransport;
}

/** A kit RPC client over several providers, so one provider's rate limit does not fail the read. */
export const failoverRpc = (urls: string[]) => createSolanaRpcFromTransport(failover(urls.map((url) => createDefaultRpcTransport({ url }))));
