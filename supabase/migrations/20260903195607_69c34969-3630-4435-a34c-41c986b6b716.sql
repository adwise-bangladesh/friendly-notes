CREATE OR REPLACE FUNCTION public.shipments_console_list(_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _page int := greatest(1, coalesce((_payload->>'page')::int, 1));
  _page_size int := least(200, greatest(10, coalesce((_payload->>'page_size')::int, 25)));
  _sort text := coalesce(_payload->>'sort', 'newest');
  _search text := nullif(btrim(coalesce(_payload->>'search','')), '');
  _like text;
  _offset int;
  _result jsonb;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read shipments';
  END IF;
  IF _sort NOT IN ('newest','oldest','updated','oldest_unresolved','booking_priority','delivery_priority','cod_desc') THEN
    _sort := 'newest';
  END IF;
  _like := '%' || coalesce(_search,'') || '%';
  _offset := (_page - 1) * _page_size;

  WITH base AS (
    SELECT s.id,
           s.shipment_number,
           s.created_at,
           s.updated_at,
           s.status,
           s.cash_on_delivery_amount,
           CASE
             WHEN s.booking_outcome_unknown THEN 'recovery_required'
             WHEN s.external_consignment_id IS NOT NULL THEN 'booked'
             WHEN s.status = 'booking_failed' THEN 'failed'
             WHEN s.status = 'booking_requested' THEN 'in_progress'
             WHEN s.status = 'ready_for_booking' THEN 'ready'
             ELSE 'none'
           END AS booking_state,
           o.store_id,
           o.order_number,
           o.customer_name,
           o.customer_phone,
           s.provider_id,
           s.courier_account_id,
           s.tracking_number,
           s.external_consignment_id,
           s.recipient_name,
           s.recipient_phone,
           s.delivery_area,
           s.delivery_city,
           s.collected_amount
      FROM public.shipments s
      JOIN public.orders o ON o.id = s.order_id
  ),
  m AS (
    SELECT b.id,
           count(*) OVER () AS total,
           row_number() OVER (
             ORDER BY
               CASE WHEN _sort = 'oldest' THEN b.created_at END ASC,
               CASE WHEN _sort = 'updated' THEN b.updated_at END DESC,
               CASE WHEN _sort = 'cod_desc' THEN b.cash_on_delivery_amount END DESC,
               CASE WHEN _sort = 'oldest_unresolved' THEN
                 CASE WHEN b.status IN ('delivered','return_received','lost','cancelled') THEN 1 ELSE 0 END
               END ASC,
               CASE WHEN _sort = 'booking_priority' THEN
                 CASE b.booking_state WHEN 'recovery_required' THEN 0 WHEN 'failed' THEN 1
                      WHEN 'ready' THEN 2 WHEN 'in_progress' THEN 3 WHEN 'booked' THEN 4 ELSE 5 END
               END ASC,
               CASE WHEN _sort = 'delivery_priority' THEN
                 CASE b.status
                   WHEN 'delivery_failed' THEN 0 WHEN 'delivery_on_hold' THEN 1
                   WHEN 'lost' THEN 2 WHEN 'pickup_failed' THEN 3
                   WHEN 'return_requested' THEN 4 WHEN 'return_in_transit' THEN 5
                   WHEN 'out_for_delivery' THEN 6 WHEN 'in_transit' THEN 7 ELSE 9 END
               END ASC,
               CASE WHEN _sort IN ('oldest_unresolved','booking_priority','delivery_priority') THEN b.created_at END ASC,
               b.created_at DESC,
               b.id DESC
           ) AS rn
      FROM base b
     WHERE (_payload->>'status' IS NULL OR b.status::text = _payload->>'status')
       AND (_payload->>'status_group' IS NULL
            OR (_payload->>'status_group' = 'active'
                AND b.status NOT IN ('delivered','return_received','lost','cancelled'))
            OR (_payload->>'status_group' = 'terminal'
                AND b.status IN ('delivered','return_received','lost','cancelled')))
       AND (_payload->>'booking_state' IS NULL OR b.booking_state = _payload->>'booking_state')
       AND (_payload->>'provider_id' IS NULL
            OR (_payload->>'provider_id' = 'unassigned' AND b.provider_id IS NULL)
            OR (_payload->>'provider_id' = 'assigned' AND b.provider_id IS NOT NULL)
            OR (_payload->>'provider_id' NOT IN ('unassigned','assigned')
                AND b.provider_id = (_payload->>'provider_id')::uuid))
       AND (_payload->>'account_id' IS NULL OR b.courier_account_id = (_payload->>'account_id')::uuid)
       AND (_payload->>'delivery_group' IS NULL
            OR (_payload->>'delivery_group' = 'in_transit' AND b.status IN ('picked_up','in_transit'))
            OR (_payload->>'delivery_group' = 'out_for_delivery' AND b.status = 'out_for_delivery')
            OR (_payload->>'delivery_group' = 'delivered' AND b.status = 'delivered')
            OR (_payload->>'delivery_group' = 'partial' AND b.status = 'partial_delivered')
            OR (_payload->>'delivery_group' = 'failed' AND b.status IN ('delivery_failed','pickup_failed'))
            OR (_payload->>'delivery_group' = 'hold' AND b.status = 'delivery_on_hold')
            OR (_payload->>'delivery_group' = 'lost' AND b.status = 'lost')
            OR (_payload->>'delivery_group' = 'return'
                AND b.status IN ('return_requested','return_in_transit','return_received')))
       AND (_payload->>'cod_min' IS NULL OR b.cash_on_delivery_amount >= (_payload->>'cod_min')::numeric)
       AND (_payload->>'cod_max' IS NULL OR b.cash_on_delivery_amount <= (_payload->>'cod_max')::numeric)
       AND (coalesce((_payload->>'cod_mismatch')::boolean, false) = false
            OR (b.collected_amount IS NOT NULL
                AND b.collected_amount IS DISTINCT FROM b.cash_on_delivery_amount))
       AND (_payload->>'settlement' IS NULL
            OR (_payload->>'settlement' = 'settled'
                AND EXISTS (SELECT 1 FROM public.courier_settlement_items si WHERE si.shipment_id = b.id))
            OR (_payload->>'settlement' = 'unsettled'
                AND b.status IN ('delivered','partial_delivered','return_received','lost')
                AND NOT EXISTS (SELECT 1 FROM public.courier_settlement_items si WHERE si.shipment_id = b.id)))
       AND (coalesce((_payload->>'has_exception')::boolean, false) = false
            OR EXISTS (SELECT 1 FROM public.shipment_exceptions e
                        WHERE e.shipment_id = b.id AND e.status IN ('open','under_review')))
       AND (_payload->>'exception_type' IS NULL
            OR EXISTS (SELECT 1 FROM public.shipment_exceptions e
                        WHERE e.shipment_id = b.id
                          AND e.exception_type::text = _payload->>'exception_type'
                          AND e.status IN ('open','under_review')))
       AND (_payload->>'store_id' IS NULL OR b.store_id = (_payload->>'store_id')::uuid)
       AND (_payload->>'from' IS NULL OR b.created_at >= (_payload->>'from')::timestamptz)
       AND (_payload->>'to' IS NULL OR b.created_at <= (_payload->>'to')::timestamptz)
       AND (_payload->>'min_age_hours' IS NULL
            OR b.created_at <= now() - make_interval(hours => (_payload->>'min_age_hours')::int))
       AND (_payload->>'tracking' IS NULL
            OR (_payload->>'tracking' = 'present' AND b.tracking_number IS NOT NULL)
            OR (_payload->>'tracking' = 'missing' AND b.tracking_number IS NULL))
       AND (
         _search IS NULL
         OR b.shipment_number ILIKE _like
         OR b.order_number ILIKE _like
         OR coalesce(b.tracking_number,'') ILIKE _like
         OR coalesce(b.external_consignment_id,'') ILIKE _like
         OR b.recipient_name ILIKE _like
         OR b.recipient_phone ILIKE _like
         OR coalesce(b.customer_name,'') ILIKE _like
         OR coalesce(b.customer_phone,'') ILIKE _like
         OR coalesce(b.delivery_area,'') ILIKE _like
         OR coalesce(b.delivery_city,'') ILIKE _like
       )
  ),
  pg AS (
    SELECT id, rn FROM m WHERE rn > _offset AND rn <= _offset + _page_size
  ),
  pgrows AS (
    SELECT jsonb_agg(jsonb_build_object(
             'id', s.id,
             'shipment_number', s.shipment_number,
             'status', s.status,
             'order_id', s.order_id,
             'order_number', o.order_number,
             'store_id', o.store_id,
             'store_name', st.name,
             'customer_name', coalesce(o.customer_name, s.recipient_name),
             'customer_phone', coalesce(o.customer_phone, s.recipient_phone),
             'recipient_name', s.recipient_name,
             'recipient_phone', s.recipient_phone,
             'delivery_area', s.delivery_area,
             'delivery_city', s.delivery_city,
             'item_lines', coalesce(it.item_lines, 0),
             'unit_count', coalesce(it.unit_count, 0),
             'first_item', it.first_item,
             'delivered_quantity', coalesce(it.delivered_quantity, 0),
             'refused_quantity', coalesce(it.refused_quantity, 0),
             'lost_quantity', coalesce(it.lost_quantity, 0),
             'damaged_quantity', coalesce(it.damaged_quantity, 0),
             'has_outcome', s.delivery_outcome_recorded_at IS NOT NULL,
             'provider_id', s.provider_id,
             'provider_name', cp.name,
             'provider_code', cp.code,
             'account_id', s.courier_account_id,
             'account_name', ca.name,
             'service_type', s.service_type,
             'tracking_number', s.tracking_number,
             'external_consignment_id', s.external_consignment_id,
             'booking_state', CASE
               WHEN s.booking_outcome_unknown THEN 'recovery_required'
               WHEN s.external_consignment_id IS NOT NULL THEN 'booked'
               WHEN s.status = 'booking_failed' THEN 'failed'
               WHEN s.status = 'booking_requested' THEN 'in_progress'
               WHEN s.status = 'ready_for_booking' THEN 'ready'
               ELSE 'none' END,
             'booking_attempt_count', coalesce(s.booking_attempt_count, 0),
             'booking_last_error', s.booking_last_error,
             'booking_outcome_unknown', s.booking_outcome_unknown,
             'provider_status', s.provider_status,
             'last_synced_at', s.last_synced_at,
             'hold_reason', s.hold_reason,
             'failure_reason', s.failure_reason,
             'cash_on_delivery_amount', s.cash_on_delivery_amount,
             'collected_amount', s.collected_amount,
             'cod_mismatch', s.collected_amount IS NOT NULL
                             AND s.collected_amount IS DISTINCT FROM s.cash_on_delivery_amount,
             'quoted_delivery_fee', s.quoted_delivery_fee,
             'booked_delivery_fee', s.booked_delivery_fee,
             'actual_delivery_fee', s.actual_delivery_fee,
             'settlement_status', settle.settlement_status,
             'open_exceptions', coalesce(ex.open_exceptions, 0),
             'exception_types', coalesce(ex.types, '[]'::jsonb),
             'open_returns', coalesce(rt.open_returns, 0),
             'created_at', s.created_at,
             'updated_at', s.updated_at,
             'age_hours', round(extract(epoch FROM now() - s.created_at) / 3600.0)::int
           ) ORDER BY pg.rn) AS j
      FROM pg
      JOIN public.shipments s ON s.id = pg.id
      JOIN public.orders o ON o.id = s.order_id
      LEFT JOIN public.stores st ON st.id = o.store_id
      LEFT JOIN public.courier_providers cp ON cp.id = s.provider_id
      LEFT JOIN public.courier_accounts ca ON ca.id = s.courier_account_id
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS item_lines,
               coalesce(sum(si.quantity),0)::int AS unit_count,
               coalesce(sum(si.delivered_quantity),0)::int AS delivered_quantity,
               coalesce(sum(si.refused_quantity),0)::int AS refused_quantity,
               coalesce(sum(si.lost_quantity),0)::int AS lost_quantity,
               coalesce(sum(si.damaged_quantity),0)::int AS damaged_quantity,
               (array_agg(oi.product_name ORDER BY oi.sort_order))[1] AS first_item
          FROM public.shipment_items si
          LEFT JOIN public.order_items oi ON oi.id = si.order_item_id
         WHERE si.shipment_id = s.id
      ) it ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS open_exceptions,
               coalesce(jsonb_agg(DISTINCT e.exception_type::text), '[]'::jsonb) AS types
          FROM public.shipment_exceptions e
         WHERE e.shipment_id = s.id AND e.status IN ('open','under_review')
      ) ex ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS open_returns
          FROM public.order_returns r
         WHERE r.shipment_id = s.id AND r.status NOT IN ('cancelled','completed')
      ) rt ON true
      LEFT JOIN LATERAL (
        SELECT cs.status::text AS settlement_status
          FROM public.courier_settlement_items si
          JOIN public.courier_settlements cs ON cs.id = si.settlement_id
         WHERE si.shipment_id = s.id
         ORDER BY si.created_at DESC LIMIT 1
      ) settle ON true
  )
  SELECT jsonb_build_object(
    'total', coalesce((SELECT max(total) FROM m), 0),
    'page', _page,
    'page_size', _page_size,
    'sort', _sort,
    'rows', coalesce((SELECT j FROM pgrows), '[]'::jsonb)
  ) INTO _result;

  RETURN _result;
END; $function$;

REVOKE ALL ON FUNCTION public.shipments_console_list(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shipments_console_list(jsonb) TO authenticated;