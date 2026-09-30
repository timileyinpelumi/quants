import { imageSize } from "image-size";
import { LaunchError } from "@/launch/prepare";

const TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX = 2 * 1024 * 1024;

export async function validateImage(file: File | string | null): Promise<File> {
  if (!file || typeof file === "string") throw new LaunchError("invalid_input", "Add an image");
  if (!TYPES.has(file.type)) throw new LaunchError("invalid_input", "Image must be PNG, JPEG or WebP");
  if (file.size > MAX) throw new LaunchError("invalid_input", "Image must be 2 MB or smaller");
  let dims: { width?: number; height?: number };
  try {
    dims = imageSize(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new LaunchError("invalid_input", "We could not read that image");
  }
  if (!dims.width || dims.width !== dims.height) throw new LaunchError("invalid_input", "Image must be square");
  return file;
}
