-- Shipping desk console projection -------------------------------------------
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

-- Shipment quick view ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shipment_quick_view(_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _s public.shipments;
  _o public.orders;
  _result jsonb;
  _profit jsonb := NULL;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read shipments';
  END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  SELECT * INTO _o FROM public.orders WHERE id = _s.order_id;

  BEGIN
    _profit := public.shipment_profitability(_s.id);
  EXCEPTION WHEN OTHERS THEN
    _profit := NULL;
  END;

  SELECT jsonb_build_object(
    'shipment', jsonb_build_object(
      'id', _s.id,
      'shipment_number', _s.shipment_number,
      'status', _s.status,
      'service_type', _s.service_type,
      'created_at', _s.created_at,
      'updated_at', _s.updated_at,
      'booked_at', _s.booked_at,
      'picked_up_at', _s.picked_up_at,
      'delivered_at', _s.delivered_at,
      'notes', _s.notes,
      'partial_delivery_note', _s.partial_delivery_note
    ),
    'order', jsonb_build_object(
      'id', _o.id,
      'order_number', _o.order_number,
      'status', _o.status,
      'payment_method', _o.payment_method,
      'grand_total', _o.grand_total,
      'due_amount', _o.due_amount,
      'store_id', _o.store_id
    ),
    'customer', jsonb_build_object(
      'name', coalesce(_o.customer_name, _s.recipient_name),
      'phone', coalesce(_o.customer_phone, _s.recipient_phone),
      'recipient_name', _s.recipient_name,
      'recipient_phone', _s.recipient_phone,
      'address', _s.delivery_address,
      'area', _s.delivery_area,
      'city', _s.delivery_city,
      'zone', _s.delivery_zone,
      'postal_code', _s.postal_code
    ),
    'courier', jsonb_build_object(
      'provider_id', _s.provider_id,
      'provider_name', (SELECT name FROM public.courier_providers WHERE id = _s.provider_id),
      'provider_code', (SELECT code FROM public.courier_providers WHERE id = _s.provider_id),
      'account_id', _s.courier_account_id,
      'account_name', (SELECT name FROM public.courier_accounts WHERE id = _s.courier_account_id),
      'tracking_number', _s.tracking_number,
      'external_consignment_id', _s.external_consignment_id,
      'provider_reference', _s.provider_reference
    ),
    'booking', jsonb_build_object(
      'state', CASE
        WHEN _s.booking_outcome_unknown THEN 'recovery_required'
        WHEN _s.external_consignment_id IS NOT NULL THEN 'booked'
        WHEN _s.status = 'booking_failed' THEN 'failed'
        WHEN _s.status = 'booking_requested' THEN 'in_progress'
        WHEN _s.status = 'ready_for_booking' THEN 'ready'
        ELSE 'none' END,
      'attempt_count', coalesce(_s.booking_attempt_count, 0),
      'attempt_started_at', _s.booking_attempt_started_at,
      'last_error', _s.booking_last_error,
      'outcome_unknown', _s.booking_outcome_unknown
    ),
    'delivery', jsonb_build_object(
      'status', _s.status,
      'provider_status', _s.provider_status,
      'provider_status_at', _s.provider_status_at,
      'last_synced_at', _s.last_synced_at,
      'hold_reason', _s.hold_reason,
      'failure_reason', _s.failure_reason,
      'outcome_recorded_at', _s.delivery_outcome_recorded_at
    ),
    'financial', jsonb_build_object(
      'expected_cod', _s.cash_on_delivery_amount,
      'collected_amount', _s.collected_amount,
      'quoted_delivery_fee', _s.quoted_delivery_fee,
      'booked_delivery_fee', _s.booked_delivery_fee,
      'actual_delivery_fee', _s.actual_delivery_fee,
      'cod_fee', _s.cod_fee,
      'return_charge', _s.return_charge,
      'other_courier_charge', _s.other_courier_charge,
      'financials_recorded_at', _s.financials_recorded_at,
      'settlement_status', (
        SELECT cs.status::text FROM public.courier_settlement_items si
          JOIN public.courier_settlements cs ON cs.id = si.settlement_id
         WHERE si.shipment_id = _s.id ORDER BY si.created_at DESC LIMIT 1)
    ),
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', si.id,
               'product_name', oi.product_name,
               'variant_name', oi.variant_name,
               'sku', oi.sku,
               'quantity', si.quantity,
               'delivered_quantity', si.delivered_quantity,
               'refused_quantity', si.refused_quantity,
               'lost_quantity', si.lost_quantity,
               'damaged_quantity', si.damaged_quantity
             ) ORDER BY oi.sort_order)
        FROM public.shipment_items si
        LEFT JOIN public.order_items oi ON oi.id = si.order_item_id
       WHERE si.shipment_id = _s.id), '[]'::jsonb),
    'returns', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'return_number', r.return_number,
               'status', r.status, 'return_type', r.return_type)
             ORDER BY r.requested_at DESC)
        FROM public.order_returns r WHERE r.shipment_id = _s.id), '[]'::jsonb),
    'exceptions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'exception_type', e.exception_type, 'status', e.status,
               'reason', coalesce(e.courier_reason, e.reason),
               'occurred_at', e.occurred_at,
               'assigned_to', oa.assigned_to,
               'assigned_name', p.full_name,
               'assigned_is_mine', oa.assigned_to IS NOT NULL AND oa.assigned_to = auth.uid())
             ORDER BY e.occurred_at DESC)
        FROM public.shipment_exceptions e
        LEFT JOIN public.operational_assignments oa
          ON oa.source_type = 'shipment_exception' AND oa.source_id = e.id AND oa.released_at IS NULL
        LEFT JOIN public.profiles p ON p.id = oa.assigned_to
       WHERE e.shipment_id = _s.id), '[]'::jsonb),
    'profit', _profit,
    'can_manage', public.can_manage_commerce(auth.uid())
  ) INTO _result;

  RETURN _result;
