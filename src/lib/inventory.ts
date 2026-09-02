import { supabase } from "@/integrations/supabase/client";
import type {
  InventoryItem,
  InventoryLevelRow,
  InventoryLocation,
  InventoryLocationInsert,
  InventoryLocationUpdate,
  InventoryMovement,
  InventoryMovementType,
} from "@/types/inventory";
import { toInventoryItem } from "@/types/inventory";

/**
 * Inventory data access.
 *
 * Quantities are NEVER written directly: the database blocks any direct write
 * to on_hand / reserved / damaged / incoming. Every change goes through
 * `apply_inventory_movement`, which validates, updates and records an audit
 * movement inside one transaction.
 */

const LEVEL_SELECT = `
  *,
  location:inventory_locations(id, name, code, status),
  product:products(id, name, sku, product_type, supply_model, status),
  variant:product_variants(
    id, title, sku,
    product:products(id, name, product_type, supply_model, status)
  )
`;

/* ---------------- Locations ---------------- */

export async function getLocations(includeArchived = true): Promise<InventoryLocation[]> {
  let query = supabase
    .from("inventory_locations")
    .select("*")
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

  if (!includeArchived) query = query.neq("status", "archived");

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getActiveLocations(): Promise<InventoryLocation[]> {
  const { data, error } = await supabase
    .from("inventory_locations")
    .select("*")
    .eq("status", "active")
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function isLocationCodeAvailable(code: string, ignoreId?: string): Promise<boolean> {
  let query = supabase.from("inventory_locations").select("id").ilike("code", code.trim());
  if (ignoreId) query = query.neq("id", ignoreId);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return (data ?? []).length === 0;
}

export async function createLocation(input: InventoryLocationInsert): Promise<InventoryLocation> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("inventory_locations")
    .insert({ ...input, created_by: userData.user?.id ?? null, updated_by: userData.user?.id ?? null })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateLocation(
  id: string,
  patch: InventoryLocationUpdate,
): Promise<InventoryLocation> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("inventory_locations")
    .update({ ...patch, updated_by: userData.user?.id ?? null })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setDefaultLocation(id: string): Promise<void> {
  const { error } = await supabase.rpc("set_default_inventory_location", { _location_id: id });
  if (error) throw error;
}

export async function archiveLocation(id: string): Promise<void> {
  await updateLocation(id, { status: "archived", is_default: false });
}

export async function restoreLocation(id: string): Promise<void> {
  await updateLocation(id, { status: "active" });
}

/** Locations cannot be deleted while any stock record still points at them. */
export async function locationLevelCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("inventory_levels").select("location_id");
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.location_id] = (counts[row.location_id] ?? 0) + 1;
  return counts;
}

/* ---------------- Inventory levels ---------------- */

export async function getInventoryItems(options?: {
  locationId?: string;
  search?: string;
}): Promise<InventoryItem[]> {
  let query = supabase.from("inventory_levels").select(LEVEL_SELECT).limit(500);
  if (options?.locationId) query = query.eq("location_id", options.locationId);

  const { data, error } = await query;
  if (error) throw error;

  const items = ((data ?? []) as unknown as InventoryLevelRow[]).map(toInventoryItem);
  const term = options?.search?.trim().toLowerCase();
  const filtered = term
    ? items.filter(
        (i) =>
          i.itemName.toLowerCase().includes(term) ||
          (i.variantTitle ?? "").toLowerCase().includes(term) ||
          (i.sku ?? "").toLowerCase().includes(term),
      )
    : items;

  return filtered.sort(
    (a, b) => a.itemName.localeCompare(b.itemName) || (a.variantTitle ?? "").localeCompare(b.variantTitle ?? ""),
  );
}

/** Stock rows for one product (its own row, or one row per variant). */
export async function getInventoryForProduct(productId: string): Promise<InventoryItem[]> {
  const [own, variants] = await Promise.all([
    supabase.from("inventory_levels").select(LEVEL_SELECT).eq("product_id", productId),
    supabase
      .from("inventory_levels")
      .select(`${LEVEL_SELECT}, product_variants!inner(product_id)`)
      .eq("product_variants.product_id", productId),
  ]);
  if (own.error) throw own.error;
  if (variants.error) throw variants.error;

  return [
    ...((own.data ?? []) as unknown as InventoryLevelRow[]),
    ...((variants.data ?? []) as unknown as InventoryLevelRow[]),
  ].map(toInventoryItem);
}

/**
 * Creates the stock record for an item at a location if it does not exist yet.
 * Quantities always start at zero — the database enforces that.
 */
export async function ensureInventoryLevel(input: {
  locationId: string;
  productId?: string | null;
  variantId?: string | null;
  lowStockThreshold?: number | null;
}): Promise<string> {
  const existing = supabase
    .from("inventory_levels")
    .select("id")
    .eq("location_id", input.locationId);

  const { data: found, error: findError } = await (input.variantId
    ? existing.eq("variant_id", input.variantId)
    : existing.eq("product_id", input.productId!)
  ).maybeSingle();
  if (findError) throw findError;
  if (found) return found.id;

  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("inventory_levels")
    .insert({
      location_id: input.locationId,
      product_id: input.variantId ? null : (input.productId ?? null),
      variant_id: input.variantId ?? null,
      low_stock_threshold: input.lowStockThreshold ?? null,
      created_by: userData.user?.id ?? null,
      updated_by: userData.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Fresh quantities for one stock record (used to keep the adjust dialog live). */
export async function getLevelSnapshot(levelId: string) {
  const { data, error } = await supabase
    .from("inventory_levels")
    .select("id, on_hand, reserved, damaged, incoming, available_quantity, low_stock_threshold")
    .eq("id", levelId)
    .single();
  if (error) throw error;
  return data;
}

export async function setLowStockThreshold(
  levelId: string,
  threshold: number | null,
): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("inventory_levels")
    .update({ low_stock_threshold: threshold, updated_by: userData.user?.id ?? null })
    .eq("id", levelId);
  if (error) throw error;
}

/* ---------------- Movements ---------------- */

export async function applyMovement(input: {
  levelId: string;
  type: InventoryMovementType;
  quantity: number;
  note?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
}): Promise<void> {
  const args: {
    _inventory_level_id: string;
    _movement_type: InventoryMovementType;
    _quantity: number;
    _note?: string;
    _reference_type?: string;
    _reference_id?: string;
  } = {
    _inventory_level_id: input.levelId,
    _movement_type: input.type,
    _quantity: input.quantity,
  };
  if (input.note) args._note = input.note;
  if (input.referenceType) args._reference_type = input.referenceType;
  if (input.referenceId) args._reference_id = input.referenceId;

  const { error } = await supabase.rpc("apply_inventory_movement", args);
  if (error) throw error;
}

export interface MovementWithActor extends InventoryMovement {
  actorName: string | null;
}

export async function getMovements(levelId: string, limit = 50): Promise<MovementWithActor[]> {
  const { data, error } = await supabase
    .from("inventory_movements")
    .select("*")
    .eq("inventory_level_id", levelId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = data ?? [];
  const actorIds = [...new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v))];
  let names: Record<string, string | null> = {};
  if (actorIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);
    names = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name]));
  }

  return rows.map((r) => ({ ...r, actorName: r.created_by ? (names[r.created_by] ?? null) : null }));
}
