import { NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy } from "@/lib/csp";

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
