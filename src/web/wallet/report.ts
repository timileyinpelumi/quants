const CANCELLED = /cancelled in your wallet/i;

/** Sends a short record of a failed send to the server log. Never throws; cancellations are not reported. */
export function reportSendFailure(step: string, error: unknown, wallet: string | undefined) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  if (CANCELLED.test(message)) return;
  try {
    void fetch("/api/client-error", {
      method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
      body: JSON.stringify({ step: step.slice(0, 40), message, ...(wallet ? { wallet: wallet.slice(0, 60) } : {}) }),
    }).catch(() => {});
  } catch {
    // reporting is best effort
  }
}
