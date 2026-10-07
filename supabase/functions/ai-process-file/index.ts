import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB for video
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, '').trim());
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const messageId = formData.get("message_id") as string | null;

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (file.size > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({ error: "File too large (max 50MB)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return new Response(JSON.stringify({ error: "File type not allowed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upload to storage
    const fileExt = (file.name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "bin";
    const storagePath = `${user.id}/${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabaseClient.storage
      .from("ai-attachments")
      .upload(storagePath, file);

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return new Response(JSON.stringify({ error: "Failed to upload file" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract text based on file type
    let extractedText = "";
    let metadata: Record<string, unknown> = {};
    const mimeType = file.type;

    if (mimeType === "text/plain" || mimeType === "text/csv") {
      extractedText = await file.text();
      if (extractedText.length > 50000) {
        extractedText = extractedText.slice(0, 50000) + "\n\n[...conteúdo truncado]";
      }
    } else if (mimeType === "application/pdf") {
      const bytes = new Uint8Array(await file.arrayBuffer());
      extractedText = extractTextFromPDFBytes(bytes);
      metadata = { pages_estimated: Math.max(1, (extractedText.match(/\f/g) || []).length + 1) };
    } else if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      extractedText = await extractTextFromDocx(file);
    } else if (
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
      extractedText = await extractTextFromXlsx(file);
      metadata = { type: "spreadsheet" };
    } else if (mimeType.startsWith("image/")) {
      metadata = { storage_path: storagePath, width: 0, height: 0 };
      extractedText = `[Imagem: ${file.name}]`;
    } else if (mimeType.startsWith("video/")) {
      metadata = {
        duration_estimate: "unknown",
        size_mb: (file.size / (1024 * 1024)).toFixed(2),
        format: fileExt,
      };
      extractedText = `[Vídeo: ${file.name}, ${(file.size / (1024 * 1024)).toFixed(1)}MB]`;
    } else {
      extractedText = `[Arquivo não suportado para extração: ${file.name}]`;
    }

    // Save attachment record
    if (messageId) {
      await supabaseClient.from("ai_attachments").insert({
        message_id: messageId,
        file_name: file.name,
        file_type: mimeType,
        file_size: file.size,
        storage_path: storagePath,
        extracted_text: extractedText,
        metadata,
      });
    }

    return new Response(
      JSON.stringify({
        storage_path: storagePath,
        extracted_text: extractedText,
        metadata,
        file_name: file.name,
        file_type: mimeType,
        file_size: file.size,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("ai-process-file error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// --- Extraction helpers ---

function extractTextFromPDFBytes(bytes: Uint8Array): string {
  const text = new TextDecoder("latin1").decode(bytes);
  const textBlocks: string[] = [];
  const regex = /\(([^)]*)\)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const decoded = match[1]
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\\\/g, "\\")
      .replace(/\\([()])/g, "$1");
    if (decoded.trim().length > 1) {
      textBlocks.push(decoded.trim());
    }
  }
  const result = textBlocks.join(" ").slice(0, 50000);
  return result || "[Não foi possível extrair texto do PDF — pode conter imagens ou estar protegido]";
}

async function extractTextFromDocx(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const textContent = await findXmlInZip(bytes, "word/document.xml");
    if (!textContent) return "[Não foi possível extrair texto do DOCX]";

    const stripped = textContent
      .replace(/<w:p[^>]*>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return stripped.slice(0, 50000) || "[DOCX vazio]";
  } catch {
    return "[Erro ao processar DOCX]";
  }
}

async function extractTextFromXlsx(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const sharedStrings = await findXmlInZip(bytes, "xl/sharedStrings.xml");
    if (!sharedStrings) return "[Não foi possível extrair dados do XLSX]";

    const texts: string[] = [];
    const regex = /<t[^>]*>([^<]*)<\/t>/g;
    let match;
    while ((match = regex.exec(sharedStrings)) !== null) {
      if (match[1].trim()) texts.push(match[1].trim());
    }

    return texts.join(", ").slice(0, 50000) || "[XLSX vazio]";
  } catch {
    return "[Erro ao processar XLSX]";
  }
}

async function findXmlInZip(zipBytes: Uint8Array, targetPath: string): Promise<string | null> {
  const view = new DataView(zipBytes.buffer);
  let offset = 0;

  while (offset < zipBytes.length - 30) {
    // Local file header signature: PK\x03\x04
    if (view.getUint32(offset, true) !== 0x04034b50) {
      offset++;
      continue;
    }

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraFieldLength = view.getUint16(offset + 28, true);
    const fileNameBytes = zipBytes.slice(offset + 30, offset + 30 + fileNameLength);
    const fileName = new TextDecoder().decode(fileNameBytes);
    const dataOffset = offset + 30 + fileNameLength + extraFieldLength;

    if (fileName === targetPath) {
      if (compressionMethod === 0) {
        // Stored (no compression)
        const content = zipBytes.slice(dataOffset, dataOffset + compressedSize);
        return new TextDecoder().decode(content);
      } else {
        // Deflate — use DecompressionStream
        try {
          const compressed = zipBytes.slice(dataOffset, dataOffset + compressedSize);
          const ds = new DecompressionStream("deflate-raw");
          const writer = ds.writable.getWriter();
          writer.write(compressed);
          writer.close();
          const reader = ds.readable.getReader();
          const chunks: Uint8Array[] = [];
          let readResult = await reader.read();
          while (!readResult.done) {
            chunks.push(readResult.value);
            readResult = await reader.read();
          }
          const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
          const result = new Uint8Array(totalLength);
          let pos = 0;
          for (const chunk of chunks) {
            result.set(chunk, pos);
            pos += chunk.length;
          }
          return new TextDecoder().decode(result);
        } catch {
          return null;
        }
      }
    }

    offset = dataOffset + compressedSize;
  }

  return null;
}
