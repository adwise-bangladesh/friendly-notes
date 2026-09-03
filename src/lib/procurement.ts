import { supabase } from "@/integrations/supabase/client";
import type {
  DraftPurchaseOrderItem,
  GoodsReceipt,
  GoodsReceiptWithItems,
  ProductCostHistory,
  PurchaseOrderCharges,
  PurchaseOrderDetail,
  PurchaseOrderListRow,
  PurchaseOrderStatus,
  ReceiveLineDraft,
  Supplier,
  SupplierContact,
  SupplierContactInsert,
  SupplierInsert,
  SupplierListRow,
  SupplierProductInsert,
  SupplierProductWithItem,
  SupplierStatus,
} from "@/types/procurement";
import { acceptedQuantity } from "@/types/procurement";

/**
 * Procurement data access.
 *
 * Purchase orders, goods receipts, procurement events and cost history are
 * read-only to the client: the database rejects every direct write. All
 * changes go through the controlled `SECURITY DEFINER` operations below,
 * which validate the lifecycle, keep quantities honest and route stock
 * changes through the existing `apply_inventory_movement` mechanism.
 *
 * Selects are explicit — procurement costs and supplier notes are internal.
 */

const SUPPLIER_SELECT = `
  id, name, supplier_code, contact_person, phone, email, address, city, country,
  default_currency, status, notes, created_by, updated_by, created_at, updated_at
`;

const PO_ITEM_SELECT = `
  id, purchase_order_id, product_id, variant_id, product_name_snapshot, variant_name_snapshot,
  sku_snapshot, quantity_ordered, quantity_received, unit_cost, discount_amount, tax_amount,
  line_total, sort_order, created_at, updated_at
`;

const PO_SELECT = `
  id, purchase_order_number, supplier_id, supplier_name_snapshot, supplier_code_snapshot,
  status, order_date, expected_delivery_date, currency,
  exchange_rate, subtotal, discount_total, shipping_cost, duty_cost, other_cost, grand_total,
  notes, submitted_at, approved_by, approved_at, ordered_at, cancelled_at, cancel_reason,
  closed_at, created_by, updated_by, created_at, updated_at
`;

const RECEIPT_SELECT = `
  id, receipt_number, purchase_order_id, inventory_location_id, status, notes,
  received_at, received_by, reversed_at, reversal_reason, created_by, created_at, updated_at
`;

const RECEIPT_ITEM_SELECT = `
  id, goods_receipt_id, purchase_order_item_id, quantity_received, quantity_accepted,
  quantity_damaged, unit_cost_snapshot, notes, created_at, updated_at
`;

/* ==================== Suppliers ==================== */

export async function getSuppliers(options?: {
  search?: string;
  status?: SupplierStatus | "all";
}): Promise<SupplierListRow[]> {
  const [suppliersResult, summaryResult] = await Promise.all([
    supabase.from("suppliers").select(SUPPLIER_SELECT).order("name", { ascending: true }),
    supabase.rpc("supplier_summaries"),
  ]);
  if (suppliersResult.error) throw suppliersResult.error;
  if (summaryResult.error) throw summaryResult.error;

  const summaries = new Map(
    (summaryResult.data ?? []).map((s) => [s.supplier_id, s] as const),
  );

  let rows: SupplierListRow[] = (suppliersResult.data ?? []).map((s) => {
    const summary = summaries.get(s.id);
    return {
      ...s,
      productCount: Number(summary?.product_count ?? 0),
      purchaseOrderCount: Number(summary?.purchase_order_count ?? 0),
      primaryContactName: summary?.primary_contact_name ?? null,
      primaryContactPhone: summary?.primary_contact_phone ?? null,
    };
  });

  if (options?.status && options.status !== "all") {
    rows = rows.filter((r) => r.status === options.status);
  }
  const term = options?.search?.trim().toLowerCase();
  if (term) {
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(term) ||
        r.supplier_code.toLowerCase().includes(term) ||
        (r.phone ?? "").toLowerCase().includes(term) ||
        (r.contact_person ?? "").toLowerCase().includes(term),
    );
  }
  return rows;
}

