-- ============ ENUMS ============
CREATE TYPE public.fulfillment_record_status AS ENUM (
  'unfulfilled','ready_to_pick','picking','picked','packing',
  'qc_pending','qc_failed','packed','ready_for_handover','on_hold','cancelled'
);

CREATE TYPE public.fulfillment_qc_status AS ENUM ('pending','passed','failed');

CREATE TYPE public.fulfillment_shortage_reason AS ENUM (
  'out_of_stock','damaged','missing','wrong_item','other'
);

CREATE TYPE public.fulfillment_event_type AS ENUM (
  'fulfillment_created','picking_started','item_picked','picking_completed',
  'packing_started','qc_started','qc_passed','qc_failed','packed',
  'ready_for_handover','put_on_hold','hold_released','fulfillment_cancelled'
);

-- ============ TABLES ============
CREATE TABLE public.order_fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  fulfillment_number integer NOT NULL,
  status public.fulfillment_record_status NOT NULL DEFAULT 'ready_to_pick',
  location_id uuid REFERENCES public.inventory_locations(id),
  hold_reason text,
  notes text,
  started_at timestamptz,
  picked_at timestamptz,
  packed_at timestamptz,
  ready_for_handover_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_fulfillments_number_positive CHECK (fulfillment_number > 0),
  CONSTRAINT order_fulfillments_unique_number UNIQUE (order_id, fulfillment_number)
);
CREATE INDEX idx_order_fulfillments_order ON public.order_fulfillments(order_id);
CREATE INDEX idx_order_fulfillments_status ON public.order_fulfillments(status);
CREATE INDEX idx_order_fulfillments_location ON public.order_fulfillments(location_id);

GRANT SELECT ON public.order_fulfillments TO authenticated;
GRANT ALL ON public.order_fulfillments TO service_role;
ALTER TABLE public.order_fulfillments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers can view fulfillments"
  ON public.order_fulfillments FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));

CREATE TABLE public.order_fulfillment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_id uuid NOT NULL REFERENCES public.order_fulfillments(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  quantity integer NOT NULL,
  picked_quantity integer NOT NULL DEFAULT 0,
  packed_quantity integer NOT NULL DEFAULT 0,
  shortage_reason public.fulfillment_shortage_reason,
  qc_status public.fulfillment_qc_status NOT NULL DEFAULT 'pending',
  qc_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fulfillment_items_qty_positive CHECK (quantity > 0),
  CONSTRAINT fulfillment_items_picked_range CHECK (picked_quantity >= 0 AND picked_quantity <= quantity),
  CONSTRAINT fulfillment_items_packed_range CHECK (packed_quantity >= 0 AND packed_quantity <= picked_quantity),
  CONSTRAINT fulfillment_items_unique_line UNIQUE (fulfillment_id, order_item_id)
);
CREATE INDEX idx_fulfillment_items_fulfillment ON public.order_fulfillment_items(fulfillment_id);
CREATE INDEX idx_fulfillment_items_order_item ON public.order_fulfillment_items(order_item_id);

GRANT SELECT ON public.order_fulfillment_items TO authenticated;
GRANT ALL ON public.order_fulfillment_items TO service_role;
ALTER TABLE public.order_fulfillment_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers can view fulfillment items"
  ON public.order_fulfillment_items FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));

CREATE TABLE public.order_fulfillment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_id uuid NOT NULL REFERENCES public.order_fulfillments(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event_type public.fulfillment_event_type NOT NULL,
  from_status public.fulfillment_record_status,
  to_status public.fulfillment_record_status,
  message text NOT NULL,
  metadata jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_fulfillment_events_fulfillment ON public.order_fulfillment_events(fulfillment_id, created_at);
CREATE INDEX idx_fulfillment_events_order ON public.order_fulfillment_events(order_id, created_at);

GRANT SELECT ON public.order_fulfillment_events TO authenticated;
GRANT ALL ON public.order_fulfillment_events TO service_role;
ALTER TABLE public.order_fulfillment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers can view fulfillment events"
  ON public.order_fulfillment_events FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));

CREATE TRIGGER set_order_fulfillments_updated_at
  BEFORE UPDATE ON public.order_fulfillments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_order_fulfillment_items_updated_at
  BEFORE UPDATE ON public.order_fulfillment_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ TRANSITION RULES ============
