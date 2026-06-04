import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { NavbarClient } from "./NavbarClient";

export async function Navbar() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let username: string | null = null;
  if (user) {
    const { data } = await supabase
      .from("users")
      .select("username")
      .eq("id", user.id)
      .single();
    username = data?.username ?? user.email ?? null;
  }

  return (
    <nav className="border-b border-slate-800 bg-[#0f0f1a]/95 backdrop-blur sticky top-0 z-50">
      <div className="container mx-auto px-4 max-w-6xl flex items-center justify-between h-14">
        <Link href="/" className="text-lg font-bold text-purple-400 hover:text-purple-300">
          ⚔ TRPG Platform
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/scenarios" className="text-slate-300 hover:text-white">劇本</Link>
          {user && (
            <Link href="/characters" className="text-slate-300 hover:text-white">角色卡</Link>
          )}
          {user && (
            <Link href="/dashboard" className="text-slate-300 hover:text-white">後台</Link>
          )}
          <NavbarClient user={user ? { username } : null} />
        </div>
      </div>
    </nav>
  );
}
