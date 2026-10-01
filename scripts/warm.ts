import { warm } from "./lib/warm";

await warm(process.env.WARM_BASE ?? "http://localhost:3000");
console.log("[warm] done");