END; $function$;

-- Bulk courier assignment (per-shipment, reuses assign_shipment_courier) -------
CREATE OR REPLACE FUNCTION public.bulk_assign_shipment_courier(
  _shipment_ids uuid[],
  _provider_id uuid,
  _service_type courier_service_type DEFAULT NULL,
  _account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid;
  _results jsonb := '[]'::jsonb;
  _number text;
  _count int := coalesce(array_length(_shipment_ids, 1), 0);
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to assign couriers';
  END IF;
  IF _count = 0 THEN RAISE EXCEPTION 'Select at least one shipment'; END IF;
  IF _count > 100 THEN RAISE EXCEPTION 'Assign at most 100 shipments at a time (selected %)', _count; END IF;

  FOREACH _id IN ARRAY _shipment_ids LOOP
    SELECT shipment_number INTO _number FROM public.shipments WHERE id = _id;
    BEGIN
      PERFORM public.assign_shipment_courier(_id, _provider_id, _service_type, _account_id);
      _results := _results || jsonb_build_object(
        'shipment_id', _id, 'shipment_number', _number, 'ok', true, 'error', NULL);
    EXCEPTION WHEN OTHERS THEN
      _results := _results || jsonb_build_object(
        'shipment_id', _id, 'shipment_number', _number, 'ok', false, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'requested', _count,
    'succeeded', (SELECT count(*) FROM jsonb_array_elements(_results) r WHERE (r->>'ok')::boolean),
    'failed', (SELECT count(*) FROM jsonb_array_elements(_results) r WHERE NOT (r->>'ok')::boolean),
    'results', _results);
END; $function$;

-- Exception desk projection ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.exceptions_console_list(_payload jsonb DEFAULT '{}'::jsonb)
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
    RAISE EXCEPTION 'Not permitted to read delivery exceptions';
  END IF;
  IF _sort NOT IN ('newest','oldest_unresolved','priority','oldest_assigned') THEN
    _sort := 'newest';
  END IF;
  _like := '%' || coalesce(_search,'') || '%';
  _offset := (_page - 1) * _page_size;

  WITH m AS (
    SELECT e.id,
           count(*) OVER () AS total,
           row_number() OVER (
             ORDER BY
               CASE WHEN _sort = 'oldest_unresolved' THEN
                 CASE WHEN e.status IN ('open','under_review') THEN 0 ELSE 1 END END ASC,
               CASE WHEN _sort = 'priority' THEN
                 CASE e.exception_type
                   WHEN 'lost_in_transit' THEN 0 WHEN 'damaged_in_transit' THEN 1
                   WHEN 'delivery_failed' THEN 2 WHEN 'partial_delivery' THEN 3
                   WHEN 'customer_refused' THEN 4 WHEN 'pickup_failed' THEN 5
                   ELSE 6 END END ASC,
               CASE WHEN _sort = 'oldest_assigned' THEN oa.assigned_at END ASC NULLS LAST,
               CASE WHEN _sort IN ('oldest_unresolved','priority','oldest_assigned') THEN e.occurred_at END ASC,
               e.occurred_at DESC,
               e.id DESC
           ) AS rn
      FROM public.shipment_exceptions e
      LEFT JOIN public.shipments s ON s.id = e.shipment_id
      LEFT JOIN public.orders o ON o.id = e.order_id
      LEFT JOIN public.operational_assignments oa
        ON oa.source_type = 'shipment_exception' AND oa.source_id = e.id AND oa.released_at IS NULL
     WHERE (_payload->>'status' IS NULL
            OR (_payload->>'status' = 'open' AND e.status IN ('open','under_review'))
            OR (_payload->>'status' NOT IN ('open','all') AND e.status::text = _payload->>'status')
            OR _payload->>'status' = 'all')
       AND (_payload->>'exception_type' IS NULL OR e.exception_type::text = _payload->>'exception_type')
       AND (_payload->>'provider_id' IS NULL OR s.provider_id = (_payload->>'provider_id')::uuid)
       AND (_payload->>'account_id' IS NULL OR s.courier_account_id = (_payload->>'account_id')::uuid)
       AND (_payload->>'store_id' IS NULL OR o.store_id = (_payload->>'store_id')::uuid)
       AND (_payload->>'shipment_status' IS NULL OR s.status::text = _payload->>'shipment_status')
       AND (_payload->>'assigned_to' IS NULL
            OR (_payload->>'assigned_to' = 'unassigned' AND oa.id IS NULL)
            OR (_payload->>'assigned_to' = 'me' AND oa.assigned_to = auth.uid())
            OR (_payload->>'assigned_to' NOT IN ('unassigned','me')
                AND oa.assigned_to = (_payload->>'assigned_to')::uuid))
       AND (_payload->>'from' IS NULL OR e.occurred_at >= (_payload->>'from')::timestamptz)
       AND (_payload->>'to' IS NULL OR e.occurred_at <= (_payload->>'to')::timestamptz)
       AND (coalesce((_payload->>'has_discrepancy')::boolean, false) = false
            OR EXISTS (SELECT 1 FROM public.courier_settlement_discrepancies d
                        WHERE d.shipment_id = e.shipment_id AND d.status <> 'resolved'))
       AND (
         _search IS NULL
         OR coalesce(o.order_number,'') ILIKE _like
         OR coalesce(o.customer_name,'') ILIKE _like
         OR coalesce(o.customer_phone,'') ILIKE _like
         OR coalesce(s.shipment_number,'') ILIKE _like
         OR coalesce(s.tracking_number,'') ILIKE _like
         OR coalesce(e.reason,'') ILIKE _like
         OR coalesce(e.courier_reason,'') ILIKE _like
       )
  ),
  pg AS (SELECT id, rn FROM m WHERE rn > _offset AND rn <= _offset + _page_size),
  pgrows AS (
    SELECT jsonb_agg(jsonb_build_object(
             'id', e.id,
             'exception_type', e.exception_type,
             'status', e.status,
             'reason', e.reason,
             'courier_reason', e.courier_reason,
             'resolution_note', e.resolution_note,
             'collected_amount', e.collected_amount,
             'source', e.source,
             'occurred_at', e.occurred_at,
             'resolved_at', e.resolved_at,
             'order_id', e.order_id,
             'order_number', o.order_number,
             'customer_name', o.customer_name,
             'customer_phone', o.customer_phone,
             'store_id', o.store_id,
             'store_name', st.name,
             'shipment_id', e.shipment_id,
             'shipment_number', s.shipment_number,
             'shipment_status', s.status,
             'tracking_number', s.tracking_number,
             'provider_name', cp.name,
             'account_name', ca.name,
             'assigned_to', oa.assigned_to,
             'assigned_name', p.full_name,
             'assigned_at', oa.assigned_at,
             'assigned_is_mine', oa.assigned_to IS NOT NULL AND oa.assigned_to = auth.uid(),
             'open_discrepancies', coalesce(disc.open_discrepancies, 0),
             'age_hours', round(extract(epoch FROM now() - e.occurred_at) / 3600.0)::int
           ) ORDER BY pg.rn) AS j
      FROM pg
      JOIN public.shipment_exceptions e ON e.id = pg.id
      LEFT JOIN public.shipments s ON s.id = e.shipment_id
      LEFT JOIN public.orders o ON o.id = e.order_id
      LEFT JOIN public.stores st ON st.id = o.store_id
      LEFT JOIN public.courier_providers cp ON cp.id = s.provider_id
      LEFT JOIN public.courier_accounts ca ON ca.id = s.courier_account_id
      LEFT JOIN public.operational_assignments oa
        ON oa.source_type = 'shipment_exception' AND oa.source_id = e.id AND oa.released_at IS NULL
      LEFT JOIN public.profiles p ON p.id = oa.assigned_to
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS open_discrepancies
          FROM public.courier_settlement_discrepancies d
         WHERE d.shipment_id = e.shipment_id AND d.status <> 'resolved'
      ) disc ON true
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

-- Exception quick view --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exception_quick_view(_exception_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _e public.shipment_exceptions;
  _s public.shipments;
  _o public.orders;
  _result jsonb;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read delivery exceptions';
  END IF;
  SELECT * INTO _e FROM public.shipment_exceptions WHERE id = _exception_id;
  IF _e.id IS NULL THEN RAISE EXCEPTION 'Exception not found'; END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _e.shipment_id;
  SELECT * INTO _o FROM public.orders WHERE id = _e.order_id;

  SELECT jsonb_build_object(
    'exception', jsonb_build_object(
      'id', _e.id, 'exception_type', _e.exception_type, 'status', _e.status,
      'reason', _e.reason, 'courier_reason', _e.courier_reason,
      'notes', _e.notes, 'resolution_note', _e.resolution_note,
      'collected_amount', _e.collected_amount, 'source', _e.source,
      'provider_event', _e.provider_event,
      'occurred_at', _e.occurred_at, 'resolved_at', _e.resolved_at,
      'created_at', _e.created_at, 'updated_at', _e.updated_at),
    'shipment', CASE WHEN _s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', _s.id, 'shipment_number', _s.shipment_number, 'status', _s.status,
      'tracking_number', _s.tracking_number,
      'external_consignment_id', _s.external_consignment_id,
      'provider_name', (SELECT name FROM public.courier_providers WHERE id = _s.provider_id),
      'account_name', (SELECT name FROM public.courier_accounts WHERE id = _s.courier_account_id),
      'expected_cod', _s.cash_on_delivery_amount,
      'collected_amount', _s.collected_amount) END,
    'order', CASE WHEN _o.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', _o.id, 'order_number', _o.order_number, 'status', _o.status,
      'customer_name', _o.customer_name, 'customer_phone', _o.customer_phone,
      'grand_total', _o.grand_total, 'due_amount', _o.due_amount) END,
    'assignment', (
      SELECT jsonb_build_object(
               'assigned_to', oa.assigned_to,
               'assigned_name', p.full_name,
               'assigned_at', oa.assigned_at,
               'note', oa.note,
               'assigned_is_mine', oa.assigned_to = auth.uid())
        FROM public.operational_assignments oa
        LEFT JOIN public.profiles p ON p.id = oa.assigned_to
       WHERE oa.source_type = 'shipment_exception' AND oa.source_id = _e.id
         AND oa.released_at IS NULL
       ORDER BY oa.assigned_at DESC LIMIT 1),
    'assignment_events', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', ev.id, 'event_type', ev.event_type, 'assigned_to', ev.assigned_to,
               'actor_id', ev.actor_id, 'note', ev.note, 'created_at', ev.created_at)
             ORDER BY ev.created_at DESC)
        FROM public.operational_assignment_events ev
       WHERE ev.source_type = 'shipment_exception' AND ev.source_id = _e.id), '[]'::jsonb),
    'delivery_outcome', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'product_name', oi.product_name, 'variant_name', oi.variant_name,
               'sku', oi.sku, 'quantity', si.quantity,
               'delivered_quantity', si.delivered_quantity,
               'refused_quantity', si.refused_quantity,
               'lost_quantity', si.lost_quantity,
               'damaged_quantity', si.damaged_quantity)
             ORDER BY oi.sort_order)
        FROM public.shipment_items si
        LEFT JOIN public.order_items oi ON oi.id = si.order_item_id
       WHERE si.shipment_id = _e.shipment_id), '[]'::jsonb),
    'returns', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'return_number', r.return_number,
               'status', r.status, 'return_type', r.return_type)
             ORDER BY r.requested_at DESC)
        FROM public.order_returns r WHERE r.order_id = _e.order_id), '[]'::jsonb),
    'discrepancies', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', d.id, 'status', d.status,
               'discrepancy_type', d.discrepancy_type,
               'difference_amount', d.difference_amount,
               'created_at', d.created_at)
             ORDER BY d.created_at DESC)
        FROM public.courier_settlement_discrepancies d
       WHERE d.shipment_id = _e.shipment_id), '[]'::jsonb),
    'events', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', se.id, 'event_type', se.event_type, 'message', se.message,
               'from_status', se.from_status, 'to_status', se.to_status,
               'created_at', se.created_at)
             ORDER BY se.created_at DESC)
        FROM (SELECT * FROM public.shipment_events
               WHERE shipment_id = _e.shipment_id
               ORDER BY created_at DESC LIMIT 20) se), '[]'::jsonb),
    'can_manage', public.can_manage_commerce(auth.uid())
  ) INTO _result;

  RETURN _result;
END; $function$;

REVOKE ALL ON FUNCTION public.shipments_console_list(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shipment_quick_view(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bulk_assign_shipment_courier(uuid[], uuid, courier_service_type, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exceptions_console_list(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exception_quick_view(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.shipments_console_list(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shipment_quick_view(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_assign_shipment_courier(uuid[], uuid, courier_service_type, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exceptions_console_list(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exception_quick_view(uuid) TO authenticated;