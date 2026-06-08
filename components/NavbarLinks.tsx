"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props { isAdmin: boolean; isLoggedIn: boolean; }

export function NavbarLinks({ isAdmin, isLoggedIn }: Props) {
  const path = usePathname();

  const link = (href: string, label: string, extra?: string) => {
    const active = path === href || (href !== "/" && path.startsWith(href));
    return (
      <Link
        key={href}
        href={href}
        className={`relative text-sm pb-0.5 transition-colors ${
          active ? "text-gold" : `text-zinc-400 hover:text-zinc-100 ${extra ?? ""}`
        }`}
      >
        {label}
        {active && (
          <span className="absolute -bottom-[17px] left-0 right-0 h-[2px] bg-gold rounded-full" />
        )}
      </Link>
    );
  };

  return (
    <div className="flex items-center gap-7 text-sm">
      {link("/", "劇本")}
      {isLoggedIn && link("/characters", "調查員")}
      {isLoggedIn && link("/dashboard", "後台")}
      {isAdmin && link("/admin", "管理")}
    </div>
  );
}
