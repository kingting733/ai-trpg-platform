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
      <Link href="/login" className="bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1.5 rounded-md">
        登入
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Link href="/account" className="text-slate-400 text-xs hover:text-slate-200">
        嗨，<span className="text-slate-200 font-medium">{user.username}</span>
      </Link>
      <button
        onClick={handleLogout}
        className="border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white px-3 py-1.5 rounded-md text-sm"
      >
        登出
      </button>
    </div>
  );
}
