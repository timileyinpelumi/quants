import { readFile } from "node:fs/promises";

export const dynamic = "force-dynamic";

const sniff = (b: Uint8Array) =>
  b[0] === 0x89 && b[1] === 0x50 ? "image/png"
  : b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg"
  : b[0] === 0x47 && b[1] === 0x49 ? "image/gif"
  : b[8] === 0x57 && b[9] === 0x45 ? "image/webp"
  : b[0] === 0x7b ? "application/json"
  : "application/octet-stream";

export async function GET(_req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  if (process.env.PINATA_JWT !== "stub" || !/^[0-9a-f]{32}$/.test(cid)) return new Response(null, { status: 404 });
  const bytes = await readFile(`.dev-uploads/${cid}`).then((b) => new Uint8Array(b), () => null);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(bytes, { headers: { "content-type": sniff(bytes), "cache-control": "public, max-age=31536000, immutable" } });
}
