type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;
type Env = Record<string, string | undefined>;

/** Hosts launch images and metadata JSON and returns their public URLs. */
export interface UploadPort {
  uploadImage(file: File, name: string): Promise<string>;
  uploadJson(data: object, name: string): Promise<string>;
}

export interface CloudinaryCreds { cloudName: string; apiKey: string; apiSecret: string }

/** CLOUDINARY_URL (cloudinary://<key>:<secret>@<cloud>) or the three CLOUDINARY_* variables. */
export function cloudinaryCreds(env: Env): CloudinaryCreds | null {
  if (env.CLOUDINARY_URL) {
    const u = new URL(env.CLOUDINARY_URL);
    if (u.protocol !== "cloudinary:" || !u.username || !u.password || !u.hostname) throw new Error("CLOUDINARY_URL must look like cloudinary://<api key>:<api secret>@<cloud name>");
    return { cloudName: u.hostname, apiKey: decodeURIComponent(u.username), apiSecret: decodeURIComponent(u.password) };
  }
  if (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) {
    return { cloudName: env.CLOUDINARY_CLOUD_NAME, apiKey: env.CLOUDINARY_API_KEY, apiSecret: env.CLOUDINARY_API_SECRET };
  }
  return null;
}

/** Cloudinary's signature: SHA-1 hex of the signed params sorted by name as k=v joined by &, then the API secret. */
export function cloudinarySignature(params: Record<string, string>, apiSecret: string): string {
  const base = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return new Bun.CryptoHasher("sha1").update(base + apiSecret).digest("hex");
}

const contentId = async (file: Blob) => new Bun.CryptoHasher("sha256").update(new Uint8Array(await file.arrayBuffer())).digest("hex").slice(0, 32);

// Public ids are content hashes, so the same bytes land on the same URL and one launch can never replace another's image.
export class CloudinaryUploads implements UploadPort {
  constructor(private creds: CloudinaryCreds, private fetchFn: Fetch = fetch, private now: () => number = Date.now, private folder = "quants") {}

  private async upload(kind: "image" | "raw", file: File, publicId: string): Promise<string> {
    const params = { folder: this.folder, overwrite: "false", public_id: publicId, timestamp: String(Math.floor(this.now() / 1000)) };
    const body = new FormData();
    body.set("file", file, file.name);
    for (const [k, v] of Object.entries(params)) body.set(k, v);
    body.set("api_key", this.creds.apiKey);
    body.set("signature", cloudinarySignature(params, this.creds.apiSecret));
    const res = await this.fetchFn(`https://api.cloudinary.com/v1_1/${this.creds.cloudName}/${kind}/upload`, { method: "POST", body, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`cloudinary upload failed: ${res.status}`);
    const url = ((await res.json()) as { secure_url?: string }).secure_url;
    if (!url?.startsWith("https://")) throw new Error("cloudinary upload returned no https url");
    return url;
  }

  async uploadImage(file: File, _name?: string): Promise<string> {
    return this.upload("image", file, await contentId(file));
  }

  async uploadJson(data: object, name: string): Promise<string> {
    const file = new File([JSON.stringify(data)], name, { type: "application/json" });
    // raw uploads keep the extension in the id, so the URL ends in .json
    return this.upload("raw", file, `${await contentId(file)}.json`);
  }
}

// Local development only: files land in .dev-uploads, outside public/ because writes there reload every open page in dev.
export class DevUploads implements UploadPort {
  constructor(private base: string) {}

  async uploadImage(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const cid = new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 32);
    await Bun.write(`.dev-uploads/${cid}`, bytes);
    return `${this.base}/${cid}`;
  }

  uploadJson(data: object): Promise<string> {
    return this.uploadImage(new File([JSON.stringify(data)], "m.json", { type: "application/json" }));
  }
}

class NoUploads implements UploadPort {
  private fail(): never { throw new Error("Image uploads are not configured. Set CLOUDINARY_URL."); }
  async uploadImage(): Promise<string> { this.fail(); }
  async uploadJson(): Promise<string> { this.fail(); }
}

/** Local uploads are a dev switch (DEV_UPLOADS_BASE, or the older PINATA_JWT=stub) and refuse to start against a remote RPC. */
export const devUploadsOn = (env: Env) => !!env.DEV_UPLOADS_BASE || env.PINATA_JWT === "stub";

export function uploadsFrom(env: Env, fetchFn: Fetch = fetch): UploadPort {
  const creds = cloudinaryCreds(env);
  if (creds) return new CloudinaryUploads(creds, fetchFn);
  if (devUploadsOn(env)) return new DevUploads(env.DEV_UPLOADS_BASE || "http://localhost:3000/api/dev-uploads");
  return new NoUploads();
}
