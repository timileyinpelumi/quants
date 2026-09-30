import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().url(),
  RPC_URL: z.string().url(),
  KEEPER_KEYPAIR: z.string(),
  SPILL_KEYPAIR: z.string(),
  TREASURY_ADDRESS: z.string().min(32),
  OURTOKEN_MINT: z.string().min(32),
  KAMINO_GLOBAL_CONFIG: z.string().min(32),
  DAMM_V2_MIGRATION_CONFIG: z.string().min(32),
  JUPITER_BASE_URL: z.string().url().default("https://lite-api.jup.ag/swap/v1"),
});
export type Env = z.infer<typeof Env>;
export const loadEnv = (): Env => Env.parse(process.env);