CREATE OR REPLACE FUNCTION public.fulfillment_transition_valid(
  _from public.fulfillment_record_status,
  _to public.fulfillment_record_status
) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (_from, _to) IN (
    ('unfulfilled','ready_to_pick'),
    ('ready_to_pick','picking'),
    ('picking','picked'),
    ('picked','packing'),
    ('packing','qc_pending'),
    ('qc_pending','packed'),
    ('qc_pending','qc_failed'),
    ('qc_failed','picking'),
    ('qc_failed','on_hold'),
    ('on_hold','ready_to_pick'),
    ('on_hold','picking'),
    ('packed','ready_for_handover'),
    ('ready_to_pick','on_hold'),
    ('picking','on_hold'),
    ('picked','on_hold'),
    ('packing','on_hold'),
    ('qc_pending','on_hold'),
    ('unfulfilled','cancelled'),
    ('ready_to_pick','cancelled'),
    ('picking','cancelled'),
    ('picked','cancelled'),
    ('packing','cancelled'),
    ('qc_pending','cancelled'),
    ('qc_failed','cancelled'),
    ('on_hold','cancelled')
  );
$$;

-- ============ REMAINING QUANTITY ============
CREATE OR REPLACE FUNCTION public.order_fulfillment_summary(_order_id uuid)
RETURNS TABLE (order_item_id uuid, ordered integer, fulfilled integer, remaining integer)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT oi.id,
         oi.quantity,
         coalesce(f.qty, 0)::int,
         (oi.quantity - coalesce(f.qty, 0))::int
    FROM public.order_items oi
    LEFT JOIN (
      SELECT fi.order_item_id, sum(fi.quantity)::int AS qty
        FROM public.order_fulfillment_items fi
        JOIN public.order_fulfillments f ON f.id = fi.fulfillment_id
       WHERE f.status <> 'cancelled'
       GROUP BY fi.order_item_id
    ) f ON f.order_item_id = oi.id
   WHERE oi.order_id = _order_id;
$$;

