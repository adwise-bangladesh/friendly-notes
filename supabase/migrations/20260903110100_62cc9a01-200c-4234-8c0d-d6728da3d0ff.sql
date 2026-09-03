CREATE OR REPLACE FUNCTION public.refresh_order_delivery_status(_order_id uuid)
 RETURNS order_delivery_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _order public.orders;
  _next public.order_delivery_status;
  _started int; _active int; _delivered_ship int; _partial int; _returned int; _lost int;
  _failed_active int; _on_hold int; _moving int; _handed int;
  _ordered_qty int; _shipped_qty int; _delivered_qty int;
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
  INTO _started, _active, _delivered_ship, _partial, _returned, _lost, _failed_active, _on_hold, _moving, _handed
  FROM public.shipments
  WHERE order_id = _order_id AND status <> 'cancelled';

  SELECT coalesce(sum(quantity), 0) INTO _ordered_qty
    FROM public.order_items WHERE order_id = _order_id;

  SELECT coalesce(sum(si.quantity), 0) INTO _shipped_qty
    FROM public.shipment_items si
    JOIN public.shipments s ON s.id = si.shipment_id
   WHERE s.order_id = _order_id AND s.status <> 'cancelled';

  -- Only fully delivered shipments contribute delivered quantity.
  SELECT coalesce(sum(si.quantity), 0) INTO _delivered_qty
    FROM public.shipment_items si
    JOIN public.shipments s ON s.id = si.shipment_id
   WHERE s.order_id = _order_id AND s.status = 'delivered';

  _covered := _ordered_qty > 0 AND _shipped_qty >= _ordered_qty;

  IF _started = 0 THEN
    _next := 'not_shipped';

  ELSIF _active = 0 THEN
    IF _delivered_ship > 0 AND _partial = 0 AND _returned = 0 AND _lost = 0
       AND _ordered_qty > 0 AND _delivered_qty >= _ordered_qty THEN
      _next := 'delivered';
    ELSIF (_delivered_ship > 0 OR _partial > 0) AND (_returned > 0 OR _lost > 0) THEN
      _next := 'partially_returned';
    ELSIF _delivered_ship > 0 OR _partial > 0 THEN
      _next := 'partially_delivered';
    ELSIF _returned > 0 THEN
      _next := 'returned';
    ELSE
      _next := 'delivery_failed';
    END IF;

  ELSE
    IF _delivered_ship > 0 OR _partial > 0 THEN
      _next := 'partially_delivered';
    ELSIF _moving > 0 THEN
      _next := 'in_transit';
    ELSIF _on_hold > 0 THEN
      _next := 'on_hold';
    ELSIF _handed > 0 THEN
      _next := CASE WHEN _covered THEN 'shipped' ELSE 'partially_shipped' END;
    ELSIF _failed_active > 0 THEN
      _next := 'delivery_failed';
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
        || ' to ' || _next::text || ' (derived from delivered quantity across this order''s shipments).',
      'system', true, auth.uid());
  END IF;

  RETURN _next;
END; $function$;