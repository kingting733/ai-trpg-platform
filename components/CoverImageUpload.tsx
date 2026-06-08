"use client";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  value: string;                       // current cover_image_url
  onChange: (url: string) => void;     // set the URL on the parent form
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export function CoverImageUpload({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) { setError("請選擇圖片檔案。"); return; }
    if (file.size > MAX_BYTES) { setError("圖片過大，請小於 5MB。"); return; }

    setUploading(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("請先登入。"); setUploading(false); return; }

      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("scenario-covers")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (upErr) { setError(`上傳失敗：${upErr.message}`); setUploading(false); return; }

      const { data } = supabase.storage.from("scenario-covers").getPublicUrl(path);
      onChange(data.publicUrl);
    } catch (e: any) {
      setError(e?.message ?? "上傳失敗。");
    }
    setUploading(false);
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />

      {value ? (
        <div className="relative group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="封面預覽"
            className="rounded-lg h-40 w-full object-cover border border-slate-600"
            onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 rounded-lg flex items-center justify-center gap-2 transition-colors">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="opacity-0 group-hover:opacity-100 bg-zinc-800 hover:bg-zinc-700 text-white text-sm px-3 py-1.5 rounded-lg transition-opacity"
            >
              {uploading ? "上傳中..." : "更換圖片"}
            </button>
            <button
              type="button"
              onClick={() => onChange("")}
              className="opacity-0 group-hover:opacity-100 bg-red-800/80 hover:bg-red-700 text-white text-sm px-3 py-1.5 rounded-lg transition-opacity"
            >
              移除
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full h-40 border-2 border-dashed border-slate-600 hover:border-zinc-400 rounded-lg flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
        >
          {uploading ? (
            <span className="text-sm">上傳中...</span>
          ) : (
            <>
              <span className="text-3xl">🖼️</span>
              <span className="text-sm">點擊上傳封面圖片</span>
              <span className="text-xs text-slate-600">JPG / PNG / WebP，最大 5MB</span>
            </>
          )}
        </button>
      )}

      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
    </div>
  );
}
