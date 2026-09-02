-- ============================================================
-- Order delivery projection
-- Shipments stay the operational source of truth. The order's
-- delivery_status is a derived read model for lists, dashboards
-- and filtering. It is never written by application code.
-- ============================================================

CREATE OR REPLACE FUNCTION public.refresh_order_delivery_status(_order_id uuid)
RETURNS public.order_delivery_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _order public.orders;
  _next public.order_delivery_status;
  -- shipment population (cancelled shipments are obsolete and ignored)
  _started int;          -- shipments that entered the courier lifecycle
  _active int;           -- still moving / awaiting an outcome
  _delivered int;
  _partial int;
  _returned int;         -- return_received
  _lost int;
  _failed_active int;    -- delivery_failed (retryable, still open)
  _on_hold int;
  _moving int;           -- picked_up / in_transit / out_for_delivery / return legs
  _handed int;           -- booked / pickup_requested / pickup_failed
  _ordered_qty int;
  _shipped_qty int;
  _covered boolean;
BEGIN
  SELECT * INTO _order FROM public.orders WHERE id = _order_id;
  IF _order.id IS NULL THEN RETURN NULL; END IF;

  SELECT
    count(*) FILTER (WHERE status NOT IN ('draft','ready_for_booking','booking_requested','booking_failed')),
    count(*) FILTER (WHERE status IN ('booked','pickup_requested','pickup_failed','picked_up','in_transit',
                                      'out_for_delivery','delivery_on_hold','delivery_failed',
                                      'return_requested','return_in_transit')),
    count(*) FILTER (WHERE status = 'delivered'),
    count(*) FILTER (WHERE status = 'partial_delivered'),
    count(*) FILTER (WHERE status = 'return_received'),
    count(*) FILTER (WHERE status = 'lost'),
    count(*) FILTER (WHERE status = 'delivery_failed'),
    count(*) FILTER (WHERE status = 'delivery_on_hold'),
    count(*) FILTER (WHERE status IN ('picked_up','in_transit','out_for_delivery',
                                      'return_requested','return_in_transit')),
    count(*) FILTER (WHERE status IN ('booked','pickup_requested','pickup_failed'))
  INTO _started, _active, _delivered, _partial, _returned, _lost, _failed_active, _on_hold, _moving, _handed
  FROM public.shipments
  WHERE order_id = _order_id AND status <> 'cancelled';

  -- coverage: has every ordered unit entered a live shipment?
  SELECT coalesce(sum(quantity), 0) INTO _ordered_qty
    FROM public.order_items WHERE order_id = _order_id;
  SELECT coalesce(sum(si.quantity), 0) INTO _shipped_qty
    FROM public.shipment_items si
    JOIN public.shipments s ON s.id = si.shipment_id
   WHERE s.order_id = _order_id AND s.status <> 'cancelled';
  _covered := _ordered_qty > 0 AND _shipped_qty >= _ordered_qty;

  IF _started = 0 THEN
    -- drafts and unbooked shipments are planning, not delivery
    _next := 'not_shipped';

  ELSIF _active = 0 THEN
    -- every started shipment reached a final outcome
    IF _delivered > 0 AND _partial = 0 AND _returned = 0 AND _lost = 0 THEN
      _next := CASE WHEN _covered THEN 'delivered' ELSE 'partially_delivered' END;
    ELSIF (_delivered > 0 OR _partial > 0) AND (_returned > 0 OR _lost > 0) THEN
      _next := 'partially_returned';
    ELSIF _partial > 0 THEN
      _next := 'partially_delivered';
    ELSIF _returned > 0 AND _delivered = 0 AND _partial = 0 THEN
      _next := 'returned';
    ELSE
      -- nothing was delivered and nothing is still open
      _next := 'delivery_failed';
    END IF;

  ELSE
    -- at least one shipment is still open; precedence is explicit
    IF _delivered > 0 OR _partial > 0 THEN
      _next := 'partially_delivered';        -- part of the order already arrived
    ELSIF _moving > 0 THEN
      _next := 'in_transit';                 -- movement beats a hold elsewhere
    ELSIF _on_hold > 0 THEN
      _next := 'on_hold';
    ELSIF _handed > 0 THEN
      _next := CASE WHEN _covered THEN 'shipped' ELSE 'partially_shipped' END;
    ELSIF _failed_active > 0 THEN
      _next := 'delivery_failed';            -- only failures remain open
    ELSE
      _next := 'shipped';
    END IF;
  END IF;

  IF _next IS DISTINCT FROM _order.delivery_status THEN
    PERFORM set_config('app.delivery_write', 'on', true);
    UPDATE public.orders SET delivery_status = _next WHERE id = _order_id;
    PERFORM set_config('app.delivery_write', 'off', true);

    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_order_id,
      'Delivery status changed from ' || _order.delivery_status::text
        || ' to ' || _next::text || ' (derived from this order''s shipments).',
      'system', true, auth.uid());
  END IF;

  RETURN _next;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.refresh_order_delivery_status(uuid) FROM anon;

-- Every shipment write path (manual action, courier booking, status refresh,
-- webhook ingestion, order cancellation) lands here in the same transaction.
CREATE OR REPLACE FUNCTION public.sync_order_delivery_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_order_delivery_status(OLD.order_id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_order_delivery_status(NEW.order_id);
  IF TG_OP = 'UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    PERFORM public.refresh_order_delivery_status(OLD.order_id);
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS shipments_sync_order_delivery ON public.shipments;
CREATE TRIGGER shipments_sync_order_delivery
AFTER INSERT OR DELETE OR UPDATE OF status, order_id ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.sync_order_delivery_projection();

CREATE OR REPLACE FUNCTION public.sync_order_delivery_projection_from_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _oid uuid;
BEGIN
  SELECT order_id INTO _oid FROM public.shipments
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.shipment_id ELSE NEW.shipment_id END;
  IF _oid IS NOT NULL THEN PERFORM public.refresh_order_delivery_status(_oid); END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $function$;

DROP TRIGGER IF EXISTS shipment_items_sync_order_delivery ON public.shipment_items;
CREATE TRIGGER shipment_items_sync_order_delivery
AFTER INSERT OR DELETE OR UPDATE ON public.shipment_items
FOR EACH ROW EXECUTE FUNCTION public.sync_order_delivery_projection_from_item();

-- The projection is backend-owned: block every direct write.
CREATE OR REPLACE FUNCTION public.guard_order_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('app.delivery_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    RAISE EXCEPTION 'Delivery status is derived from the order shipments and cannot be set directly.';
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS orders_guard_delivery ON public.orders;
CREATE TRIGGER orders_guard_delivery
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_order_delivery();

CREATE INDEX IF NOT EXISTS shipments_order_status_idx ON public.shipments (order_id, status);
CREATE INDEX IF NOT EXISTS orders_delivery_status_idx ON public.orders (delivery_status);

-- Backfill every existing order from its current shipments.
DO $backfill$
DECLARE _id uuid;
BEGIN
  FOR _id IN SELECT id FROM public.orders LOOP
    PERFORM public.refresh_order_delivery_status(_id);
  END LOOP;
END $backfill$;