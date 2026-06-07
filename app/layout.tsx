import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { ActiveGamePopup } from "@/components/ActiveGamePopup";

export const metadata: Metadata = {
  title: "TRPG Adventure Platform",
  description: "AI-powered multiplayer TRPG text adventure",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#08080a] text-zinc-200">
        <Navbar />
        <main className="container mx-auto px-4 py-8 max-w-6xl">
          {children}
        </main>
        <ActiveGamePopup />
      </body>
    </html>
  );
}
