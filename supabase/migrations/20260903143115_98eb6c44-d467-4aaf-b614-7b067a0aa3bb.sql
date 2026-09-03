-- 1. Archived variant lifecycle state
ALTER TYPE public.variant_status ADD VALUE IF NOT EXISTS 'archived';

-- 2. Remove unnecessary anon privileges on catalog & inventory tables
REVOKE ALL ON public.products FROM anon;
REVOKE ALL ON public.product_variants FROM anon;
REVOKE ALL ON public.product_media FROM anon;
REVOKE ALL ON public.product_categories FROM anon;
REVOKE ALL ON public.product_relationships FROM anon;
REVOKE ALL ON public.product_cost_history FROM anon;
REVOKE ALL ON public.bundle_items FROM anon;
REVOKE ALL ON public.categories FROM anon;
REVOKE ALL ON public.brands FROM anon;
REVOKE ALL ON public.inventory_levels FROM anon;
REVOKE ALL ON public.inventory_movements FROM anon;
REVOKE ALL ON public.inventory_locations FROM anon;
REVOKE ALL ON public.inventory_reservations FROM anon;
REVOKE ALL ON public.inventory_transfers FROM anon;
REVOKE ALL ON public.inventory_transfer_items FROM anon;
REVOKE ALL ON public.stocktakes FROM anon;
REVOKE ALL ON public.stocktake_items FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_media TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_relationships TO authenticated;
GRANT SELECT ON public.product_cost_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bundle_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_levels TO authenticated;
GRANT SELECT ON public.inventory_movements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_locations TO authenticated;
GRANT SELECT ON public.inventory_reservations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.inventory_transfers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.inventory_transfer_items TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.stocktakes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.stocktake_items TO authenticated;

-- 3. The raw ledger primitive becomes internal-only.
REVOKE EXECUTE ON FUNCTION public.apply_inventory_movement(uuid, public.inventory_movement_type, integer, text, text, uuid, public.inventory_adjustment_reason) FROM PUBLIC, anon, authenticated;

-- 4. Deletion guards: history must never disappear through DELETE / CASCADE.
CREATE OR REPLACE FUNCTION public.guard_variant_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.order_items WHERE variant_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.purchase_order_items WHERE variant_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.inventory_reservations WHERE variant_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.inventory_transfer_items WHERE variant_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.stocktake_items WHERE variant_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.supplier_products WHERE variant_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.bundle_items WHERE variant_id = OLD.id)
     OR EXISTS (
          SELECT 1 FROM public.inventory_levels il
           WHERE il.variant_id = OLD.id
             AND (il.on_hand <> 0 OR il.reserved <> 0 OR il.damaged <> 0 OR il.incoming <> 0
                  OR EXISTS (SELECT 1 FROM public.inventory_movements m WHERE m.inventory_level_id = il.id)))
  THEN
    RAISE EXCEPTION 'This variant has operational history and cannot be deleted. Archive it instead.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END; $$;

CREATE OR REPLACE FUNCTION public.guard_product_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.order_items WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.purchase_order_items WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.inventory_reservations WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.inventory_transfer_items WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.stocktake_items WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.supplier_products WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.store_products WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.bundle_items WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.group_buy_campaigns WHERE product_id = OLD.id)
     OR EXISTS (
          SELECT 1 FROM public.inventory_levels il
           LEFT JOIN public.product_variants v ON v.id = il.variant_id
           WHERE (il.product_id = OLD.id OR v.product_id = OLD.id)
             AND (il.on_hand <> 0 OR il.reserved <> 0 OR il.damaged <> 0 OR il.incoming <> 0
                  OR EXISTS (SELECT 1 FROM public.inventory_movements m WHERE m.inventory_level_id = il.id)))
     OR EXISTS (
          SELECT 1 FROM public.product_variants v
           WHERE v.product_id = OLD.id
             AND (EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.variant_id = v.id)
               OR EXISTS (SELECT 1 FROM public.purchase_order_items pi WHERE pi.variant_id = v.id)
               OR EXISTS (SELECT 1 FROM public.inventory_reservations r WHERE r.variant_id = v.id)))
  THEN
    RAISE EXCEPTION 'This product has operational history and cannot be deleted. Archive it instead.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS product_variants_guard_delete ON public.product_variants;
