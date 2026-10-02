// Generates the admin access code. The plain code goes to a file only you can read; the hash goes in the env file.
//   bun scripts/admin-code.ts [--cluster mainnet] [--out <file>] [--rotate]
// --rotate replaces an existing code. Deploying the new hash ends every admin session made with the old code.
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { generateCode, hashCode } from "../src/admin-code";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const cluster = arg("--cluster") ?? "mainnet";
const out = arg("--out") ?? join(homedir(), ".config", "quants", cluster, "admin-code.txt");
const rotate = process.argv.includes("--rotate");

if (existsSync(out) && !rotate) {
  console.error(`${out} already exists. Pass --rotate to replace the code (this signs out every admin session once deployed).`);
  process.exit(1);
}

const code = generateCode();
const hash = await hashCode(code);
mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
writeFileSync(out, `${code}\n`, { mode: 0o600 });
chmodSync(out, 0o600);
console.error(`Wrote the code to ${out} (mode 600). Put this line in the env file and deploy:`);
console.log(`ADMIN_CODE_HASH=${hash}`);
