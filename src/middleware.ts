import { NextResponse, type NextRequest } from "next/server";

/** HTTP Basic auth for /admin. Credentials: ADMIN_USER (default "admin") / ADMIN_PASSWORD. Fails closed. */
export function middleware(req: NextRequest) {
  const user = process.env.ADMIN_USER ?? "admin", pass = process.env.ADMIN_PASSWORD;
  const header = req.headers.get("authorization");
  if (pass && header?.startsWith("Basic ")) {
    const [u, ...rest] = atob(header.slice(6)).split(":");
    if (u === user && rest.join(":") === pass) return NextResponse.next();
  }
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="screener-admin"' } });
}

export const config = { matcher: ["/admin/:path*"] };
