import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// Routes that require a logged-in user.
// Middleware redirects to /login?next=<original-path> when unauthenticated.
const PROTECTED_PREFIXES = [
  "/characters",
  "/dashboard",
  "/scenarios/new",
  "/play/create-room",
  "/play/hub",
  "/play/join",
  "/rooms",
  "/account",
];

// /scenarios (browse list) and /scenarios/[id] (detail) are public,
// but /scenarios/[id]/edit and /scenarios/new are protected.
function isProtectedPath(pathname: string): boolean {
  // Public scenario paths
  if (pathname === "/scenarios") return false;
  if (
    pathname.startsWith("/scenarios/") &&
    !pathname.endsWith("/edit") &&
    !pathname.startsWith("/scenarios/new")
  ) return false;

  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  // Refresh session cookie on every request.
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (isProtectedPath(pathname) && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
