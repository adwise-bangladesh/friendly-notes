CREATE OR REPLACE FUNCTION public.order_quick_view(_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
             'status', e.status,
             'description', coalesce(e.reason, e.courier_reason, e.notes))
             ORDER BY e.created_at DESC)
        FROM public.shipment_exceptions e
       WHERE e.order_id = _order_id AND e.status IN ('open','under_review')), '[]'::jsonb),
    'recent_notes', coalesce((
      SELECT jsonb_agg(t.n) FROM (
        SELECT jsonb_build_object('id', nn.id, 'note', nn.note, 'note_type', nn.note_type,
               'created_at', nn.created_at) AS n
          FROM public.order_notes nn WHERE nn.order_id = _order_id
         ORDER BY nn.created_at DESC LIMIT 5) t), '[]'::jsonb),
    'customer_intelligence', public.order_customer_intelligence(_order_id),
    'edit_block_reason', public.order_edit_block_reason(_order_id),
    'verification_claim_block_reason', public.verification_claim_block_reason(_order_id),
    'can_manage', public.can_manage_commerce(auth.uid())
  ) INTO _result;

  RETURN _result;
END; $function$;

REVOKE ALL ON FUNCTION public.order_quick_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_quick_view(uuid) TO authenticated, service_role;