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

  const name = file.name.toLowerCase();
  const isText = name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown");
  const isDocx = name.endsWith(".docx");
  if (!isText && !isDocx) {
    return NextResponse.json(
      { error: "Unsupported file type. Upload .txt, .md, or .docx. Scanned PDFs and images are not supported yet." },
      { status: 415 }
    );
  }

  // Read the actual bytes once. Do NOT trust file.size — some upload paths
  // (certain browsers / OSes, files synced from cloud storage) report size 0
  // even when the file has content, which produced a false "empty" error.
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded file. Please try again." }, { status: 400 });
  }

  if (bytes.length === 0) {
    return NextResponse.json({ error: "The file is empty." }, { status: 400 });
  }
  if (bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: "File too large. Maximum size is 2MB." }, { status: 413 });
  }

  // Extract plain text from the document, in memory only.
  let text = "";
  try {
    if (isText) {
      // TextDecoder strips a UTF-8 BOM if present; fatal:false tolerates stray bytes.
      text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } else {
      const mammoth: any = await import("mammoth");
      const extractRawText = mammoth.extractRawText ?? mammoth.default?.extractRawText;
      const result = await extractRawText({ buffer: bytes });
      text = result?.value ?? "";
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
