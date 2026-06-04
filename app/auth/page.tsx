// Kept for backward compatibility — redirects to the dedicated login page.
import { redirect } from "next/navigation";

export default function AuthPage() {
  redirect("/login");
}
