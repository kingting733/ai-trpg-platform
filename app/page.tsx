import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center gap-8">
      <div>
        <h1 className="text-5xl font-bold text-white mb-4">
          AI 驅動的 TRPG 冒險
        </h1>
        <p className="text-xl text-slate-400 max-w-2xl">
          創作故事、加入房間，與 AI 主持人共同體驗合作式文字冒險。
        </p>
      </div>
      <div className="flex gap-4">
        <Link
          href="/scenarios"
          className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-3 rounded-lg font-medium text-lg"
        >
          瀏覽劇本
        </Link>
        <Link
          href="/login"
          className="border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white px-6 py-3 rounded-lg font-medium text-lg"
        >
          立即開始
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-6 mt-8 text-left max-w-3xl w-full">
        {[
          { icon: "📖", title: "豐富劇本", desc: "瀏覽創作者製作的各類 TRPG 劇本" },
          { icon: "👥", title: "多人房間", desc: "與朋友或陌生人一同踏上冒險" },
          { icon: "🤖", title: "AI 主持人", desc: "AI 主持人為你的行動進行敘述與回應" },
        ].map((f) => (
          <div key={f.title} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="text-2xl mb-2">{f.icon}</div>
            <h3 className="font-semibold text-white mb-1">{f.title}</h3>
            <p className="text-slate-400 text-sm">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
