CREATE OR REPLACE FUNCTION public.variant_has_history(_variant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.order_items WHERE variant_id = _variant_id)
      OR EXISTS (SELECT 1 FROM public.purchase_order_items WHERE variant_id = _variant_id)
      OR EXISTS (SELECT 1 FROM public.inventory_reservations WHERE variant_id = _variant_id)
      OR EXISTS (SELECT 1 FROM public.inventory_transfer_items WHERE variant_id = _variant_id)
      OR EXISTS (SELECT 1 FROM public.stocktake_items WHERE variant_id = _variant_id)
      OR EXISTS (SELECT 1 FROM public.supplier_products WHERE variant_id = _variant_id)
      OR EXISTS (SELECT 1 FROM public.bundle_items WHERE variant_id = _variant_id)
      OR EXISTS (SELECT 1 FROM public.product_cost_history WHERE variant_id = _variant_id)
      OR EXISTS (
           SELECT 1 FROM public.inventory_levels il
            WHERE il.variant_id = _variant_id
              AND (il.on_hand <> 0 OR il.reserved <> 0 OR il.damaged <> 0 OR il.incoming <> 0
                   OR EXISTS (SELECT 1 FROM public.inventory_movements m
                               WHERE m.inventory_level_id = il.id)));
$function$;

CREATE OR REPLACE FUNCTION public.guard_product_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
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

  IF EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = OLD.id) THEN
    RAISE EXCEPTION 'This product still has variants. Remove its variants first, or archive the product instead.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END; $function$;