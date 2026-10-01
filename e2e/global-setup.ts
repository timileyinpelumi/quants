import { warm } from "../scripts/lib/warm";

export default async function globalSetup() {
  await warm("http://localhost:3000");
}
