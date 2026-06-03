import Link from "next/link";

export function Navbar() {
  return (
    <nav className="border-b border-slate-800 bg-[#0f0f1a]/95 backdrop-blur sticky top-0 z-50">
      <div className="container mx-auto px-4 max-w-6xl flex items-center justify-between h-14">
        <Link href="/" className="text-lg font-bold text-purple-400 hover:text-purple-300">
          ⚔ TRPG Platform
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/scenarios" className="text-slate-300 hover:text-white">Scenarios</Link>
          <Link href="/dashboard" className="text-slate-300 hover:text-white">Dashboard</Link>
          <Link href="/auth" className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-md">
            Login
          </Link>
        </div>
      </div>
    </nav>
  );
}
