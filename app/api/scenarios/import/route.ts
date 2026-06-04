import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzeScenarioDocument } from "@/lib/ai/import-scenario";

// File parsing (mammoth) needs the Node runtime, not edge.
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 2 * 1024 * 1024; // 2MB

export async function POST(request: Request) {
  // Auth: only signed-in creators may import. The file is processed in memory
  // and never persisted.
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "The file is empty." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large. Maximum size is 2MB." }, { status: 413 });
  }

  const name = file.name.toLowerCase();
  const isText = name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown");
  const isDocx = name.endsWith(".docx");

  // Extract plain text from the document, in memory only.
  let text = "";
  try {
    if (isText) {
      text = await file.text();
    } else if (isDocx) {
      const mammoth: any = await import("mammoth");
      const extractRawText = mammoth.extractRawText ?? mammoth.default?.extractRawText;
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await extractRawText({ buffer });
      text = result?.value ?? "";
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Upload .txt, .md, or .docx. Scanned PDFs and images are not supported yet." },
        { status: 415 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Could not read the document. If it is a .docx, make sure it is a real Word file (not a scanned PDF)." },
      { status: 400 }
    );
  }

  text = text.replace(/\r\n/g, "\n").trim();
  if (text.length < 20) {
    return NextResponse.json(
      { error: "Not enough readable text in the document to build a scenario." },
      { status: 400 }
    );
  }

  try {
    const { scenario, truncated } = await analyzeScenarioDocument(text);
    return NextResponse.json({ scenario, truncated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "AI analysis failed." }, { status: 500 });
  }
}
