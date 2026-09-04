import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient, isDuplicateReceiptError, routineJson, safeErrorCode, sha256 } from "../_shared/routine/google.ts";

serve(async (req) => {
  if (req.method !== "POST") return routineJson({ error: "Method not allowed" }, 405);
  const channelId = req.headers.get("x-goog-channel-id");
  const channelToken = req.headers.get("x-goog-channel-token");
  const resourceId = req.headers.get("x-goog-resource-id");
  const resourceState = req.headers.get("x-goog-resource-state") || "exists";
  const messageNumber = Number(req.headers.get("x-goog-message-number"));
  if (!channelId || !channelToken || !resourceId || !Number.isSafeInteger(messageNumber)) {
    return routineJson({ error: "Invalid notification" }, 400);
  }
  const admin = adminClient();
  let receiptInserted = false;
  try {
    const { data: channel } = await admin.from("calendar_watch_channels").select("*")
      .eq("channel_id", channelId)
      .eq("resource_id", resourceId)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!channel || channel.channel_token_hash !== await sha256(channelToken)) {
      return routineJson({ error: "Unauthorized notification" }, 401);
    }
    const { error: receiptError } = await admin.from("calendar_webhook_receipts").insert({
      channel_id: channelId,
      message_number: messageNumber,
      resource_state: resourceState,
    });
    if (isDuplicateReceiptError(receiptError)) return routineJson({ received: true, duplicate: true });
    if (receiptError) throw new Error("webhook_receipt_failed");
    receiptInserted = true;

    // A mensagem push não traz o evento. O sync incremental busca a mudança.
    if (resourceState !== "sync") {
      const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/google-calendar-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-routine-internal-secret": Deno.env.get("ROUTINE_INTERNAL_SECRET") || "",
        },
        body: JSON.stringify({ action: "webhook", external_calendar_id: channel.external_calendar_id }),
      });
      if (!response.ok) throw new Error("incremental_sync_dispatch_failed");
    }
    return routineJson({ received: true });
  } catch (error) {
    if (receiptInserted) {
      // O recibo só fica definitivo depois do dispatch. Se ele falhar, removê-lo
      // permite que a retentativa do Google refaça a sincronização incremental.
      await admin.from("calendar_webhook_receipts").delete()
        .eq("channel_id", channelId)
        .eq("message_number", messageNumber);
    }
    console.error("google-calendar-webhook:", safeErrorCode(error));
    // 500 instrui o Google a tentar novamente; o recibo único impede duplicação.
    return routineJson({ error: "Temporary failure" }, 500);
  }
});
