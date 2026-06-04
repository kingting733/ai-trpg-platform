import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminClient, AdminScenario, AdminRoom } from "./AdminClient";

// Server-side gate: only users whose role = 'admin' may see this page. The data
// fetch and the delete API routes are protected again by RLS + server checks.
export default async function AdminPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");

  const { data: me } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (me?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center">
        <div className="text-4xl">🔒</div>
        <h1 className="text-xl font-semibold text-white">沒有管理員權限</h1>
        <p className="text-slate-400 text-sm max-w-md">
          此頁面僅限管理員存取。若你應該擁有管理權限，請在資料庫將你的帳號 role 設為 'admin'。
        </p>
      </div>
    );
  }

  // All scenarios across every creator, with creator name and room count.
  const { data: scenarioRows } = await supabase
    .from("scenarios")
    .select("id, title, status, genre, created_at, creator:users!creator_id(username), rooms(count)")
    .order("created_at", { ascending: false });

  const scenarios: AdminScenario[] = (scenarioRows ?? []).map((s: any) => ({
    id: s.id,
    title: s.title,
    status: s.status,
    genre: s.genre,
    created_at: s.created_at,
    creatorName: s.creator?.username ?? "（未知）",
    roomCount: Array.isArray(s.rooms) ? (s.rooms[0]?.count ?? 0) : 0,
  }));

  // All rooms, with the scenario title, host name and player count.
  const { data: roomRows } = await supabase
    .from("rooms")
    .select("id, name, room_code, status, current_round, created_at, updated_at, scenarios(title), host:users!host_id(username), room_players(count)")
    .order("created_at", { ascending: false });

  const rooms: AdminRoom[] = (roomRows ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    roomCode: r.room_code,
    status: r.status,
    round: r.current_round,
    created_at: r.created_at,
    updated_at: r.updated_at,
    scenarioTitle: r.scenarios?.title ?? "（已刪除）",
    hostName: r.host?.username ?? "（未知）",
    playerCount: Array.isArray(r.room_players) ? (r.room_players[0]?.count ?? 0) : 0,
  }));

  return <AdminClient scenarios={scenarios} rooms={rooms} />;
}
