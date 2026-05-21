import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { randomUUID } from "crypto";

const ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "application/rtf",
  "text/rtf",
];
const MAX_SIZE = 25 * 1024 * 1024; // 25MB

type Params = { params: Promise<{ sessionId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { sessionId } = await params;

  const { data: session, error: sessionErr } = await supabaseAdmin
    .from("intake_sessions")
    .select("id, submitted_at, expires_at")
    .eq("id", sessionId)
    .single();

  if (sessionErr || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.submitted_at) {
    return NextResponse.json({ error: "Session already submitted" }, { status: 409 });
  }
  if (new Date(session.expires_at) < new Date()) {
    return NextResponse.json({ error: "Session expired" }, { status: 410 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.name || !body?.contentType || !body?.size) {
    return NextResponse.json({ error: "name, contentType, size required" }, { status: 400 });
  }

  if (body.size > MAX_SIZE) {
    return NextResponse.json({ error: "File exceeds 25MB limit" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(body.contentType)) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
  }

  const fileId = `file_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const storagePath = `intakes/${sessionId}/${fileId}/${body.name}`;

  // Create pre-signed upload URL via Supabase Storage
  const { data: signedData, error: signedErr } = await supabaseAdmin.storage
    .from("intake-uploads")
    .createSignedUploadUrl(storagePath);

  if (signedErr || !signedData) {
    console.error("signed URL error:", signedErr);
    return NextResponse.json({ error: "Could not generate upload URL" }, { status: 500 });
  }

  // Record file metadata
  await supabaseAdmin.from("intake_files").insert({
    id: fileId,
    session_id: sessionId,
    name: body.name,
    content_type: body.contentType,
    size: body.size,
    storage_path: storagePath,
  });

  return NextResponse.json({
    fileId,
    uploadUrl: signedData.signedUrl,
    storagePath,
    expiresIn: 600,
  });
}
