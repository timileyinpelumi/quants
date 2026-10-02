import { test, expect } from "bun:test";
import { CloudinaryUploads, DevUploads, cloudinaryCreds, cloudinarySignature, uploadsFrom } from "../../src/web/server/uploads";

const creds = { cloudName: "demo", apiKey: "1234", apiSecret: "abcd" };

test("signs like Cloudinary's documented example", () => {
  expect(cloudinarySignature({ timestamp: "1315060510", public_id: "sample_image", eager: "w_400,h_300,c_pad|w_260,h_200,c_crop" }, "abcd"))
    .toBe("bfd09f95f331f558cbd1320e67aa8d488770583e");
});

function capture(url = "https://res.cloudinary.com/demo/image/upload/v1/quants/x.png") {
  const seen: { url: string; form: FormData }[] = [];
  const f = async (u: string | URL, init?: RequestInit) => {
    seen.push({ url: String(u), form: init!.body as FormData });
    return Response.json({ secure_url: url });
  };
  return { seen, up: new CloudinaryUploads(creds, f, () => 1_700_000_000_000) };
}

test("an image is a signed image upload named by its content hash", async () => {
  const { seen, up } = capture();
  const url = await up.uploadImage(new File([new Uint8Array([1, 2, 3])], "CAT.png", { type: "image/png" }), "CAT.png");
  expect(url).toBe("https://res.cloudinary.com/demo/image/upload/v1/quants/x.png");
  const { url: endpoint, form } = seen[0]!;
  expect(endpoint).toBe("https://api.cloudinary.com/v1_1/demo/image/upload");
  const publicId = form.get("public_id") as string;
  expect(publicId).toMatch(/^[0-9a-f]{32}$/);
  expect(form.get("api_key")).toBe("1234");
  expect(form.get("timestamp")).toBe("1700000000");
  expect(form.get("folder")).toBe("quants");
  expect(form.get("overwrite")).toBe("false");
  expect(form.get("signature")).toBe(cloudinarySignature({ folder: "quants", overwrite: "false", public_id: publicId, timestamp: "1700000000" }, "abcd"));
  expect(form.has("api_secret")).toBe(false);
  expect((form.get("file") as File).type).toStartWith("image/png");
});

test("metadata JSON is a raw upload whose id keeps the .json extension", async () => {
  const { seen, up } = capture("https://res.cloudinary.com/demo/raw/upload/v1/quants/abc.json");
  expect(await up.uploadJson({ name: "Cat" }, "CAT.json")).toBe("https://res.cloudinary.com/demo/raw/upload/v1/quants/abc.json");
  expect(seen[0]!.url).toBe("https://api.cloudinary.com/v1_1/demo/raw/upload");
  expect(seen[0]!.form.get("public_id")).toMatch(/^[0-9a-f]{32}\.json$/);
  expect(await (seen[0]!.form.get("file") as File).text()).toBe('{"name":"Cat"}');
});

test("a failed upload or a reply without an https url throws", async () => {
  const failed = new CloudinaryUploads(creds, async () => new Response("no", { status: 401 }));
  await expect(failed.uploadJson({}, "m.json")).rejects.toThrow("cloudinary upload failed: 401");
  const odd = new CloudinaryUploads(creds, async () => Response.json({ url: "http://x" }));
  await expect(odd.uploadJson({}, "m.json")).rejects.toThrow(/no https url/);
});

test("credentials come from CLOUDINARY_URL or the three variables", () => {
  expect(cloudinaryCreds({ CLOUDINARY_URL: "cloudinary://1234:ab%2Fcd@demo" })).toEqual({ cloudName: "demo", apiKey: "1234", apiSecret: "ab/cd" });
  expect(cloudinaryCreds({ CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "1234", CLOUDINARY_API_SECRET: "abcd" })).toEqual(creds);
  expect(cloudinaryCreds({ CLOUDINARY_CLOUD_NAME: "demo" })).toBeNull();
  expect(() => cloudinaryCreds({ CLOUDINARY_URL: "https://demo" })).toThrow(/CLOUDINARY_URL/);
});

test("Cloudinary when configured, local uploads only behind a dev switch, otherwise uploads refuse", async () => {
  expect(uploadsFrom({ CLOUDINARY_URL: "cloudinary://1:2@demo", DEV_UPLOADS_BASE: "http://localhost:3000/api/dev-uploads" })).toBeInstanceOf(CloudinaryUploads);
  expect(uploadsFrom({ DEV_UPLOADS_BASE: "http://localhost:3000/api/dev-uploads" })).toBeInstanceOf(DevUploads);
  expect(uploadsFrom({ PINATA_JWT: "stub" })).toBeInstanceOf(DevUploads);
  await expect(uploadsFrom({}).uploadJson({}, "m.json")).rejects.toThrow(/CLOUDINARY_URL/);
});
