import type { ImeiScanEvent } from "@/components/ImeiScanner";
import { supabase } from "@/integrations/supabase/client";
import { sessionId } from "@/lib/offline";

export async function saveImeiScanHistory(event: ImeiScanEvent, productId?: string) {
  const userId = await sessionId();
  if (!userId) return;
  const { error } = await supabase.from("imei_scan_history").insert({
    user_id: userId,
    imei: event.imei,
    source: event.source,
    outcome: event.outcome,
    message: event.message.slice(0, 240),
    product_id: productId ?? null,
  });
  if (error) throw new Error(error.message);
}
