import { supabaseAdmin } from "@/lib/supabase";

const BUCKET = "vera";

// Uploads a PDF buffer and returns the storage path.
// path format: "<contract_id>/<filename>.pdf"
export async function uploadContractPdf(contractId: string, filename: "unsigned" | "signed", buffer: Buffer): Promise<string> {
  const path = `${contractId}/${filename}.pdf`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw new Error(`Vera PDF upload failed: ${error.message}`);
  return path;
}

export async function downloadContractPdf(path: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Vera PDF download failed: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function signedContractPdfUrl(path: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data) throw new Error(`Vera signed-URL failed: ${error?.message ?? "no data"}`);
  return data.signedUrl;
}
