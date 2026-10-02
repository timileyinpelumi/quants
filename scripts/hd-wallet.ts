// Creates or reads the platform HD wallet and derives one Solana account per role.
//   bun scripts/hd-wallet.ts create   writes a new seed phrase (refuses to overwrite)
//   bun scripts/hd-wallet.ts show     prints the role addresses
//   bun scripts/hd-wallet.ts export <role> <out.json>   writes that role's keypair file (mode 600)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { Keypair } from "@solana/web3.js";

export const ROLES = ["keeper", "spill", "treasury", "admin", "platform-token"] as const;
type Role = (typeof ROLES)[number];

const DIR = join(homedir(), ".config", "quants", "mainnet");
const SEED_FILE = join(DIR, "seed-phrase.txt");

// SLIP-0010 ed25519 derivation (hardened only), the scheme Phantom and solana-keygen use for m/44'/501'/i'/0'.
function derive(seed: Uint8Array, path: number[]): Uint8Array {
  let I = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  let key = I.slice(0, 32), chain = I.slice(32);
  for (const index of path) {
    const data = new Uint8Array(37);
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, (index | 0x80000000) >>> 0);
    I = hmac(sha512, chain, data);
    key = I.slice(0, 32); chain = I.slice(32);
  }
  return key;
}

export function roleKeypair(mnemonic: string, role: Role): Keypair {
  const i = ROLES.indexOf(role);
  return Keypair.fromSeed(derive(mnemonicToSeedSync(mnemonic), [44, 501, i, 0]));
}

function readMnemonic(): string {
  const m = readFileSync(SEED_FILE, "utf8").trim();
  if (!validateMnemonic(m, wordlist)) throw new Error(`${SEED_FILE} is not a valid seed phrase`);
  return m;
}

if (import.meta.main) {
  const [cmd, role, out] = process.argv.slice(2);
  if (cmd === "create") {
    if (existsSync(SEED_FILE)) throw new Error(`${SEED_FILE} already exists; refusing to overwrite`);
    mkdirSync(DIR, { recursive: true, mode: 0o700 });
    writeFileSync(SEED_FILE, generateMnemonic(wordlist, 256) + "\n", { mode: 0o600, flag: "wx" });
    console.log(`seed phrase written to ${SEED_FILE}`);
  }
  if (cmd === "create" || cmd === "show") {
    const m = readMnemonic();
    for (const r of ROLES) console.log(`${String(ROLES.indexOf(r)).padStart(2)}  ${r.padEnd(15)} ${roleKeypair(m, r).publicKey.toBase58()}  m/44'/501'/${ROLES.indexOf(r)}'/0'`);
  } else if (cmd === "export") {
    if (!ROLES.includes(role as Role) || !out) throw new Error(`usage: export <${ROLES.join("|")}> <out.json>`);
    writeFileSync(out, JSON.stringify(Array.from(roleKeypair(readMnemonic(), role as Role).secretKey)), { mode: 0o600, flag: "wx" });
    console.log(`wrote ${role} keypair to ${out}`);
  } else if (cmd !== "create") {
    console.log("usage: bun scripts/hd-wallet.ts create | show | export <role> <out.json>");
  }
}
