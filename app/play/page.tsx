// "Enter the Adventure" anonymous flow is replaced by proper auth.
// Any link to /play now goes to /play/hub (which middleware protects).
import { redirect } from "next/navigation";

export default function PlayPage() {
  redirect("/play/hub");
}
