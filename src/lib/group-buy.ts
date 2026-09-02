import { supabase } from "@/integrations/supabase/client";
import type { GroupBuyCampaign, GroupBuyStatus } from "@/types/commerce";

/**
 * Group Buy campaigns. A product with supply_model = "group_buy" may run many
 * campaigns over time, so campaigns live in their own table.
 *
 * `current_quantity` is intentionally NOT editable from the normal editor —
 * it will be driven by confirmed orders later. Admin-only manual adjustment is
 * exposed through `adjustCampaignQuantity`.
 */

export interface CampaignInput {
  title: string;
  status: GroupBuyStatus;
  starts_at: string;
  ends_at: string;
  minimum_quantity: number;
  target_quantity: number | null;
  expected_delivery_start: string | null;
  expected_delivery_end: string | null;
  campaign_price: number | null;
}

export async function listCampaigns(productId: string): Promise<GroupBuyCampaign[]> {
  const { data, error } = await supabase
    .from("group_buy_campaigns")
    .select("*")
    .eq("product_id", productId)
    .order("starts_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

function validate(input: CampaignInput) {
  if (!input.title.trim()) throw new Error("Campaign title is required.");
  if (!input.starts_at || !input.ends_at) throw new Error("Start and end dates are required.");
  if (new Date(input.ends_at) <= new Date(input.starts_at))
    throw new Error("The campaign must close after it opens.");
  if (
    input.expected_delivery_start &&
    input.expected_delivery_end &&
    input.expected_delivery_end < input.expected_delivery_start
  )
    throw new Error("Expected delivery end cannot be before the start.");
  if (input.minimum_quantity < 1) throw new Error("Minimum quantity must be at least 1.");
}

export async function saveCampaign(
  productId: string,
  input: CampaignInput,
  id?: string,
): Promise<void> {
  validate(input);
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;

  const payload = {
    product_id: productId,
    title: input.title.trim(),
    status: input.status,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    minimum_quantity: input.minimum_quantity,
    target_quantity: input.target_quantity,
    expected_delivery_start: input.expected_delivery_start,
    expected_delivery_end: input.expected_delivery_end,
    campaign_price: input.campaign_price,
    updated_by: userId,
  };

  if (id) {
    const { error } = await supabase.from("group_buy_campaigns").update(payload).eq("id", id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("group_buy_campaigns")
      .insert({ ...payload, created_by: userId });
    if (error) throw error;
  }
}

export async function cancelCampaign(id: string): Promise<void> {
  const { error } = await supabase
    .from("group_buy_campaigns")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await supabase.from("group_buy_campaigns").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Admin-only manual correction until orders drive the confirmed quantity.
 * Direct Data API writes to `current_quantity` are rejected by the
 * `group_buy_campaigns_guard_quantity` trigger, so this must go through the
 * controlled `adjust_group_buy_campaign_quantity` database function, which
 * re-checks the admin/owner role server side.
 */
export async function adjustCampaignQuantity(id: string, quantity: number): Promise<number> {
  if (!Number.isInteger(quantity) || quantity < 0)
    throw new Error("Quantity must be a whole number of zero or more.");
  const { data, error } = await supabase.rpc("adjust_group_buy_campaign_quantity", {
    _campaign_id: id,
    _quantity: quantity,
  });
  if (error) throw error;
  return data ?? quantity;
}
