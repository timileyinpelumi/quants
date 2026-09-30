type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface PinataPort {
  uploadFile(file: File, name: string): Promise<string>;
  uploadJson(data: object, name: string): Promise<string>;
}

export const gatewayUrl = (cid: string) =>
  process.env.DEV_UPLOADS_BASE ? `${process.env.DEV_UPLOADS_BASE}/${cid}`
  : process.env.PINATA_GATEWAY ? `https://${process.env.PINATA_GATEWAY}/ipfs/${cid}` : `https://ipfs.io/ipfs/${cid}`;

// Local development only (PINATA_JWT=stub): files land in public/dev-uploads and are served by Next.
export class DevPinata implements PinataPort {
  async uploadFile(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const cid = new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 32);
    await Bun.write(`public/dev-uploads/${cid}`, bytes);
    return cid;
  }
  uploadJson(data: object): Promise<string> {
    return this.uploadFile(new File([JSON.stringify(data)], "m.json", { type: "application/json" }));
  }
}

export class PinataRest implements PinataPort {
  constructor(private jwt: string, private fetchFn: Fetch = fetch) {}

  async uploadFile(file: File, name: string): Promise<string> {
    const body = new FormData();
    body.set("file", file, name);
    body.set("network", "public");
    body.set("name", name);
    const res = await this.fetchFn("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { authorization: `Bearer ${this.jwt}` }, body });
    if (!res.ok) throw new Error(`pinata upload failed: ${res.status}`);
    return ((await res.json()) as { data: { cid: string } }).data.cid;
  }

  uploadJson(data: object, name: string): Promise<string> {
    return this.uploadFile(new File([JSON.stringify(data)], name, { type: "application/json" }), name);
  }
}
