import { supabase } from "@/integrations/supabase/client";
import type {
  InventoryAdjustmentReason,
  InventoryTransferItem,
  InventoryTransferStatus,
  ManualMovementType,
  MovementLedgerRow,
  Stocktake,
  StocktakeItem,
  StocktakeWithLocation,
  TransferItemInput,
  TransferWithLocations,
} from "@/types/inventory";

/**
 * Stock control operations.
 *
 * Every quantity change still goes through `apply_inventory_movement` inside the
 * database. Transfers and stocktakes are driven by controlled functions only —
 * the client can never write to these tables directly.
 */

/* ---------------- Manual adjustments ---------------- */

export async function adjustInventory(input: {
  levelId: string;
  type: ManualMovementType;
  quantity: number;
  reason: InventoryAdjustmentReason;
  note?: string | null;
}): Promise<void> {
  const args: {
    _inventory_level_id: string;
    _movement_type: ManualMovementType;
    _quantity: number;
    _reason: InventoryAdjustmentReason;
    _note?: string;
  } = {
    _inventory_level_id: input.levelId,
    _movement_type: input.type,
    _quantity: input.quantity,
    _reason: input.reason,
  };
  const note = input.note?.trim();
  if (note) args._note = note;

  const { error } = await supabase.rpc("adjust_inventory", args);
  if (error) throw error;
}

/* ---------------- Movement ledger ---------------- */

const LEDGER_SELECT = `
  *,
  level:inventory_levels(
    id,
    location:inventory_locations(id, name),
    product:products(id, name, sku),
    variant:product_variants(id, title, sku, product:products(id, name))
  )
`;

interface LedgerJoin {
  level: {
    location: { name: string } | null;
    product: { name: string; sku: string | null } | null;
    variant: {
      title: string;
      sku: string | null;
      product: { name: string } | null;
    } | null;
  } | null;
}

export async function getMovementLedger(options?: {
  locationId?: string;
  movementType?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
}): Promise<MovementLedgerRow[]> {
  let query = supabase
    .from("inventory_movements")
    .select(LEDGER_SELECT)
    .order("seq", { ascending: false })
    .limit(options?.limit ?? 300);

  if (options?.movementType) {
    query = query.eq(
      "movement_type",
      options.movementType as MovementLedgerRow["movement_type"],
    );
  }
  if (options?.from) query = query.gte("created_at", options.from);
  if (options?.to) query = query.lte("created_at", options.to);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as (MovementLedgerRow & LedgerJoin)[];

  const actorIds = [...new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v))];
  let names: Record<string, string | null> = {};
  if (actorIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);
    names = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name]));
  }

  const mapped: MovementLedgerRow[] = rows.map((r) => {
    const parentName = r.level?.variant?.product?.name ?? r.level?.product?.name ?? "Unknown item";
    return {
      ...r,
      itemName: parentName,
      variantTitle: r.level?.variant?.title ?? null,
      sku: r.level?.variant?.sku ?? r.level?.product?.sku ?? null,
      locationName: r.level?.location?.name ?? "Unknown location",
      actorName: r.created_by ? (names[r.created_by] ?? null) : null,
    };
  });

  const filtered = options?.locationId
    ? mapped.filter((r) => (r.level as unknown as { location?: { name?: string } } | null) && true)
    : mapped;

  const term = options?.search?.trim().toLowerCase();
  const searched = term
    ? filtered.filter(
        (r) =>
          r.itemName.toLowerCase().includes(term) ||
          (r.variantTitle ?? "").toLowerCase().includes(term) ||
          (r.sku ?? "").toLowerCase().includes(term) ||
          (r.note ?? "").toLowerCase().includes(term),
      )
    : filtered;

  return searched;
}

/* ---------------- Transfers ---------------- */

const TRANSFER_SELECT = `
  *,
  from_location:inventory_locations!inventory_transfers_from_location_id_fkey(id, name, code),
  to_location:inventory_locations!inventory_transfers_to_location_id_fkey(id, name, code)
`;

export async function getTransfers(status?: InventoryTransferStatus | "all"): Promise<
  TransferWithLocations[]
