import { test, expect } from "bun:test";
import { securityHeaders } from "../../src/web/security-headers";
import config from "../../next.config";

const csp = (h: { key: string; value: string }[]) => h.find((x) => x.key === "Content-Security-Policy")!.value;
const directive = (policy: string, name: string) => policy.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

test("sets frame, sniffing and referrer headers", () => {
  const h = securityHeaders("https://rpc.example.com/?api-key=k", false);
  expect(h).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
  expect(h).toContainEqual({ key: "X-Content-Type-Options", value: "nosniff" });
  expect(h).toContainEqual({ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" });
  expect(directive(csp(h), "frame-ancestors")).toBe("frame-ancestors 'none'");
});

test("production adds HSTS and upgrades insecure requests; dev does not", () => {
  const prod = securityHeaders("https://rpc.example.com", false);
  expect(prod).toContainEqual({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  expect(csp(prod)).toContain("upgrade-insecure-requests");
  expect(prod.find((h) => h.key === "Permissions-Policy")!.value).toContain("camera=()");
  const dev = securityHeaders("http://127.0.0.1:8899", true);
  expect(dev.some((h) => h.key === "Strict-Transport-Security")).toBe(false);
  expect(csp(dev)).not.toContain("upgrade-insecure-requests");
});

test("the CSP lets the browser reach the RPC over https and its websocket", () => {
  const p = csp(securityHeaders("https://rpc.example.com/?api-key=k", false));
  const connect = directive(p, "connect-src");
  expect(connect).toContain("https://rpc.example.com");
  expect(connect).toContain("wss://rpc.example.com");
  expect(connect).not.toContain("api-key");
});

test("a local RPC with a port gets the next port for its websocket, as web3.js does", () => {
  const connect = directive(csp(securityHeaders("http://127.0.0.1:8899", true)), "connect-src");
  expect(connect).toContain("http://127.0.0.1:8899");
  expect(connect).toContain("ws://127.0.0.1:8900");
});

test("images from the resizing proxy and data URLs are allowed, eval only in dev", () => {
  const prod = csp(securityHeaders("https://rpc.example.com", false));
  expect(directive(prod, "img-src")).toContain("https:");
  expect(directive(prod, "img-src")).toContain("data:");
  expect(directive(prod, "script-src")).not.toContain("unsafe-eval");
  expect(directive(csp(securityHeaders("https://rpc.example.com", true)), "script-src")).toContain("unsafe-eval");
  expect(directive(prod, "font-src")).toContain("'self'");
});

test("launch images and metadata on Cloudinary are allowed", () => {
  const p = csp(securityHeaders("https://rpc.example.com", false));
  expect(directive(p, "img-src")).toContain("https://res.cloudinary.com");
  expect(directive(p, "connect-src")).toContain("https://res.cloudinary.com");
});

test("next.config sends the headers on every path", async () => {
  const rules = await config.headers!();
  const all = rules.find((r) => r.source === "/:path*")!;
  expect(all.headers.map((h) => h.key)).toContain("Content-Security-Policy");
});