export async function getSupplier(id: string): Promise<Supplier | null> {
  const { data, error } = await supabase
    .from("suppliers")
    .select(SUPPLIER_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getActiveSuppliers(): Promise<Pick<Supplier, "id" | "name" | "supplier_code" | "default_currency">[]> {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name, supplier_code, default_currency")
    .eq("status", "active")
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createSupplier(input: SupplierInsert): Promise<Supplier> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("suppliers")
    .insert({ ...input, created_by: userData.user?.id ?? null, updated_by: userData.user?.id ?? null })
    .select(SUPPLIER_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function updateSupplier(
  id: string,
  patch: Partial<SupplierInsert>,
): Promise<Supplier> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("suppliers")
    .update({ ...patch, updated_by: userData.user?.id ?? null })
    .eq("id", id)
    .select(SUPPLIER_SELECT)
    .single();
  if (error) throw error;
  return data;
}

/** Suppliers are never deleted — archiving keeps procurement history intact. */
export async function archiveSupplier(id: string): Promise<void> {
  await updateSupplier(id, { status: "archived" });
}
export async function restoreSupplier(id: string): Promise<void> {
  await updateSupplier(id, { status: "active" });
}

export async function isSupplierCodeAvailable(code: string, ignoreId?: string): Promise<boolean> {
  let query = supabase.from("suppliers").select("id").ilike("supplier_code", code.trim());
  if (ignoreId) query = query.neq("id", ignoreId);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return (data ?? []).length === 0;
}

/* ==================== Supplier contacts ==================== */

export async function getSupplierContacts(supplierId: string): Promise<SupplierContact[]> {
  const { data, error } = await supabase
    .from("supplier_contacts")
    .select("id, supplier_id, name, phone, email, role, is_primary, notes, created_at, updated_at")
    .eq("supplier_id", supplierId)
    .order("is_primary", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * A partial unique index guarantees a single primary contact per supplier, so
 * promoting a new primary must demote the current one first.
 */
export async function saveSupplierContact(input: SupplierContactInsert & { id?: string }): Promise<void> {
  const { id, ...values } = input;
  if (values.is_primary) {
    const demote = supabase
      .from("supplier_contacts")
      .update({ is_primary: false })
      .eq("supplier_id", values.supplier_id)
      .eq("is_primary", true);
    const { error } = id ? await demote.neq("id", id) : await demote;
    if (error) throw error;
  }
  const { error } = id
    ? await supabase.from("supplier_contacts").update(values).eq("id", id)
    : await supabase.from("supplier_contacts").insert(values);
  if (error) throw error;
}

export async function deleteSupplierContact(id: string): Promise<void> {
  const { error } = await supabase.from("supplier_contacts").delete().eq("id", id);
  if (error) throw error;
}

/* ==================== Supplier products ==================== */

const SUPPLIER_PRODUCT_SELECT = `
  id, supplier_id, product_id, variant_id, supplier_sku, supplier_product_name,
  last_purchase_cost, currency, minimum_order_quantity, lead_time_days, is_preferred,
  notes, created_at, updated_at,
  product:products(id, name, sku),
  variant:product_variants(id, title, sku, product:products(id, name))
`;

export async function getSupplierProducts(supplierId: string): Promise<SupplierProductWithItem[]> {
  const { data, error } = await supabase
    .from("supplier_products")
    .select(SUPPLIER_PRODUCT_SELECT)
    .eq("supplier_id", supplierId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as SupplierProductWithItem[];
}

/** Atomic, server-side preferred supplier switch (single preferred per product/variant). */
export async function setPreferredSupplierProduct(supplierProductId: string): Promise<void> {
  const { error } = await supabase.rpc("set_preferred_supplier_product", {
    _supplier_product_id: supplierProductId,
  });
  if (error) throw error;
}

export async function saveSupplierProduct(input: SupplierProductInsert & { id?: string }): Promise<void> {
  const { id, ...values } = input;
  const wantsPreferred = values.is_preferred === true;
  // The preferred flag is never written directly: the controlled operation
  // clears the previous holder and sets the new one in one step.
  const payload = { ...values, is_preferred: false };

  let rowId = id;
  if (id) {
    const { error } = await supabase.from("supplier_products").update(payload).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from("supplier_products")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw error;
    rowId = data.id;
  }

  if (wantsPreferred && rowId) await setPreferredSupplierProduct(rowId);
}

export async function deleteSupplierProduct(id: string): Promise<void> {
  const { error } = await supabase.from("supplier_products").delete().eq("id", id);
  if (error) throw error;
}

/** Items this supplier already supplies, used to pre-fill purchase order lines. */
export async function getSupplierCatalogue(supplierId: string): Promise<SupplierProductWithItem[]> {
  return getSupplierProducts(supplierId);
}

/* ==================== Stockable item search ==================== */

export interface StockableItemOption {
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string | null;
  baseCost: number | null;
}

interface StockableProductRow {
  id: string;
  name: string;
  sku: string | null;
  product_type: string;
  base_cost: number | null;
  product_variants: {
    id: string;
    title: string;
    sku: string | null;
    base_cost: number | null;
    status: string;
  }[];
}

/**
 * Only stock-carrying items can be purchased: a simple product itself, or a
 * variant of a variable product. This mirrors the database eligibility rule,
 * so the picker can never offer something a purchase order would reject.
 */
export async function searchStockableItems(term: string, limit = 20): Promise<StockableItemOption[]> {
  let query = supabase
    .from("products")
    .select(
      `id, name, sku, product_type, base_cost,
       product_variants(id, title, sku, base_cost, status)`,
    )
    .in("product_type", ["simple", "variable"])
    .neq("status", "archived")
    .order("name")
    .limit(limit);

  const search = term.trim();
  if (search) {
    const like = `%${search}%`;
    query = query.or(`name.ilike.${like},sku.ilike.${like}`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const options: StockableItemOption[] = [];
  for (const row of (data ?? []) as unknown as StockableProductRow[]) {
    if (row.product_type === "simple") {
      options.push({
        productId: row.id,
        variantId: null,
        productName: row.name,
        variantName: null,
        sku: row.sku,
        baseCost: row.base_cost === null ? null : Number(row.base_cost),
      });
      continue;
    }
    for (const v of row.product_variants) {
      if (v.status !== "active") continue;
      options.push({
        productId: row.id,
        variantId: v.id,
        productName: row.name,
        variantName: v.title,
        sku: v.sku ?? row.sku,
        baseCost: v.base_cost === null ? null : Number(v.base_cost),
      });
    }
  }
  return options;
}

/* ==================== Purchase orders ==================== */

export async function getPurchaseOrders(options?: {
  search?: string;
  status?: PurchaseOrderStatus | "all";
  supplierId?: string;
  from?: string;
  to?: string;
}): Promise<PurchaseOrderListRow[]> {
  let query = supabase
    .from("purchase_orders")
    .select(
      `id, purchase_order_number, status, order_date, expected_delivery_date, currency,
       grand_total, created_at, supplier_name_snapshot, supplier_code_snapshot,
       supplier:suppliers(id, name, supplier_code),
       item_count:purchase_order_items(count)`,
    )
    .order("created_at", { ascending: false })
    .limit(300);

  if (options?.status && options.status !== "all") query = query.eq("status", options.status);
  if (options?.supplierId && options.supplierId !== "all") query = query.eq("supplier_id", options.supplierId);
  if (options?.from) query = query.gte("order_date", options.from);
  if (options?.to) query = query.lte("order_date", options.to);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as PurchaseOrderListRow[];
  const term = options?.search?.trim().toLowerCase();
  if (!term) return rows;
  return rows.filter(
    (r) =>
      r.purchase_order_number.toLowerCase().includes(term) ||
      (r.supplier_name_snapshot ?? r.supplier?.name ?? "").toLowerCase().includes(term),
  );
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderDetail | null> {
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(
      `${PO_SELECT},
       supplier:suppliers(${SUPPLIER_SELECT}),
       items:purchase_order_items(${PO_ITEM_SELECT}),
       receipts:goods_receipts(
         ${RECEIPT_SELECT},
         location:inventory_locations(id, name, code),
         items:goods_receipt_items(${RECEIPT_ITEM_SELECT})
       ),
       events:purchase_order_events(
         id, purchase_order_id, event_type, from_status, to_status, message, metadata,
         created_by, created_at
       )`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const detail = data as unknown as PurchaseOrderDetail;
  detail.items = [...detail.items].sort((a, b) => a.sort_order - b.sort_order);
  detail.receipts = [...detail.receipts].sort((a, b) => b.created_at.localeCompare(a.created_at));
  detail.events = [...detail.events].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return detail;
}

export interface PurchaseOrderInput {
  id?: string;
  supplierId: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  currency: string;
  exchangeRate: number | null;
  notes: string | null;
  charges: PurchaseOrderCharges;
  items: DraftPurchaseOrderItem[];
}

export async function savePurchaseOrder(input: PurchaseOrderInput): Promise<string> {
  const payload = {
    ...(input.id ? { id: input.id } : {}),
    supplier_id: input.supplierId,
    order_date: input.orderDate,
    expected_delivery_date: input.expectedDeliveryDate,
    currency: input.currency,
    exchange_rate: input.exchangeRate,
    notes: input.notes,
    discount_total: input.charges.discountTotal,
    shipping_cost: input.charges.shippingCost,
    duty_cost: input.charges.dutyCost,
    other_cost: input.charges.otherCost,
    items: input.items.map((i) => ({
      product_id: i.productId,
      variant_id: i.variantId,
      quantity_ordered: i.quantityOrdered,
      unit_cost: i.unitCost,
      discount_amount: i.discountAmount,
      tax_amount: i.taxAmount,
    })),
  };
  const { data, error } = await supabase.rpc("save_purchase_order", { _payload: payload });
  if (error) throw error;
  return data as string;
}

export async function setPurchaseOrderStatus(
  id: string,
  status: PurchaseOrderStatus,
  note?: string,
): Promise<void> {
  const args: { _po_id: string; _status: PurchaseOrderStatus; _note?: string } = {
    _po_id: id,
    _status: status,
  };
  if (note && note.trim()) args._note = note.trim();
  const { error } = await supabase.rpc("set_purchase_order_status", args);
  if (error) throw error;
}

/* ==================== Goods receipts ==================== */

export async function getGoodsReceipt(id: string): Promise<
  | (GoodsReceiptWithItems & {
      purchase_order: {
        id: string;
        purchase_order_number: string;
        status: PurchaseOrderStatus;
        currency: string;
        supplier: { id: string; name: string } | null;
        items: PurchaseOrderDetail["items"];
      } | null;
    })
  | null
> {
  const { data, error } = await supabase
    .from("goods_receipts")
    .select(
      `${RECEIPT_SELECT},
       location:inventory_locations(id, name, code),
       items:goods_receipt_items(${RECEIPT_ITEM_SELECT}),
       purchase_order:purchase_orders(
         id, purchase_order_number, status, currency,
         supplier:suppliers(id, name),
         items:purchase_order_items(${PO_ITEM_SELECT})
       )`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data as unknown as GoodsReceiptWithItems & {
    purchase_order: {
      id: string;
      purchase_order_number: string;
      status: PurchaseOrderStatus;
      currency: string;
      supplier: { id: string; name: string } | null;
      items: PurchaseOrderDetail["items"];
    } | null;
  };
}

export async function getOpenReceipts(): Promise<
  (Pick<GoodsReceipt, "id" | "receipt_number" | "status" | "created_at"> & {
    purchase_order: { id: string; purchase_order_number: string } | null;
  })[]
> {
  const { data, error } = await supabase
    .from("goods_receipts")
    .select(
      `id, receipt_number, status, created_at,
       purchase_order:purchase_orders(id, purchase_order_number)`,
    )
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as (Pick<GoodsReceipt, "id" | "receipt_number" | "status" | "created_at"> & {
    purchase_order: { id: string; purchase_order_number: string } | null;
  })[];
}

export async function createGoodsReceipt(
  purchaseOrderId: string,
  locationId: string,
  notes?: string,
): Promise<string> {
  const args: { _po_id: string; _location_id: string; _notes?: string } = {
    _po_id: purchaseOrderId,
    _location_id: locationId,
  };
  if (notes && notes.trim()) args._notes = notes.trim();
  const { data, error } = await supabase.rpc("create_goods_receipt", args);
  if (error) throw error;
  return data as string;
}

export async function setGoodsReceiptLines(
  receiptId: string,
  lines: ReceiveLineDraft[],
): Promise<void> {
  const { error } = await supabase.rpc("set_goods_receipt_lines", {
    _receipt_id: receiptId,
    _lines: lines
      .filter((l) => l.received > 0)
      .map((l) => ({
        purchase_order_item_id: l.purchaseOrderItemId,
        quantity_received: l.received,
        quantity_accepted: acceptedQuantity(l),
        quantity_damaged: l.damaged,
        notes: l.notes || null,
      })),
  });
  if (error) throw error;
}

/** Atomic: validates, moves stock, updates quantities and the PO status, or rolls back. */
export async function finalizeGoodsReceipt(receiptId: string): Promise<void> {
  const { error } = await supabase.rpc("finalize_goods_receipt", { _receipt_id: receiptId });
  if (error) throw error;
}

export async function cancelGoodsReceipt(receiptId: string, reason?: string): Promise<void> {
  const args: { _receipt_id: string; _reason?: string } = { _receipt_id: receiptId };
  if (reason && reason.trim()) args._reason = reason.trim();
  const { error } = await supabase.rpc("cancel_goods_receipt", args);
  if (error) throw error;
}

/** Admin-only correction path for a finalised receipt. Never rewrites history. */
export async function reverseGoodsReceipt(receiptId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("reverse_goods_receipt", {
    _receipt_id: receiptId,
    _reason: reason,
  });
  if (error) throw error;
}

/* ==================== Cost history ==================== */

export async function getItemCostHistory(input: {
  productId?: string | null;
  variantId?: string | null;
  limit?: number;
}): Promise<ProductCostHistory[]> {
  let query = supabase
    .from("product_cost_history")
    .select(
      `id, product_id, variant_id, cost_type, previous_cost, new_cost, source_type,
       source_id, note, effective_at, created_by, created_at`,
    )
    .order("effective_at", { ascending: false })
    .limit(input.limit ?? 25);

  query = input.variantId
    ? query.eq("variant_id", input.variantId)
    : query.eq("product_id", input.productId!);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** Explicit, admin-only. A goods receipt never changes catalog cost by itself. */
export async function applyCatalogCostUpdate(input: {
  productId: string | null;
  variantId: string | null;
  newCost: number;
  source: "manual" | "purchase_receipt" | "correction";
  sourceId?: string | null;
  note?: string | null;
}): Promise<void> {
  // The function takes a product XOR a variant; the unused side is passed as
  // SQL NULL, which the generated signature types as a plain string.
  const args: {
    _product_id: string;
    _variant_id: string;
    _new_cost: number;
    _source: "manual" | "purchase_receipt" | "correction";
    _source_id?: string;
    _note?: string;
  } = {
    _product_id: input.productId as string,
    _variant_id: input.variantId as string,
    _new_cost: input.newCost,
    _source: input.source,
  };
  if (input.sourceId) args._source_id = input.sourceId;
  if (input.note) args._note = input.note;

  const { error } = await supabase.rpc("apply_catalog_cost_update", args);
  if (error) throw error;
}

/* ==================== Dashboard indicators ==================== */

export async function getProcurementAttention(): Promise<{
  awaitingApproval: number;
  expectedToday: number;
  partiallyReceived: number;
  openReceipts: number;
}> {
  const today = new Date().toISOString().slice(0, 10);
  const [approval, expected, partial, receipts] = await Promise.all([
    supabase.from("purchase_orders").select("id", { count: "exact", head: true }).eq("status", "pending_approval"),
    supabase
      .from("purchase_orders")
      .select("id", { count: "exact", head: true })
      .eq("expected_delivery_date", today)
      .in("status", ["approved", "ordered", "partially_received"]),
    supabase.from("purchase_orders").select("id", { count: "exact", head: true }).eq("status", "partially_received"),
    supabase.from("goods_receipts").select("id", { count: "exact", head: true }).eq("status", "draft"),
  ]);
  if (approval.error) throw approval.error;
  if (expected.error) throw expected.error;
  if (partial.error) throw partial.error;
  if (receipts.error) throw receipts.error;

  return {
    awaitingApproval: approval.count ?? 0,
    expectedToday: expected.count ?? 0,
    partiallyReceived: partial.count ?? 0,
    openReceipts: receipts.count ?? 0,
  };
}
