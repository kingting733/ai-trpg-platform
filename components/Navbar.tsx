import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { NavbarClient } from "./NavbarClient";
import { NavbarLinks } from "./NavbarLinks";

export async function Navbar() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let username: string | null = null;
  let isAdmin = false;
  if (user) {
    const { data } = await supabase
      .from("users")
      .select("username, role")
      .eq("id", user.id)
      .single();
    username = data?.username ?? user.email ?? null;
    isAdmin = data?.role === "admin";
  }

  return (
    <nav className="border-b border-surface-border bg-[#0c0a07]/95 backdrop-blur sticky top-0 z-50">
      <div className="container mx-auto px-4 max-w-6xl flex items-center justify-between h-14">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded border border-gold/40 flex items-center justify-center text-gold text-sm">
            ✦
          </div>
          <span className="font-semibold text-zinc-100 tracking-wide text-sm">TRPG Platform</span>
        </Link>

        {/* Right group: nav links + user section */}
        <div className="flex items-center gap-8">
          <NavbarLinks isAdmin={isAdmin} isLoggedIn={!!user} />
          <NavbarClient user={user ? { username } : null} />
        </div>
      </div>
    </nav>
  );
}
