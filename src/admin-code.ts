// No I, O, 0 or 1, so a code read off a screen or paper is not misread. 32 symbols: each byte maps evenly.
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 24;

export function generateCode(length = CODE_LENGTH): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The argon2id PHC string of a code, as stored for read only codes. */
export const hashCodePhc = (code: string) => Bun.password.hash(normalizeCode(code), { algorithm: "argon2id", memoryCost: 19_456, timeCost: 2 });

/** Base64 so the `$` signs of the PHC string survive env files and compose interpolation. */
export async function hashCode(code: string): Promise<string> {
  return Buffer.from(await hashCodePhc(code), "utf8").toString("base64");
}

/** The argon2id PHC string from ADMIN_CODE_HASH (base64 or raw), or "" when it is missing or not argon2id. */
export function decodeCodeHash(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  const s = v.startsWith("$") ? v : Buffer.from(v, "base64").toString("utf8");
  return s.startsWith("$argon2id$") ? s : "";
}
