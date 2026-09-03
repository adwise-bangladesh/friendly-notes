-- A. Authoritative verification claim eligibility -----------------------------

CREATE OR REPLACE FUNCTION public.verification_claim_block_reason(_order_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _o public.orders;
BEGIN
  SELECT * INTO _o FROM public.orders WHERE id = _order_id;
  IF _o.id IS NULL THEN RETURN 'Order not found.'; END IF;

  IF _o.status = 'cancelled' THEN
    RETURN 'Cancelled orders cannot be claimed for verification.';
  END IF;

  CASE _o.verification_status
    WHEN 'confirmed' THEN
      RETURN 'This order has already completed verification.';
    WHEN 'not_required' THEN
      RETURN 'This order does not require verification.';
    WHEN 'cancelled' THEN
      RETURN 'Verification was closed for this order.';
    WHEN 'failed' THEN
      RETURN 'Verification already failed for this order; reopen it before claiming.';
    ELSE
      NULL;
  END CASE;

  IF _o.delivery_status IN ('delivered','partially_delivered','returned','partially_returned') THEN
    RETURN 'This order has already reached a final delivery outcome.';
  END IF;

  RETURN NULL;
END; $function$;

REVOKE ALL ON FUNCTION public.verification_claim_block_reason(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.verification_claim_block_reason(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_verification_work(_order_id uuid, _note text DEFAULT NULL::text)
RETURNS operational_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _actor uuid := auth.uid(); _actor_role public.app_role;
  _existing public.operational_assignments; _row public.operational_assignments; _owner text;
  _block text;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT role INTO _actor_role FROM public.profiles WHERE id = _actor;
  IF _actor_role IS NULL OR _actor_role = 'viewer' THEN
    RAISE EXCEPTION 'Not authorized to claim verification work';
  END IF;
  PERFORM public.assert_operation_source_exists('order_verification', _order_id);

  -- Serialise competing claims on the order row itself.
  PERFORM 1 FROM public.orders WHERE id = _order_id FOR UPDATE;

  -- Eligibility is decided from the authoritative order lifecycle, so every
  -- caller (single, quick view, bulk, future) inherits the same rules.
  _block := public.verification_claim_block_reason(_order_id);
  IF _block IS NOT NULL THEN
    RAISE EXCEPTION '%', _block;
  END IF;

  SELECT * INTO _existing FROM public.operational_assignments
   WHERE source_type = 'order_verification' AND source_id = _order_id AND released_at IS NULL
   FOR UPDATE;

  IF _existing.id IS NOT NULL THEN
    IF _existing.assigned_to = _actor THEN RETURN _existing; END IF;
    SELECT coalesce(full_name, 'another operator') INTO _owner
      FROM public.profiles WHERE id = _existing.assigned_to;
    RAISE EXCEPTION 'This order is already being verified by %.', coalesce(_owner, 'another operator');
  END IF;

  PERFORM set_config('app.operations_assignment', 'on', true);
  INSERT INTO public.operational_assignments
    (source_type, source_id, assigned_to, assigned_by, note)
  VALUES ('order_verification', _order_id, _actor, _actor,
          nullif(btrim(coalesce(_note,'')), ''))
  RETURNING * INTO _row;

  INSERT INTO public.operational_assignment_events
    (assignment_id, source_type, source_id, event_type, assigned_to, actor_id, note)
  VALUES (_row.id, 'order_verification', _order_id, 'assigned', _actor, _actor,
          nullif(btrim(coalesce(_note,'')), ''));
  PERFORM set_config('app.operations_assignment', 'off', true);

  RETURN _row;
END; $function$;

-- L + I. Deterministic ordering and operational views --------------------------

CREATE OR REPLACE FUNCTION public.orders_console_list(_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _page int := greatest(1, coalesce((_payload->>'page')::int, 1));
  _page_size int := least(200, greatest(10, coalesce((_payload->>'page_size')::int, 50)));
  _sort text := coalesce(_payload->>'sort', 'newest');
  _search text := nullif(btrim(coalesce(_payload->>'search','')), '');
  _like text;
  _offset int;
  _result jsonb;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read orders';
  END IF;
  _like := '%' || coalesce(_search,'') || '%';
  _offset := (_page - 1) * _page_size;

  WITH m AS (
    SELECT o.id,
           count(*) OVER () AS total,
           row_number() OVER (
             ORDER BY
               CASE WHEN _sort = 'oldest' THEN o.created_at END ASC,
               CASE WHEN _sort = 'total_desc' THEN o.grand_total END DESC,
               CASE WHEN _sort = 'total_asc' THEN o.grand_total END ASC,
               CASE WHEN _sort = 'updated' THEN o.updated_at END DESC,
               CASE WHEN _sort = 'priority' THEN
                 CASE o.verification_priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                      WHEN 'normal' THEN 2 ELSE 3 END
               END ASC,
               o.created_at DESC,
               o.id DESC
           ) AS rn
      FROM public.orders o
      LEFT JOIN public.order_addresses a
        ON a.order_id = o.id AND a.address_type = 'shipping'
     WHERE (_payload->>'status' IS NULL OR o.status::text = _payload->>'status')
       AND (_payload->>'verification_status' IS NULL OR o.verification_status::text = _payload->>'verification_status')
       AND (_payload->>'fulfillment_status' IS NULL OR o.fulfillment_status::text = _payload->>'fulfillment_status')
       AND (_payload->>'delivery_status' IS NULL OR o.delivery_status::text = _payload->>'delivery_status')
       AND (_payload->>'payment_status' IS NULL OR o.payment_status::text = _payload->>'payment_status')
       AND (_payload->>'reservation_status' IS NULL OR o.reservation_status::text = _payload->>'reservation_status')
       AND (_payload->>'risk_level' IS NULL OR o.risk_level::text = _payload->>'risk_level')
       AND (_payload->>'verification_priority' IS NULL OR o.verification_priority::text = _payload->>'verification_priority')
       AND (_payload->>'source' IS NULL OR o.source::text = _payload->>'source')
       AND (_payload->>'store_id' IS NULL OR o.store_id = (_payload->>'store_id')::uuid)
       AND (_payload->>'customer_id' IS NULL OR o.customer_id = (_payload->>'customer_id')::uuid)
       AND (_payload->>'from' IS NULL OR o.created_at >= (_payload->>'from')::timestamptz)
       AND (_payload->>'to' IS NULL OR o.created_at <= (_payload->>'to')::timestamptz)
       AND (_payload->>'district' IS NULL OR a.district ILIKE '%' || (_payload->>'district') || '%')
       AND (_payload->>'area' IS NULL OR a.area ILIKE '%' || (_payload->>'area') || '%')
       AND (
         _search IS NULL
         OR o.order_number ILIKE _like
         OR o.customer_name ILIKE _like
         OR o.customer_phone ILIKE _like
         OR coalesce(o.customer_email,'') ILIKE _like
         OR coalesce(a.address_line,'') ILIKE _like
       )
       AND (
         _payload->>'product_search' IS NULL
         OR EXISTS (
           SELECT 1 FROM public.order_items i
            WHERE i.order_id = o.id
              AND (i.product_name ILIKE '%' || (_payload->>'product_search') || '%'
                OR coalesce(i.sku,'') ILIKE '%' || (_payload->>'product_search') || '%'
                OR coalesce(i.variant_name,'') ILIKE '%' || (_payload->>'product_search') || '%')
         )
       )
       AND (
         _payload->>'assigned_to' IS NULL
         OR CASE
              WHEN _payload->>'assigned_to' = 'unassigned' THEN NOT EXISTS (
                SELECT 1 FROM public.operational_assignments oa
                 WHERE oa.source_type = 'order_verification' AND oa.source_id = o.id
                   AND oa.released_at IS NULL)
              WHEN _payload->>'assigned_to' = 'me' THEN EXISTS (
                SELECT 1 FROM public.operational_assignments oa
                 WHERE oa.source_type = 'order_verification' AND oa.source_id = o.id
                   AND oa.released_at IS NULL AND oa.assigned_to = auth.uid())
              ELSE EXISTS (
                SELECT 1 FROM public.operational_assignments oa
                 WHERE oa.source_type = 'order_verification' AND oa.source_id = o.id
                   AND oa.released_at IS NULL AND oa.assigned_to = (_payload->>'assigned_to')::uuid)
            END
       )
       AND (
         coalesce((_payload->>'has_exception')::boolean, false) = false
         OR EXISTS (SELECT 1 FROM public.shipment_exceptions e
                     WHERE e.order_id = o.id AND e.status IN ('open','under_review'))
       )
       AND (
         coalesce((_payload->>'has_open_return')::boolean, false) = false
         OR EXISTS (SELECT 1 FROM public.order_returns r
                     WHERE r.order_id = o.id AND r.status NOT IN ('cancelled','completed'))
       )
       -- Orders that cleared verification and inventory and can move to the floor.
       AND (
         coalesce((_payload->>'ready_for_warehouse')::boolean, false) = false
         OR (
              o.status = 'created'
          AND o.verification_status IN ('confirmed','not_required')
          AND o.reservation_status = 'reserved'
          AND o.fulfillment_status IN ('not_started','ready')
          AND o.fulfillment_hold_reason IS NULL
          AND o.delivery_status = 'not_shipped'
         )
       )
       -- Orders whose shipping/delivery leg needs a human.
       AND (
         coalesce((_payload->>'shipping_attention')::boolean, false) = false
         OR o.delivery_status IN ('delivery_failed','on_hold','returned','partially_returned')
         OR o.fulfillment_hold_reason IS NOT NULL
         OR EXISTS (SELECT 1 FROM public.shipment_exceptions e
                     WHERE e.order_id = o.id AND e.status IN ('open','under_review'))
         OR EXISTS (SELECT 1 FROM public.shipments sh
                     WHERE sh.order_id = o.id
                       AND sh.status IN ('booking_failed','pickup_failed','delivery_failed',
                                         'delivery_on_hold','lost','return_requested',
                                         'return_in_transit','return_received'))
       )
       AND (
         coalesce((_payload->>'attention')::boolean, false) = false
         OR o.risk_level = 'high'
         OR o.verification_status IN ('failed','unreachable')
         OR o.delivery_status IN ('delivery_failed','on_hold','returned','partially_returned')
         OR o.fulfillment_hold_reason IS NOT NULL
         OR EXISTS (SELECT 1 FROM public.shipment_exceptions e
                     WHERE e.order_id = o.id AND e.status IN ('open','under_review'))
       )
  ),
  pg AS (
    SELECT id, rn FROM m WHERE rn > _offset AND rn <= _offset + _page_size
  ),
  pgrows AS (
    SELECT jsonb_agg(jsonb_build_object(
             'id', o.id,
             'order_number', o.order_number,
             'source', o.source,
             'status', o.status,
             'verification_status', o.verification_status,
             'verification_priority', o.verification_priority,
             'verification_attempt_count', o.verification_attempt_count,
             'risk_level', o.risk_level,
             'risk_reason', o.risk_reason,
             'fulfillment_status', o.fulfillment_status,
             'fulfillment_hold_reason', o.fulfillment_hold_reason,
             'reservation_status', o.reservation_status,
             'delivery_status', o.delivery_status,
             'payment_status', o.payment_status,
             'payment_method', o.payment_method,
             'grand_total', o.grand_total,
             'paid_amount', o.paid_amount,
             'due_amount', o.due_amount,
             'customer_id', o.customer_id,
             'customer_name', o.customer_name,
             'customer_phone', o.customer_phone,
             'created_at', o.created_at,
             'updated_at', o.updated_at,
             'store_id', o.store_id,
             'store_name', s.name,
             'area', a.area,
             'district', a.district,
             'item_lines', coalesce(items.item_lines, 0),
             'unit_count', coalesce(items.unit_count, 0),
             'first_item', items.first_item,
             'assigned_to', assign.assigned_to,
             'assigned_name', assign.assigned_name,
             'assigned_is_mine', assign.assigned_to IS NOT NULL AND assign.assigned_to = auth.uid(),
             'shipment_status', ship.shipment_status,
             'tracking_number', ship.tracking_number,
             'courier_name', ship.courier_name,
             'open_exceptions', coalesce(excep.open_exceptions, 0),
             'open_returns', coalesce(ret.open_returns, 0),
             'ready_for_warehouse', (
                    o.status = 'created'
                AND o.verification_status IN ('confirmed','not_required')
                AND o.reservation_status = 'reserved'
                AND o.fulfillment_status IN ('not_started','ready')
                AND o.fulfillment_hold_reason IS NULL
                AND o.delivery_status = 'not_shipped')
           ) ORDER BY pg.rn) AS j
      FROM pg
      JOIN public.orders o ON o.id = pg.id
      LEFT JOIN public.stores s ON s.id = o.store_id
      LEFT JOIN public.order_addresses a ON a.order_id = o.id AND a.address_type = 'shipping'
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS item_lines,
               coalesce(sum(i.quantity),0)::int AS unit_count,
               (array_agg(i.product_name ORDER BY i.sort_order))[1] AS first_item
          FROM public.order_items i WHERE i.order_id = o.id
      ) items ON true
      LEFT JOIN LATERAL (
        SELECT oa.assigned_to, p.full_name AS assigned_name
          FROM public.operational_assignments oa
          LEFT JOIN public.profiles p ON p.id = oa.assigned_to
         WHERE oa.source_type = 'order_verification' AND oa.source_id = o.id
           AND oa.released_at IS NULL
         ORDER BY oa.assigned_at DESC LIMIT 1
      ) assign ON true
      LEFT JOIN LATERAL (
        SELECT sh.status::text AS shipment_status, sh.tracking_number, cp.name AS courier_name
          FROM public.shipments sh
          LEFT JOIN public.courier_providers cp ON cp.id = sh.provider_id
         WHERE sh.order_id = o.id
         ORDER BY sh.created_at DESC LIMIT 1
      ) ship ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS open_exceptions FROM public.shipment_exceptions e
         WHERE e.order_id = o.id AND e.status IN ('open','under_review')
      ) excep ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS open_returns FROM public.order_returns r
         WHERE r.order_id = o.id AND r.status NOT IN ('cancelled','completed')
      ) ret ON true
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

-- D/E/F. Quick view completeness ----------------------------------------------

CREATE OR REPLACE FUNCTION public.order_quick_view(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _o public.orders; _result jsonb;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read orders';
  END IF;
  SELECT * INTO _o FROM public.orders WHERE id = _order_id;
  IF _o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;

  SELECT jsonb_build_object(
    'order', jsonb_build_object(
      'id', _o.id, 'order_number', _o.order_number, 'source', _o.source,
      'status', _o.status, 'verification_status', _o.verification_status,
      'verification_priority', _o.verification_priority,
      'verification_attempt_count', _o.verification_attempt_count,
      'risk_level', _o.risk_level, 'risk_reason', _o.risk_reason,
      'fulfillment_status', _o.fulfillment_status,
      'fulfillment_hold_reason', _o.fulfillment_hold_reason,
      'reservation_status', _o.reservation_status,
      'delivery_status', _o.delivery_status, 'payment_status', _o.payment_status,
      'payment_method', _o.payment_method,
      'subtotal', _o.subtotal, 'grand_total', _o.grand_total,
      'product_discount', _o.product_discount, 'order_discount', _o.order_discount,
      'shipping_charge', _o.shipping_charge,
      'paid_amount', _o.paid_amount, 'due_amount', _o.due_amount,
      'customer_id', _o.customer_id, 'customer_name', _o.customer_name,
      'customer_phone', _o.customer_phone, 'customer_email', _o.customer_email,
      'store_id', _o.store_id,
      'created_at', _o.created_at, 'updated_at', _o.updated_at,
      'store_name', (SELECT name FROM public.stores WHERE id = _o.store_id)
    ),
    'address', (SELECT to_jsonb(a) FROM public.order_addresses a
                 WHERE a.order_id = _order_id AND a.address_type = 'shipping' LIMIT 1),
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'product_id', i.product_id, 'variant_id', i.variant_id,
        'product_name', i.product_name, 'variant_name', i.variant_name, 'sku', i.sku,
        'quantity', i.quantity, 'unit_price', i.unit_price,
        'discount_amount', i.discount_amount, 'line_total', i.line_total
      ) ORDER BY i.sort_order)
      FROM public.order_items i WHERE i.order_id = _order_id), '[]'::jsonb),
    'assignment', (
      SELECT jsonb_build_object('assigned_to', oa.assigned_to,
                                'assigned_name', p.full_name,
                                'assigned_at', oa.assigned_at,
                                'is_mine', oa.assigned_to = auth.uid())
        FROM public.operational_assignments oa
        LEFT JOIN public.profiles p ON p.id = oa.assigned_to
       WHERE oa.source_type = 'order_verification' AND oa.source_id = _order_id
         AND oa.released_at IS NULL
       ORDER BY oa.assigned_at DESC LIMIT 1),
    'reservations', coalesce((
      SELECT jsonb_agg(jsonb_build_object('status', r.status, 'quantity', r.quantity))
        FROM public.inventory_reservations r
       WHERE r.order_id = _order_id AND r.status <> 'released'), '[]'::jsonb),
    'reservation_summary', (
      SELECT jsonb_build_object(
        'ordered_units', coalesce((SELECT sum(i.quantity) FROM public.order_items i
                                    WHERE i.order_id = _order_id), 0),
        'active_units', coalesce(sum(r.quantity) FILTER (WHERE r.status = 'active'), 0),
        'committed_units', coalesce(sum(r.quantity) FILTER (WHERE r.status = 'committed'), 0))
        FROM public.inventory_reservations r
       WHERE r.order_id = _order_id AND r.status <> 'released'),
    'fulfillments', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'status', f.status,
             'fulfillment_number', f.fulfillment_number, 'created_at', f.created_at,
             'hold_reason', f.hold_reason,
             'planned_units', coalesce(fi.planned, 0),
             'picked_units', coalesce(fi.picked, 0),
             'packed_units', coalesce(fi.packed, 0))
             ORDER BY f.created_at)
        FROM public.order_fulfillments f
        LEFT JOIN LATERAL (
          SELECT sum(x.quantity)::int AS planned,
                 sum(x.picked_quantity)::int AS picked,
                 sum(x.packed_quantity)::int AS packed
            FROM public.order_fulfillment_items x WHERE x.fulfillment_id = f.id
        ) fi ON true
       WHERE f.order_id = _order_id), '[]'::jsonb),
    'shipments', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', sh.id, 'shipment_number', sh.shipment_number,
             'status', sh.status, 'tracking_number', sh.tracking_number,
             'external_consignment_id', sh.external_consignment_id,
             'courier_name', cp.name,
             'service_type', sh.service_type,
             'cash_on_delivery_amount', sh.cash_on_delivery_amount,
             'collected_amount', sh.collected_amount,
             'hold_reason', sh.hold_reason,
             'failure_reason', sh.failure_reason,
             'created_at', sh.created_at) ORDER BY sh.created_at)
        FROM public.shipments sh LEFT JOIN public.courier_providers cp ON cp.id = sh.provider_id
       WHERE sh.order_id = _order_id), '[]'::jsonb),
    'returns', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'return_number', r.return_number,
             'status', r.status, 'return_type', r.return_type, 'created_at', r.created_at,
             'is_open', r.status NOT IN ('cancelled','completed'))
             ORDER BY r.created_at)
        FROM public.order_returns r WHERE r.order_id = _order_id), '[]'::jsonb),
    'exceptions', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', e.id, 'exception_type', e.exception_type,
             'status', e.status, 'description', e.description)
             ORDER BY e.created_at DESC)
        FROM public.shipment_exceptions e
       WHERE e.order_id = _order_id AND e.status IN ('open','under_review')), '[]'::jsonb),
    'recent_notes', coalesce((
      SELECT jsonb_agg(t.n) FROM (
        SELECT jsonb_build_object('id', nn.id, 'note', nn.note, 'note_type', nn.note_type,
               'created_at', nn.created_at) AS n
          FROM public.order_notes nn WHERE nn.order_id = _order_id
         ORDER BY nn.created_at DESC LIMIT 5) t), '[]'::jsonb),
    -- Same authoritative source the full order page uses.
    'customer_intelligence', public.order_customer_intelligence(_order_id),
    'edit_block_reason', public.order_edit_block_reason(_order_id),
    'verification_claim_block_reason', public.verification_claim_block_reason(_order_id),
    'can_manage', public.can_manage_commerce(auth.uid())
  ) INTO _result;

  RETURN _result;
END; $function$;
