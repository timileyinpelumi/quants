import type { Cluster } from "../cluster";

/** Roles of the platform HD wallet, in derivation order: role i is m/44'/501'/i'/0'. */
export const ROLES = ["keeper", "spill", "treasury", "admin", "platform-token"] as const;
export type Role = (typeof ROLES)[number];

export const rolePath = (role: Role) => `m/44'/501'/${ROLES.indexOf(role)}'/0'`;

/** The keeper pays for fee claims and farm setup; below this it cannot send its first claim. */
export const KEEPER_LOW_LAMPORTS = 10_000_000n;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** PLATFORM_ADDRESSES is public config: {"keeper": "<address>", ...}. Unknown roles and bad addresses are an error. */
export function parsePlatformAddresses(raw: string | undefined): Partial<Record<Role, string>> {
  if (!raw?.trim()) return {};
  let v: unknown;
  try { v = JSON.parse(raw); } catch { throw new Error("PLATFORM_ADDRESSES must be JSON like {\"keeper\":\"<address>\"}"); }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("PLATFORM_ADDRESSES must be a JSON object");
  const out: Partial<Record<Role, string>> = {};
  for (const [k, a] of Object.entries(v)) {
    if (!(ROLES as readonly string[]).includes(k)) throw new Error(`PLATFORM_ADDRESSES names ${k}, which is not a role (${ROLES.join(", ")})`);
    if (typeof a !== "string" || !BASE58.test(a)) throw new Error(`PLATFORM_ADDRESSES ${k} is not an address`);
    out[k as Role] = a;
  }
  return out;
}

export const solscanAccount = (address: string, cluster: Cluster) =>
  `https://solscan.io/account/${address}${cluster === "devnet" ? "?cluster=devnet" : ""}`;
