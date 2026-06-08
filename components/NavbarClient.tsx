"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Props {
  user: { username: string | null } | null;
}

export function NavbarClient({ user }: Props) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  if (!user) {
    return (
      <Link href="/login" className="border border-surface-border hover:border-gold/40 text-zinc-300 hover:text-gold px-4 py-1.5 rounded-lg text-sm transition-colors">
        登入
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Link href="/account" className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-200 transition-colors">
        <div className="w-6 h-6 rounded-full bg-surface-card border border-surface-border flex items-center justify-center text-gold text-[10px]">
          {(user.username ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <span>嗨，<span className="text-zinc-300 font-medium">{user.username}</span></span>
      </Link>
      <button
        onClick={handleLogout}
        className="border border-surface-border hover:border-zinc-500 text-zinc-500 hover:text-zinc-200 px-3 py-1.5 rounded-lg text-sm transition-colors"
      >
        登出
      </button>
    </div>
  );
}