CREATE TRIGGER product_variants_guard_delete
  BEFORE DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.guard_variant_delete();

DROP TRIGGER IF EXISTS products_guard_delete ON public.products;
CREATE TRIGGER products_guard_delete
  BEFORE DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.guard_product_delete();

-- 5. Variant-aware inventory analytics
CREATE OR REPLACE FUNCTION public.analytics_inventory()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
declare _r jsonb;
begin
  if not public.can_read_commerce(auth.uid()) then
    raise exception 'Not permitted to read analytics';
  end if;
  with levels as (
    select il.*,
           coalesce(v.base_cost + coalesce(v.additional_cost,0),
                    p.base_cost + coalesce(p.additional_cost,0)) as unit_cost
      from public.inventory_levels il
      left join public.product_variants v on v.id = il.variant_id
      join public.products p on p.id = coalesce(il.product_id, v.product_id)
  )
  select jsonb_build_object(
    'valuation_basis', 'current_catalog_cost',
    'tracked_items', (select count(*) from levels),
    'tracked_variant_items', (select count(*) from levels where variant_id is not null),
    'total_on_hand', (select coalesce(sum(on_hand),0) from levels),
    'total_available', (select coalesce(sum(available_quantity),0) from levels),
    'total_reserved', (select coalesce(sum(reserved),0) from levels),
    'total_damaged', (select coalesce(sum(damaged),0) from levels),
    'total_incoming', (select coalesce(sum(incoming),0) from levels),
    'inventory_value', (select coalesce(sum(on_hand * coalesce(unit_cost,0)),0) from levels),
    'damaged_value', (select coalesce(sum(damaged * coalesce(unit_cost,0)),0) from levels),
    'items_without_cost', (select count(*) from levels where unit_cost is null and on_hand > 0),
    'low_stock_items', (select count(*) from levels
                         where available_quantity > 0
                           and available_quantity <= coalesce(low_stock_threshold, 5)),
    'out_of_stock_items', (select count(*) from levels where available_quantity <= 0),
    'damaged_attention_items', (select count(*) from levels
                                 where damaged > 0
                                   and available_quantity > coalesce(low_stock_threshold, 5)),
    'in_transit_units', (select coalesce(sum(ti.shipped_quantity - coalesce(ti.received_quantity,0)),0)
                           from public.inventory_transfer_items ti
                           join public.inventory_transfers t on t.id = ti.transfer_id
                          where t.status = 'in_transit')
  ) into _r;
  return _r;
end; $$;

DROP FUNCTION IF EXISTS public.analytics_stock_risk(integer);
CREATE FUNCTION public.analytics_stock_risk(_limit integer DEFAULT 25)
RETURNS TABLE(level_id uuid, product_id uuid, product_name text, variant_name text,
              variant_sku text, location_name text, on_hand integer, available integer,
              damaged integer, incoming integer, threshold integer, risk text)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
begin
  if not public.can_read_commerce(auth.uid()) then
    raise exception 'Not permitted to read analytics';
  end if;
  return query
  select il.id, p.id, p.name, v.title, coalesce(v.sku, p.sku), loc.name,
         il.on_hand, il.available_quantity, il.damaged, il.incoming,
         coalesce(il.low_stock_threshold, 5),
         case
           when il.available_quantity <= 0 then 'out_of_stock'
           when il.available_quantity <= coalesce(il.low_stock_threshold, 5) then 'low_stock'
           else 'damaged_attention'
         end
    from public.inventory_levels il
    left join public.product_variants v on v.id = il.variant_id
    join public.products p on p.id = coalesce(il.product_id, v.product_id)
    join public.inventory_locations loc on loc.id = il.location_id
   where il.available_quantity <= coalesce(il.low_stock_threshold, 5) or il.damaged > 0
   order by il.available_quantity asc, il.damaged desc
   limit greatest(coalesce(_limit,25), 1);
end; $$;

REVOKE ALL ON FUNCTION public.analytics_stock_risk(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_stock_risk(integer) TO authenticated, service_role;