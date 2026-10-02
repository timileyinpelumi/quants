// web3.js derives the websocket URL from the RPC URL: ws(s) scheme, and the next port when one is given.
function rpcOrigins(rpcUrl: string): string[] {
  let u: URL;
  try { u = new URL(rpcUrl); } catch { return []; }
  const ws = u.protocol === "https:" ? "wss:" : "ws:";
  return [u.origin, `${ws}//${u.port ? `${u.hostname}:${Number(u.port) + 1}` : u.host}`];
}

export function securityHeaders(rpcUrl: string, dev: boolean): { key: string; value: string }[] {
  const csp = [
    "default-src 'self'",
    // App Router hydration uses inline scripts; dev tooling also needs eval.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: https://res.cloudinary.com",
    "font-src 'self' data:",
    `connect-src 'self' ${rpcOrigins(rpcUrl).join(" ")} https://res.cloudinary.com${dev ? " ws: http://localhost:* http://127.0.0.1:*" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ];
}
