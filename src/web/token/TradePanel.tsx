"use client";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

export function TradePanel({ mint, quoteMint }: { mint: string; quoteMint: string }) {
  const wallet = useWallet();
  const started = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      if (!window.Jupiter || started.current) return;
      started.current = true;
      window.Jupiter.init({
        displayMode: "integrated",
        integratedTargetId: "jupiter-plugin",
        enableWalletPassthrough: true,
        passthroughWalletContextState: wallet,
        formProps: { initialInputMint: quoteMint, initialOutputMint: mint, fixedMint: mint },
        containerStyles: { borderRadius: "24px" },
      });
      setReady(true);
      clearInterval(t);
    }, 200);
    return () => clearInterval(t);
    // Initialise once; wallet changes go through syncProps below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint, quoteMint]);

  useEffect(() => {
    if (ready) window.Jupiter?.syncProps({ passthroughWalletContextState: wallet });
  }, [ready, wallet]);

  return (
    <div className="panel p-3 min-h-[440px] flex flex-col">
      <div id="jupiter-plugin" className="flex-1 min-h-[420px]" />
      {!ready && <div className="flex-1 flex items-center justify-center text-sm text-muted">Loading swap</div>}
    </div>
  );
}