> {
  let query = supabase
    .from("inventory_transfers")
    .select(TRANSFER_SELECT)
    .order("created_at", { ascending: false })
    .limit(200);
  if (status && status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as TransferWithLocations[];
}

export async function getTransfer(id: string): Promise<TransferWithLocations> {
  const { data, error } = await supabase
    .from("inventory_transfers")
    .select(TRANSFER_SELECT)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as unknown as TransferWithLocations;
}

export async function getTransferItems(transferId: string): Promise<InventoryTransferItem[]> {
  const { data, error } = await supabase
    .from("inventory_transfer_items")
    .select("*")
    .eq("transfer_id", transferId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createTransfer(input: {
  fromLocationId: string;
  toLocationId: string;
  notes?: string | null;
}): Promise<string> {
  const args: { _from_location_id: string; _to_location_id: string; _notes?: string } = {
    _from_location_id: input.fromLocationId,
    _to_location_id: input.toLocationId,
  };
  const notes = input.notes?.trim();
  if (notes) args._notes = notes;

  const { data, error } = await supabase.rpc("create_inventory_transfer", args);
  if (error) throw error;
  return data as string;
}

export async function setTransferItems(
  transferId: string,
  lines: TransferItemInput[],
): Promise<void> {
  const payload = lines.map((l) => ({
    product_id: l.productId,
    variant_id: l.variantId,
    requested_quantity: l.requestedQuantity,
  }));
  const { error } = await supabase.rpc("set_transfer_items", {
    _transfer_id: transferId,
    _lines: payload,
  });
  if (error) throw error;
}

export async function setTransferStatus(
  transferId: string,
  status: InventoryTransferStatus,
  reason?: string | null,
): Promise<void> {
  const args: {
    _transfer_id: string;
    _status: InventoryTransferStatus;
    _reason?: string;
  } = { _transfer_id: transferId, _status: status };
  const trimmed = reason?.trim();
  if (trimmed) args._reason = trimmed;

  const { error } = await supabase.rpc("set_transfer_status", args);
  if (error) throw error;
}

/* ---------------- Stocktakes ---------------- */

export async function getStocktakes(): Promise<StocktakeWithLocation[]> {
  const { data, error } = await supabase
    .from("stocktakes")
    .select("*, location:inventory_locations(id, name, code)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as unknown as StocktakeWithLocation[];
}

export async function getStocktake(id: string): Promise<StocktakeWithLocation> {
  const { data, error } = await supabase
    .from("stocktakes")
    .select("*, location:inventory_locations(id, name, code)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as unknown as StocktakeWithLocation;
}

export interface StocktakeItemWithLive extends StocktakeItem {
  liveQuantity: number;
}

export async function getStocktakeItems(stocktakeId: string): Promise<StocktakeItemWithLive[]> {
  const { data, error } = await supabase
    .from("stocktake_items")
    .select("*, level:inventory_levels(on_hand)")
    .eq("stocktake_id", stocktakeId)
    .order("product_name_snapshot", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as unknown as (StocktakeItem & { level: { on_hand: number } | null })[]).map(
    (row) => ({ ...row, liveQuantity: row.level?.on_hand ?? row.system_quantity }),
  );
}

export async function createStocktake(locationId: string, notes?: string | null): Promise<string> {
  const args: { _location_id: string; _notes?: string } = { _location_id: locationId };
  const trimmed = notes?.trim();
  if (trimmed) args._notes = trimmed;

  const { data, error } = await supabase.rpc("create_stocktake", args);
  if (error) throw error;
  return data as string;
}

export async function startStocktake(id: string): Promise<void> {
  const { error } = await supabase.rpc("start_stocktake", { _stocktake_id: id });
  if (error) throw error;
}

export async function setStocktakeCounts(
  stocktakeId: string,
  lines: { itemId: string; countedQuantity: number | null; note?: string | null }[],
): Promise<void> {
  const payload = lines.map((l) => ({
    item_id: l.itemId,
    counted_quantity: l.countedQuantity === null ? null : String(l.countedQuantity),
    note: l.note ?? null,
  }));
  const { error } = await supabase.rpc("set_stocktake_counts", {
    _stocktake_id: stocktakeId,
    _lines: payload,
  });
  if (error) throw error;
}

export async function finalizeStocktake(id: string, acceptChanges = false): Promise<void> {
  const { error } = await supabase.rpc("finalize_stocktake", {
    _stocktake_id: id,
    _accept_changes: acceptChanges,
  });
  if (error) throw error;
}

export async function cancelStocktake(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_stocktake", {
    _stocktake_id: id,
    _reason: reason,
  });
  if (error) throw error;
}

export type StocktakeRecord = Stocktake;

/* ---------------- Bundle availability (derived, never stored) ---------------- */

export async function getBundleAvailability(
  bundleProductId: string,
  locationId?: string | null,
): Promise<number> {
  const args: { _bundle_product_id: string; _location_id?: string } = {
    _bundle_product_id: bundleProductId,
  };
  if (locationId) args._location_id = locationId;

  const { data, error } = await supabase.rpc("bundle_availability", args);
  if (error) throw error;
  return data ?? 0;
}
