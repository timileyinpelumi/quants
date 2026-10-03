import { NextResponse, type NextRequest } from "next/server";
import { sharedDb } from "@/db/client";
import { recordView, viewerIp } from "@/web/server/pageviews";

export function proxy(req: NextRequest) {
  try {
    recordView(req, viewerIp(req), sharedDb);
  } catch (e) {
    console.error("page view not counted", e);
  }
  return NextResponse.next();
}

// Pages only: no API, build assets or files. Router prefetches never reach the proxy.
export const config = {
  matcher: [{
    source: "/((?!api/|_next/|__next|.*\\.[a-z0-9]+$).*)",
    missing: [
      { type: "header", key: "next-router-prefetch" },
      { type: "header", key: "purpose", value: "prefetch" },
    ],
  }],
};
