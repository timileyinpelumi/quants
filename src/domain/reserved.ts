/** Names and symbols that would pass for the platform's own token. Spaces, punctuation and digits that look like letters are ignored. */
export function isReservedName(text: string): boolean {
  const plain = text.toLowerCase().replace(/0/g, "o").replace(/[1|]/g, "i").replace(/5/g, "s").replace(/[^a-z]/g, "");
  return plain.includes("quants");
}

export const RESERVED_MESSAGE = "Names and symbols with quants in them are reserved for the platform.";
