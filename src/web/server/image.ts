import { imageSize } from "image-size";
import { LaunchError } from "@/launch/prepare";

const TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const SNIFFED: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
const MAX = 2 * 1024 * 1024;

export async function validateImage(file: File | string | null): Promise<File> {
  if (!file || typeof file === "string") throw new LaunchError("invalid_input", "Add an image");
  if (!TYPES.has(file.type)) throw new LaunchError("invalid_input", "Image must be PNG, JPEG or WebP");
  if (file.size > MAX) throw new LaunchError("invalid_input", "Image must be 2 MB or smaller");
  let dims: { width?: number; height?: number; type?: string };
  try {
    dims = imageSize(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new LaunchError("invalid_input", "Image could not be read. Try another file.");
  }
  // The declared type is client supplied; the bytes must actually be that format (an SVG labelled PNG would otherwise pass).
  if (!dims.type || SNIFFED[dims.type] !== file.type) throw new LaunchError("invalid_input", "Image must be PNG, JPEG or WebP");
  if (!dims.width || dims.width !== dims.height) throw new LaunchError("invalid_input", "Image must be square");
  return file;
}
