import { isReservedName, RESERVED_MESSAGE } from "@/domain/reserved";
import { z } from "zod";
import { getContext } from "@/web/server/context";
import { json, jsonError, limitBody, rateLimit } from "@/web/server/http";
import { validateImage } from "@/web/server/image";
import { defaultArt } from "@/web/server/default-art";

export const dynamic = "force-dynamic";

const link = (hosts: string[] | null, label: string) => z.string().max(200).refine((v) => {
  let u: URL;
  try { u = new URL(v); } catch { return false; }
  return u.protocol === "https:" && !u.username && !u.password && !u.port && (!hosts || (hosts.includes(u.hostname) && u.pathname.length > 1));
}, `${label} must be a public HTTPS link${hosts ? ` on ${hosts.join(" or ")}` : ""}`);

const Fields = z.object({
  name: z.string().trim().min(1, "Add a name").max(32, "Name is 32 characters at most").refine((v) => !isReservedName(v), RESERVED_MESSAGE),
  symbol: z.string().regex(/^[A-Za-z0-9]{1,10}$/, "Symbol is 1 to 10 letters or numbers").refine((v) => !isReservedName(v), RESERVED_MESSAGE),
  description: z.string().max(500, "Description is 500 characters at most").optional(),
  website: link(null, "Website").optional(),
  x: link(["x.com", "twitter.com"], "X").optional(),
  telegram: link(["t.me"], "Telegram").optional(),
});

export async function POST(req: Request) {
  try {
    rateLimit(req, "metadata", 10);
    limitBody(req, 2_300_000);
    const form = await req.formData();
    const raw = Object.fromEntries([...form.entries()].filter(([k, v]) => k !== "image" && v !== ""));
    const fields = Fields.parse(raw);
    const picked = form.get("image");
    const image = picked && typeof picked !== "string" && picked.size > 0 ? await validateImage(picked) : await defaultArt(fields.symbol);
    const { uploads } = getContext();
    const imageUrl = await uploads.uploadImage(image, `${fields.symbol}.${image.type.split("/")[1]}`);
    const uri = await uploads.uploadJson({
      name: fields.name,
      symbol: fields.symbol,
      description: fields.description ?? "",
      image: imageUrl,
      extensions: { website: fields.website, twitter: fields.x, telegram: fields.telegram },
    }, `${fields.symbol}.json`);
    return json({ uri, image: imageUrl });
  } catch (e) {
    return jsonError(e);
  }
}