-- ============ DIRECT WRITE GUARDS ============
CREATE OR REPLACE FUNCTION public.guard_fulfillment_write()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('app.fulfillment_record_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Fulfillment records can only be changed through the fulfillment workflow functions.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER guard_order_fulfillments_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_fulfillments
  FOR EACH ROW EXECUTE FUNCTION public.guard_fulfillment_write();
CREATE TRIGGER guard_order_fulfillment_items_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_fulfillment_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_fulfillment_write();

CREATE OR REPLACE FUNCTION public.guard_fulfillment_events()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF coalesce(current_setting('app.fulfillment_record_write', true), '') <> 'on' THEN
      RAISE EXCEPTION 'Fulfillment events are written by the fulfillment workflow only.';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Fulfillment events are append-only history and cannot be modified or deleted.';
END; $$;

CREATE TRIGGER guard_order_fulfillment_events_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_fulfillment_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_fulfillment_events();

-- ============ INTERNAL EVENT HELPER ============
CREATE OR REPLACE FUNCTION public.log_fulfillment_event(
  _fulfillment_id uuid, _order_id uuid, _event public.fulfillment_event_type,
  _from public.fulfillment_record_status, _to public.fulfillment_record_status,
  _message text, _metadata jsonb DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM set_config('app.fulfillment_record_write', 'on', true);
  INSERT INTO public.order_fulfillment_events
    (fulfillment_id, order_id, event_type, from_status, to_status, message, metadata, created_by)
  VALUES (_fulfillment_id, _order_id, _event, _from, _to, _message, _metadata, auth.uid());
  PERFORM set_config('app.fulfillment_record_write', 'off', true);
END; $$;
REVOKE ALL ON FUNCTION public.log_fulfillment_event(uuid,uuid,public.fulfillment_event_type,public.fulfillment_record_status,public.fulfillment_record_status,text,jsonb) FROM public, anon, authenticated;

-- ============ CREATE FULFILLMENT ============
CREATE OR REPLACE FUNCTION public.create_order_fulfillment(
  _order_id uuid, _location_id uuid, _items jsonb, _notes text DEFAULT NULL
) RETURNS public.order_fulfillments
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _order public.orders;
  _f public.order_fulfillments;
  _number integer;
  _line jsonb;
  _item_id uuid;
  _qty integer;
  _remaining integer;
  _count integer := 0;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to create fulfillments';
  END IF;

  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _order.status = 'cancelled' THEN RAISE EXCEPTION 'Cancelled orders cannot be fulfilled'; END IF;
  IF _order.verification_status NOT IN ('confirmed','not_required') THEN
    RAISE EXCEPTION 'Order is not eligible for fulfillment. Verification must be confirmed (current: %)', _order.verification_status;
  END IF;

  IF _location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.inventory_locations WHERE id = _location_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Warehouse location is missing or not active';
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one item is required';
  END IF;

  SELECT coalesce(max(fulfillment_number), 0) + 1 INTO _number
    FROM public.order_fulfillments WHERE order_id = _order_id;

  PERFORM set_config('app.fulfillment_record_write', 'on', true);

  INSERT INTO public.order_fulfillments
    (order_id, fulfillment_number, status, location_id, notes, created_by, updated_by)
  VALUES (_order_id, _number, 'ready_to_pick', _location_id,
          nullif(btrim(coalesce(_notes,'')), ''), auth.uid(), auth.uid())
  RETURNING * INTO _f;

  FOR _line IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _item_id := (_line->>'order_item_id')::uuid;
    _qty := coalesce((_line->>'quantity')::int, 0);
    IF _qty <= 0 THEN CONTINUE; END IF;

    SELECT (oi.quantity - coalesce((
      SELECT sum(fi.quantity) FROM public.order_fulfillment_items fi
        JOIN public.order_fulfillments f2 ON f2.id = fi.fulfillment_id
       WHERE fi.order_item_id = oi.id AND f2.status <> 'cancelled' AND f2.id <> _f.id
    ), 0))::int
      INTO _remaining
      FROM public.order_items oi
     WHERE oi.id = _item_id AND oi.order_id = _order_id;

    IF _remaining IS NULL THEN
      RAISE EXCEPTION 'Order item % does not belong to this order', _item_id;
    END IF;
    IF _qty > _remaining THEN
      RAISE EXCEPTION 'Quantity % exceeds the remaining quantity % for this order item', _qty, _remaining;
    END IF;

    INSERT INTO public.order_fulfillment_items (fulfillment_id, order_item_id, quantity)
    VALUES (_f.id, _item_id, _qty);
    _count := _count + 1;
  END LOOP;

  PERFORM set_config('app.fulfillment_record_write', 'off', true);

  IF _count = 0 THEN RAISE EXCEPTION 'At least one item with a positive quantity is required'; END IF;

  PERFORM public.log_fulfillment_event(_f.id, _order_id, 'fulfillment_created', NULL, 'ready_to_pick',
    'Fulfillment #' || _number || ' created with ' || _count || ' item line(s).',
    jsonb_build_object('location_id', _location_id, 'line_count', _count));

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id, 'Fulfillment #' || _number || ' created.', 'system', true, auth.uid());

  RETURN _f;
END; $$;
REVOKE ALL ON FUNCTION public.create_order_fulfillment(uuid,uuid,jsonb,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_order_fulfillment(uuid,uuid,jsonb,text) TO authenticated;

-- ============ RECORD PICKS ============
CREATE OR REPLACE FUNCTION public.record_fulfillment_picks(_fulfillment_id uuid, _items jsonb)
RETURNS public.order_fulfillments
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _f public.order_fulfillments;
  _line jsonb;
  _item public.order_fulfillment_items;
  _qty integer;
  _reason public.fulfillment_shortage_reason;
  _touched integer := 0;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to record picking';
  END IF;
  SELECT * INTO _f FROM public.order_fulfillments WHERE id = _fulfillment_id FOR UPDATE;
  IF _f.id IS NULL THEN RAISE EXCEPTION 'Fulfillment not found'; END IF;
  IF _f.status <> 'picking' THEN
    RAISE EXCEPTION 'Picking can only be recorded while the fulfillment is picking (current: %)', _f.status;
  END IF;

  PERFORM set_config('app.fulfillment_record_write', 'on', true);
  FOR _line IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO _item FROM public.order_fulfillment_items
      WHERE id = (_line->>'item_id')::uuid AND fulfillment_id = _fulfillment_id FOR UPDATE;
    IF _item.id IS NULL THEN RAISE EXCEPTION 'Fulfillment item not found'; END IF;

    _qty := coalesce((_line->>'picked_quantity')::int, 0);
    IF _qty < 0 OR _qty > _item.quantity THEN
      RAISE EXCEPTION 'Picked quantity must be between 0 and the planned quantity %', _item.quantity;
    END IF;
    _reason := nullif(_line->>'shortage_reason','')::public.fulfillment_shortage_reason;
    IF _qty < _item.quantity AND _reason IS NULL THEN
      _reason := _item.shortage_reason;
    END IF;
    IF _qty = _item.quantity THEN _reason := NULL; END IF;

    UPDATE public.order_fulfillment_items
       SET picked_quantity = _qty, shortage_reason = _reason
     WHERE id = _item.id;
    _touched := _touched + 1;
  END LOOP;
  PERFORM set_config('app.fulfillment_record_write', 'off', true);

  PERFORM public.log_fulfillment_event(_f.id, _f.order_id, 'item_picked', _f.status, _f.status,
    'Picked quantities recorded for ' || _touched || ' item line(s).', _items);

  SELECT * INTO _f FROM public.order_fulfillments WHERE id = _fulfillment_id;
  RETURN _f;
END; $$;
REVOKE ALL ON FUNCTION public.record_fulfillment_picks(uuid,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_fulfillment_picks(uuid,jsonb) TO authenticated;

-- ============ ITEM QC ============
CREATE OR REPLACE FUNCTION public.set_fulfillment_item_qc(
  _item_id uuid, _qc_status public.fulfillment_qc_status, _note text DEFAULT NULL
) RETURNS public.order_fulfillments
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _f public.order_fulfillments; _item public.order_fulfillment_items; _clean text;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to record quality control';
  END IF;
  SELECT * INTO _item FROM public.order_fulfillment_items WHERE id = _item_id FOR UPDATE;
  IF _item.id IS NULL THEN RAISE EXCEPTION 'Fulfillment item not found'; END IF;
  SELECT * INTO _f FROM public.order_fulfillments WHERE id = _item.fulfillment_id FOR UPDATE;
  IF _f.status <> 'qc_pending' THEN
    RAISE EXCEPTION 'Quality control can only be recorded while the fulfillment is in QC (current: %)', _f.status;
  END IF;
  _clean := nullif(btrim(coalesce(_note,'')), '');
  IF _qc_status = 'failed' AND _clean IS NULL THEN
    RAISE EXCEPTION 'A reason is required when an item fails quality control';
  END IF;

  PERFORM set_config('app.fulfillment_record_write', 'on', true);
  UPDATE public.order_fulfillment_items SET qc_status = _qc_status, qc_note = _clean WHERE id = _item_id;
  PERFORM set_config('app.fulfillment_record_write', 'off', true);

  PERFORM public.log_fulfillment_event(_f.id, _f.order_id,
    CASE WHEN _qc_status = 'failed' THEN 'qc_failed'::public.fulfillment_event_type
         WHEN _qc_status = 'passed' THEN 'qc_passed'::public.fulfillment_event_type
         ELSE 'qc_started'::public.fulfillment_event_type END,
    _f.status, _f.status,
    'Item quality control set to ' || _qc_status || coalesce(' — ' || _clean, '') || '.',
    jsonb_build_object('fulfillment_item_id', _item_id));

  RETURN _f;
END; $$;
REVOKE ALL ON FUNCTION public.set_fulfillment_item_qc(uuid,public.fulfillment_qc_status,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_fulfillment_item_qc(uuid,public.fulfillment_qc_status,text) TO authenticated;

-- ============ STATE MACHINE ============
CREATE OR REPLACE FUNCTION public.set_fulfillment_state(
  _fulfillment_id uuid, _action text, _reason text DEFAULT NULL
) RETURNS public.order_fulfillments
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _f public.order_fulfillments;
  _order public.orders;
  _from public.fulfillment_record_status;
  _next public.fulfillment_record_status;
  _event public.fulfillment_event_type;
  _msg text;
  _clean text := nullif(btrim(coalesce(_reason,'')), '');
  _unresolved integer;
  _failed integer;
  _note text;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change fulfillment state';
  END IF;
  SELECT * INTO _f FROM public.order_fulfillments WHERE id = _fulfillment_id FOR UPDATE;
  IF _f.id IS NULL THEN RAISE EXCEPTION 'Fulfillment not found'; END IF;
  SELECT * INTO _order FROM public.orders WHERE id = _f.order_id;
  _from := _f.status;

  IF _order.status = 'cancelled' AND _action <> 'cancel' THEN
    RAISE EXCEPTION 'The order is cancelled. This fulfillment can only be cancelled.';
  END IF;

  CASE _action
    WHEN 'start_picking' THEN
      _next := 'picking'; _event := 'picking_started'; _msg := 'Picking started.';
    WHEN 'complete_picking' THEN
      SELECT count(*) INTO _unresolved FROM public.order_fulfillment_items
        WHERE fulfillment_id = _f.id AND picked_quantity < quantity AND shortage_reason IS NULL;
      IF _unresolved > 0 THEN
        RAISE EXCEPTION 'Picking cannot be completed: % item line(s) are short without an operational reason.', _unresolved;
      END IF;
      IF EXISTS (SELECT 1 FROM public.order_fulfillment_items WHERE fulfillment_id = _f.id AND picked_quantity = 0) THEN
        IF NOT EXISTS (SELECT 1 FROM public.order_fulfillment_items WHERE fulfillment_id = _f.id AND picked_quantity > 0) THEN
          RAISE EXCEPTION 'Nothing has been picked. Record picked quantities or put the fulfillment on hold.';
        END IF;
      END IF;
      _next := 'picked'; _event := 'picking_completed'; _msg := 'Picking completed.';
    WHEN 'start_packing' THEN
      _next := 'packing'; _event := 'packing_started'; _msg := 'Packing started.';
    WHEN 'send_to_qc' THEN
      _next := 'qc_pending'; _event := 'qc_started'; _msg := 'Sent to quality control.';
    WHEN 'pass_qc' THEN
      SELECT count(*) INTO _failed FROM public.order_fulfillment_items
        WHERE fulfillment_id = _f.id AND qc_status = 'failed';
      IF _failed > 0 THEN
        RAISE EXCEPTION 'Quality control cannot pass while % item line(s) are marked failed.', _failed;
      END IF;
      _next := 'packed'; _event := 'packed'; _msg := 'Quality control passed. Package is packed.';
    WHEN 'fail_qc' THEN
      IF _clean IS NULL THEN RAISE EXCEPTION 'A reason is required to fail quality control'; END IF;
      _next := 'qc_failed'; _event := 'qc_failed'; _msg := 'Quality control failed — ' || _clean;
    WHEN 'return_to_picking' THEN
      _next := 'picking'; _event := 'picking_started';
      _msg := 'Returned to picking' || coalesce(' — ' || _clean, '') || '.';
    WHEN 'hold' THEN
      IF _clean IS NULL THEN RAISE EXCEPTION 'A hold reason is required'; END IF;
      _next := 'on_hold'; _event := 'put_on_hold'; _msg := 'Put on hold — ' || _clean;
    WHEN 'release_hold' THEN
      _next := CASE WHEN EXISTS (
          SELECT 1 FROM public.order_fulfillment_items WHERE fulfillment_id = _f.id AND picked_quantity > 0
        ) THEN 'picking'::public.fulfillment_record_status
        ELSE 'ready_to_pick'::public.fulfillment_record_status END;
      _event := 'hold_released'; _msg := 'Hold released' || coalesce(' — ' || _clean, '') || '.';
    WHEN 'mark_ready_for_handover' THEN
      _next := 'ready_for_handover'; _event := 'ready_for_handover'; _msg := 'Ready for courier handover.';
    WHEN 'cancel' THEN
      IF _from = 'ready_for_handover' THEN
        RAISE EXCEPTION 'A fulfillment that is ready for handover cannot be cancelled here.';
      END IF;
      _next := 'cancelled'; _event := 'fulfillment_cancelled';
      _msg := 'Fulfillment cancelled' || coalesce(' — ' || _clean, '') || '.';
    ELSE
      RAISE EXCEPTION 'Unknown fulfillment action: %', _action;
  END CASE;

  IF NOT public.fulfillment_transition_valid(_from, _next) THEN
    RAISE EXCEPTION 'Transition from % to % is not allowed', _from, _next;
  END IF;

  PERFORM set_config('app.fulfillment_record_write', 'on', true);
  UPDATE public.order_fulfillments
     SET status = _next,
         updated_by = auth.uid(),
         hold_reason = CASE WHEN _next = 'on_hold' THEN _clean ELSE NULL END,
         started_at = CASE WHEN _next = 'picking' AND started_at IS NULL THEN now() ELSE started_at END,
         picked_at = CASE WHEN _next = 'picked' THEN now() ELSE picked_at END,
         packed_at = CASE WHEN _next = 'packed' THEN now() ELSE packed_at END,
         ready_for_handover_at = CASE WHEN _next = 'ready_for_handover' THEN now() ELSE ready_for_handover_at END,
         cancelled_at = CASE WHEN _next = 'cancelled' THEN now() ELSE cancelled_at END
   WHERE id = _f.id
   RETURNING * INTO _f;

  IF _next = 'packed' THEN
    UPDATE public.order_fulfillment_items
       SET packed_quantity = picked_quantity,
           qc_status = CASE WHEN qc_status = 'pending' THEN 'passed'::public.fulfillment_qc_status ELSE qc_status END
     WHERE fulfillment_id = _f.id;
  END IF;
  PERFORM set_config('app.fulfillment_record_write', 'off', true);

  PERFORM public.log_fulfillment_event(_f.id, _f.order_id, _event, _from, _next, _msg, NULL);

  IF _next IN ('on_hold','packed','ready_for_handover','cancelled','qc_failed') THEN
    _note := 'Fulfillment #' || _f.fulfillment_number || ': ' || _msg;
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_f.order_id, _note, 'system', true, auth.uid());
  END IF;

  RETURN _f;
END; $$;
REVOKE ALL ON FUNCTION public.set_fulfillment_state(uuid,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_fulfillment_state(uuid,text,text) TO authenticated;

-- ============ ORDER CANCELLATION SYNC ============
CREATE OR REPLACE FUNCTION public.cancel_order(_order_id uuid, _reason text DEFAULT NULL::text, _force boolean DEFAULT false)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _order public.orders; _from public.order_verification_status; _committed int; _f public.order_fulfillments;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to cancel orders';
  END IF;
  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _order.status = 'cancelled' THEN RAISE EXCEPTION 'Order is already cancelled'; END IF;
  _from := _order.verification_status;

  SELECT count(*) INTO _committed FROM public.inventory_reservations
   WHERE order_id = _order_id AND status = 'committed';

  IF _committed > 0 AND NOT _force THEN
    RAISE EXCEPTION 'Stock for this order is already committed (packed). Cancelling needs an administrative exception and a return/reversal to restore stock.';
  END IF;
  IF _committed > 0 AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin or owner can force-cancel an order whose stock is committed';
  END IF;

  IF EXISTS (SELECT 1 FROM public.order_fulfillments
              WHERE order_id = _order_id AND status = 'ready_for_handover') AND NOT _force THEN
    RAISE EXCEPTION 'A fulfillment is already ready for courier handover. Cancelling needs an administrative exception.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.inventory_reservations
              WHERE order_id = _order_id AND status = 'active') THEN
    PERFORM public.release_order_reservations(_order_id, 'Order cancelled');
    SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  END IF;

  -- Cancel every fulfillment that has not reached handover; history is preserved.
  FOR _f IN SELECT * FROM public.order_fulfillments
             WHERE order_id = _order_id AND status NOT IN ('cancelled','ready_for_handover')
             FOR UPDATE LOOP
    PERFORM set_config('app.fulfillment_record_write', 'on', true);
    UPDATE public.order_fulfillments
       SET status = 'cancelled', cancelled_at = now(), updated_by = auth.uid(), hold_reason = NULL
     WHERE id = _f.id;
    PERFORM set_config('app.fulfillment_record_write', 'off', true);
    PERFORM public.log_fulfillment_event(_f.id, _order_id, 'fulfillment_cancelled', _f.status, 'cancelled',
      'Fulfillment cancelled because the order was cancelled'
        || coalesce(' — ' || nullif(btrim(coalesce(_reason,'')),''), '') || '.', NULL);
  END LOOP;

  PERFORM set_config('app.order_write', 'on', true);
  PERFORM set_config('app.verification_write', 'on', true);
  UPDATE public.orders
     SET status = 'cancelled', cancelled_at = now(), updated_by = auth.uid(),
         verification_status = CASE
           WHEN _from IN ('confirmed','failed','cancelled') THEN _from
           ELSE 'cancelled'::public.order_verification_status END,
         verification_next_action_at = NULL
   WHERE id = _order_id RETURNING * INTO _order;

  IF _from NOT IN ('confirmed','failed','cancelled') THEN
    INSERT INTO public.order_verification_events
      (order_id, event_type, from_status, to_status, message, created_by)
    VALUES (_order_id, 'verification_cancelled', _from, 'cancelled',
            'Verification cancelled because the order was cancelled. Scheduled actions are no longer active.',
            auth.uid());
  END IF;
  PERFORM set_config('app.verification_write', 'off', true);
  PERFORM set_config('app.order_write', 'off', true);

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order_id,
    'Order cancelled' || coalesce(' — ' || nullif(btrim(coalesce(_reason,'')),''), '')
      || CASE WHEN _committed > 0 THEN ' (administrative exception — committed stock was NOT restored).' ELSE '.' END,
    'system', true, auth.uid());

  RETURN _order;
END; $function$;