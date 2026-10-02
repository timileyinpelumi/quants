export async function register() {
  // The NEXT_RUNTIME check must wrap the import so the edge build drops env.ts (it reads keypair files with node:fs).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    const { checkWebEnv } = await import("./env");
    checkWebEnv(process.env);
  }
}
