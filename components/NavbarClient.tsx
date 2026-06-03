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
      <Link href="/auth" className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-md">
        Login
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-slate-400 text-xs">
        Hi, <span className="text-slate-200 font-medium">{user.username}</span>
      </span>
      <button
        onClick={handleLogout}
        className="border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white px-3 py-1.5 rounded-md text-sm"
      >
        Logout
      </button>
    </div>
  );
}
