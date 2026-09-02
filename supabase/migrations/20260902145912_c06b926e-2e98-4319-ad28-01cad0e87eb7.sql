-- ============ ENUMS ============
CREATE TYPE public.shipment_exception_type AS ENUM (
  'delivery_failed','delivery_on_hold','pickup_failed','pickup_cancelled','address_issue',
  'customer_unavailable','customer_refused','damaged_in_transit','lost_in_transit',
  'partial_delivery','other'
);
CREATE TYPE public.shipment_exception_status AS ENUM ('open','under_review','resolved','dismissed');
CREATE TYPE public.order_return_type AS ENUM ('return_to_merchant','paid_return','customer_return','exchange_return','other');
CREATE TYPE public.order_return_status AS ENUM ('pending','in_transit','received','inspected','completed','cancelled','lost');
CREATE TYPE public.return_item_condition AS ENUM ('unknown','good','opened','damaged','missing','unusable');
CREATE TYPE public.return_event_type AS ENUM (
  'return_created','status_changed','items_received','inspection_recorded',
  'return_completed','return_cancelled','return_lost','provider_event','note_added'
);

-- ============ SHIPMENT EXCEPTIONS ============
CREATE TABLE public.shipment_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  exception_type public.shipment_exception_type NOT NULL,
  status public.shipment_exception_status NOT NULL DEFAULT 'open',
  reason text,
  courier_reason text,
  notes text,
  resolution_note text,
  collected_amount numeric(12,2),
  source text NOT NULL DEFAULT 'manual',
  provider_event text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  resolved_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX shipment_exceptions_active_uidx
  ON public.shipment_exceptions (shipment_id, exception_type)
  WHERE status IN ('open','under_review');
CREATE INDEX shipment_exceptions_order_idx ON public.shipment_exceptions (order_id);
CREATE INDEX shipment_exceptions_status_idx ON public.shipment_exceptions (status, occurred_at DESC);

GRANT SELECT ON public.shipment_exceptions TO authenticated;
GRANT ALL ON public.shipment_exceptions TO service_role;
ALTER TABLE public.shipment_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers can view exceptions" ON public.shipment_exceptions
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_exception_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('app.exception_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Delivery exceptions can only be changed through the exception workflow functions.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;
CREATE TRIGGER shipment_exceptions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.shipment_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.guard_exception_write();

-- ============ RETURNS ============
CREATE SEQUENCE public.return_number_seq;

CREATE OR REPLACE FUNCTION public.next_return_number()
RETURNS text LANGUAGE sql AS $$
  SELECT 'RET-' || to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.return_number_seq')::text, 6, '0');
$$;

CREATE TABLE public.order_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  return_number text NOT NULL UNIQUE,
  return_type public.order_return_type NOT NULL DEFAULT 'return_to_merchant',
  status public.order_return_status NOT NULL DEFAULT 'pending',
  reason text,
  courier_reason text,
  notes text,
  resolution_note text,
  tracking_reference text,
  source text NOT NULL DEFAULT 'manual',
  requested_at timestamptz NOT NULL DEFAULT now(),
  initiated_at timestamptz,
  received_at timestamptz,
  inspected_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One live return per shipment: duplicate courier events cannot open a second one.
CREATE UNIQUE INDEX order_returns_active_shipment_uidx
  ON public.order_returns (shipment_id)
  WHERE shipment_id IS NOT NULL AND status IN ('pending','in_transit','received','inspected');
CREATE INDEX order_returns_order_idx ON public.order_returns (order_id);
CREATE INDEX order_returns_status_idx ON public.order_returns (status, created_at DESC);

GRANT SELECT ON public.order_returns TO authenticated;
GRANT ALL ON public.order_returns TO service_role;
ALTER TABLE public.order_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers can view returns" ON public.order_returns
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));

CREATE TABLE public.order_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.order_returns(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  quantity_expected integer NOT NULL DEFAULT 0 CHECK (quantity_expected >= 0),
  quantity_received integer NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  quantity_accepted integer NOT NULL DEFAULT 0 CHECK (quantity_accepted >= 0),
  condition public.return_item_condition NOT NULL DEFAULT 'unknown',
  reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_return_items_received_within_expected CHECK (quantity_received <= quantity_expected),
  CONSTRAINT order_return_items_accepted_within_received CHECK (quantity_accepted <= quantity_received),
  CONSTRAINT order_return_items_unique UNIQUE (return_id, order_item_id)
);
CREATE INDEX order_return_items_return_idx ON public.order_return_items (return_id);

GRANT SELECT ON public.order_return_items TO authenticated;
GRANT ALL ON public.order_return_items TO service_role;
ALTER TABLE public.order_return_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers can view return items" ON public.order_return_items
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));

CREATE TABLE public.order_return_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.order_returns(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event_type public.return_event_type NOT NULL,
  from_status public.order_return_status,
  to_status public.order_return_status,
  message text NOT NULL,
  metadata jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_return_events_return_idx ON public.order_return_events (return_id, created_at DESC);

GRANT SELECT ON public.order_return_events TO authenticated;
GRANT ALL ON public.order_return_events TO service_role;
ALTER TABLE public.order_return_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers can view return history" ON public.order_return_events
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_return_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('app.return_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Returns can only be changed through the return workflow functions.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME <> 'order_return_events' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER order_returns_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_returns
  FOR EACH ROW EXECUTE FUNCTION public.guard_return_write();
CREATE TRIGGER order_return_items_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_return_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_return_write();

CREATE OR REPLACE FUNCTION public.guard_return_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Return history is append-only. Record a new event instead.';
END; $$;
CREATE TRIGGER order_return_events_insert_guard
  BEFORE INSERT ON public.order_return_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_return_write();
CREATE TRIGGER order_return_events_append_only
  BEFORE UPDATE OR DELETE ON public.order_return_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_return_events_append_only();

-- ============ HELPERS ============
CREATE OR REPLACE FUNCTION public.log_return_event(
  _return_id uuid, _order_id uuid, _event public.return_event_type,
  _from public.order_return_status, _to public.order_return_status,
  _message text, _metadata jsonb DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.return_write', 'on', true);
  INSERT INTO public.order_return_events
    (return_id, order_id, event_type, from_status, to_status, message, metadata, created_by)
  VALUES (_return_id, _order_id, _event, _from, _to, _message, _metadata, auth.uid());
  PERFORM set_config('app.return_write', 'off', true);
END; $$;
REVOKE EXECUTE ON FUNCTION public.log_return_event(uuid,uuid,public.return_event_type,public.order_return_status,public.order_return_status,text,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.return_transition_valid(
  _from public.order_return_status, _to public.order_return_status
) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _from
    WHEN 'pending'   THEN _to IN ('in_transit','received','cancelled','lost')
    WHEN 'in_transit' THEN _to IN ('received','lost')
    WHEN 'received'  THEN _to IN ('inspected')
    WHEN 'inspected' THEN _to IN ('completed')
    ELSE false
  END;
$$;

-- ============ EXCEPTION OPERATIONS ============
CREATE OR REPLACE FUNCTION public.create_shipment_exception(
  _shipment_id uuid,
  _exception_type public.shipment_exception_type,
  _reason text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _courier_reason text DEFAULT NULL,
  _collected_amount numeric DEFAULT NULL,
  _source text DEFAULT 'manual',
  _provider_event text DEFAULT NULL,
  _occurred_at timestamptz DEFAULT NULL
) RETURNS public.shipment_exceptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s public.shipments;
  _e public.shipment_exceptions;
  _at timestamptz := coalesce(_occurred_at, now());
BEGIN
  IF _source = 'manual' AND NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to raise delivery exceptions';
  END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;

  SELECT * INTO _e FROM public.shipment_exceptions
   WHERE shipment_id = _shipment_id AND exception_type = _exception_type
     AND status IN ('open','under_review')
   FOR UPDATE;

  PERFORM set_config('app.exception_write', 'on', true);
  IF _e.id IS NOT NULL THEN
    -- Same live incident: enrich it, never duplicate it.
    UPDATE public.shipment_exceptions SET
      courier_reason = coalesce(nullif(btrim(coalesce(_courier_reason,'')),''), courier_reason),
      collected_amount = coalesce(_collected_amount, collected_amount),
      provider_event = coalesce(_provider_event, provider_event),
      occurred_at = greatest(occurred_at, _at)
    WHERE id = _e.id RETURNING * INTO _e;
  ELSE
    INSERT INTO public.shipment_exceptions (
      shipment_id, order_id, exception_type, reason, courier_reason, notes,
      collected_amount, source, provider_event, occurred_at, created_by
    ) VALUES (
      _s.id, _s.order_id, _exception_type,
      nullif(btrim(coalesce(_reason,'')),''),
      nullif(btrim(coalesce(_courier_reason,'')),''),
      nullif(btrim(coalesce(_notes,'')),''),
      _collected_amount, coalesce(_source,'manual'), _provider_event, _at,
      auth.uid()
    ) RETURNING * INTO _e;
  END IF;
  PERFORM set_config('app.exception_write', 'off', true);
  RETURN _e;
END; $$;

CREATE OR REPLACE FUNCTION public.set_exception_state(
  _exception_id uuid, _action text, _note text DEFAULT NULL
) RETURNS public.shipment_exceptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e public.shipment_exceptions;
  _next public.shipment_exception_status;
  _clean text := nullif(btrim(coalesce(_note,'')),'');
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to handle delivery exceptions';
  END IF;
  SELECT * INTO _e FROM public.shipment_exceptions WHERE id = _exception_id FOR UPDATE;
  IF _e.id IS NULL THEN RAISE EXCEPTION 'Exception not found'; END IF;

  CASE _action
    WHEN 'start_review' THEN
      IF _e.status <> 'open' THEN RAISE EXCEPTION 'Only an open exception can move to review'; END IF;
      _next := 'under_review';
    WHEN 'resolve' THEN
      IF _e.status NOT IN ('open','under_review') THEN
        RAISE EXCEPTION 'Only an open or in-review exception can be resolved';
      END IF;
      IF _clean IS NULL THEN RAISE EXCEPTION 'A resolution note is required'; END IF;
      _next := 'resolved';
    WHEN 'dismiss' THEN
      IF _e.status NOT IN ('open','under_review') THEN
        RAISE EXCEPTION 'Only an open or in-review exception can be dismissed';
      END IF;
      IF _clean IS NULL THEN RAISE EXCEPTION 'A note is required when dismissing an exception'; END IF;
      _next := 'dismissed';
    ELSE RAISE EXCEPTION 'Unknown exception action: %', _action;
  END CASE;

  PERFORM set_config('app.exception_write', 'on', true);
  UPDATE public.shipment_exceptions SET
    status = _next,
    notes = CASE WHEN _next = 'under_review' AND _clean IS NOT NULL
                 THEN coalesce(notes || E'\n', '') || _clean ELSE notes END,
    resolution_note = CASE WHEN _next IN ('resolved','dismissed') THEN _clean ELSE resolution_note END,
    resolved_at = CASE WHEN _next IN ('resolved','dismissed') THEN now() ELSE resolved_at END,
    resolved_by = CASE WHEN _next IN ('resolved','dismissed') THEN auth.uid() ELSE resolved_by END
  WHERE id = _e.id RETURNING * INTO _e;
  PERFORM set_config('app.exception_write', 'off', true);

  PERFORM public.log_shipment_event(_e.shipment_id, _e.order_id, 'status_updated', NULL, NULL,
    'Delivery exception (' || _e.exception_type::text || ') → ' || _next::text
      || coalesce(' — ' || _clean, '') || '.',
    jsonb_build_object('exception_id', _e.id, 'exception_status', _next));
  RETURN _e;
END; $$;

-- ============ RETURN OPERATIONS ============
CREATE OR REPLACE FUNCTION public.create_order_return(
  _order_id uuid,
  _shipment_id uuid DEFAULT NULL,
  _return_type public.order_return_type DEFAULT 'return_to_merchant',
  _reason text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _tracking_reference text DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb,
  _courier_reason text DEFAULT NULL,
  _source text DEFAULT 'manual'
) RETURNS public.order_returns
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r public.order_returns;
  _order public.orders;
  _item jsonb;
  _oi public.order_items;
  _qty integer;
BEGIN
  IF _source = 'manual' AND NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to create returns';
  END IF;
  SELECT * INTO _order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF _shipment_id IS NOT NULL THEN
    SELECT * INTO _r FROM public.order_returns
     WHERE shipment_id = _shipment_id AND status IN ('pending','in_transit','received','inspected')
     FOR UPDATE;
    IF _r.id IS NOT NULL THEN
      RETURN _r;  -- idempotent: one live return per shipment
    END IF;
  END IF;

  PERFORM set_config('app.return_write', 'on', true);
  INSERT INTO public.order_returns (
    order_id, shipment_id, return_number, return_type, reason, courier_reason, notes,
    tracking_reference, source, created_by, updated_by
  ) VALUES (
    _order_id, _shipment_id, public.next_return_number(), _return_type,
    nullif(btrim(coalesce(_reason,'')),''),
    nullif(btrim(coalesce(_courier_reason,'')),''),
    nullif(btrim(coalesce(_notes,'')),''),
    nullif(btrim(coalesce(_tracking_reference,'')),''),
    coalesce(_source,'manual'), auth.uid(), auth.uid()
  ) RETURNING * INTO _r;

  FOR _item IN SELECT * FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
    SELECT * INTO _oi FROM public.order_items
     WHERE id = (_item->>'order_item_id')::uuid AND order_id = _order_id;
    IF _oi.id IS NULL THEN RAISE EXCEPTION 'Order item does not belong to this order'; END IF;
    _qty := coalesce((_item->>'quantity_expected')::int, 0);
    IF _qty < 0 THEN RAISE EXCEPTION 'Return quantity cannot be negative'; END IF;
    IF _qty > _oi.quantity THEN
      RAISE EXCEPTION 'Return quantity cannot exceed the ordered quantity (%).', _oi.quantity;
    END IF;
    IF _qty > 0 THEN
      INSERT INTO public.order_return_items (return_id, order_item_id, quantity_expected, reason)
      VALUES (_r.id, _oi.id, _qty, nullif(btrim(coalesce(_item->>'reason','')),''));
    END IF;
  END LOOP;
  PERFORM set_config('app.return_write', 'off', true);

  PERFORM public.log_return_event(_r.id, _order_id, 'return_created', NULL, 'pending',
    'Return ' || _r.return_number || ' created (' || _return_type::text || ')'
      || coalesce(' — ' || _r.reason, '') || '.',
    jsonb_build_object('source', coalesce(_source,'manual'), 'shipment_id', _shipment_id));

  IF _shipment_id IS NOT NULL THEN
    PERFORM public.log_shipment_event(_shipment_id, _order_id, 'return_created', NULL, NULL,
      'Return ' || _r.return_number || ' opened for this shipment.',
      jsonb_build_object('return_id', _r.id));
  END IF;
  RETURN _r;
END; $$;

CREATE OR REPLACE FUNCTION public.set_return_state(
  _return_id uuid, _action text, _reason text DEFAULT NULL
) RETURNS public.order_returns
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r public.order_returns;
  _from public.order_return_status;
  _next public.order_return_status;
  _event public.return_event_type := 'status_changed';
  _clean text := nullif(btrim(coalesce(_reason,'')),'');
  _pending integer;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change return state';
  END IF;
  SELECT * INTO _r FROM public.order_returns WHERE id = _return_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Return not found'; END IF;
  _from := _r.status;

  CASE _action
    WHEN 'mark_in_transit' THEN _next := 'in_transit';
    WHEN 'mark_received'   THEN _next := 'received';
    WHEN 'mark_inspected'  THEN _next := 'inspected';
    WHEN 'complete'        THEN _next := 'completed'; _event := 'return_completed';
    WHEN 'cancel'          THEN _next := 'cancelled'; _event := 'return_cancelled';
    WHEN 'mark_lost'       THEN _next := 'lost';      _event := 'return_lost';
    ELSE RAISE EXCEPTION 'Unknown return action: %', _action;
  END CASE;

  IF NOT public.return_transition_valid(_from, _next) THEN
    RAISE EXCEPTION 'A return cannot move from % to %', _from, _next;
  END IF;
  IF _next = 'lost' AND _clean IS NULL THEN
    RAISE EXCEPTION 'A reason is required when marking a return lost';
  END IF;
  IF _next = 'cancelled' AND _clean IS NULL THEN
    RAISE EXCEPTION 'A reason is required when cancelling a return';
  END IF;
  IF _next = 'inspected' THEN
    SELECT count(*) INTO _pending FROM public.order_return_items
     WHERE return_id = _r.id AND condition = 'unknown';
    IF _pending > 0 THEN
      RAISE EXCEPTION 'Record the condition of every returned line before finishing inspection';
    END IF;
  END IF;

  PERFORM set_config('app.return_write', 'on', true);
  UPDATE public.order_returns SET
    status = _next,
    initiated_at = CASE WHEN _next = 'in_transit' AND initiated_at IS NULL THEN now() ELSE initiated_at END,
    received_at  = CASE WHEN _next = 'received'  AND received_at  IS NULL THEN now() ELSE received_at END,
    inspected_at = CASE WHEN _next = 'inspected' AND inspected_at IS NULL THEN now() ELSE inspected_at END,
    completed_at = CASE WHEN _next = 'completed' THEN now() ELSE completed_at END,
    cancelled_at = CASE WHEN _next = 'cancelled' THEN now() ELSE cancelled_at END,
    resolution_note = CASE WHEN _next IN ('completed','cancelled','lost') THEN _clean ELSE resolution_note END,
    notes = CASE WHEN _next NOT IN ('completed','cancelled','lost') AND _clean IS NOT NULL
                 THEN coalesce(notes || E'\n','') || _clean ELSE notes END,
    updated_by = auth.uid()
  WHERE id = _r.id RETURNING * INTO _r;
  PERFORM set_config('app.return_write', 'off', true);

  PERFORM public.log_return_event(_r.id, _r.order_id, _event, _from, _next,
    'Return moved from ' || _from::text || ' to ' || _next::text || coalesce(' — ' || _clean, '') || '.',
    jsonb_build_object('action', _action));
  RETURN _r;
END; $$;

-- Physical receipt: record what actually arrived. Never assumes expected = received.
CREATE OR REPLACE FUNCTION public.record_return_receipt(
  _return_id uuid, _items jsonb, _note text DEFAULT NULL
) RETURNS public.order_returns
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r public.order_returns;
  _item jsonb;
  _ri public.order_return_items;
  _qty integer;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to receive returns';
  END IF;
  SELECT * INTO _r FROM public.order_returns WHERE id = _return_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Return not found'; END IF;
  IF _r.status NOT IN ('received','inspected') THEN
    RAISE EXCEPTION 'Mark the return received before recording arrived quantities';
  END IF;

  PERFORM set_config('app.return_write', 'on', true);
  FOR _item IN SELECT * FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
    SELECT * INTO _ri FROM public.order_return_items
     WHERE id = (_item->>'id')::uuid AND return_id = _r.id FOR UPDATE;
    IF _ri.id IS NULL THEN RAISE EXCEPTION 'Return line not found'; END IF;
    _qty := coalesce((_item->>'quantity_received')::int, _ri.quantity_received);
    IF _qty < 0 THEN RAISE EXCEPTION 'Received quantity cannot be negative'; END IF;
    IF _qty > _ri.quantity_expected THEN
      RAISE EXCEPTION 'Received quantity cannot exceed the expected quantity (%).', _ri.quantity_expected;
    END IF;
    UPDATE public.order_return_items SET
      quantity_received = _qty,
      quantity_accepted = least(quantity_accepted, _qty),
      notes = coalesce(nullif(btrim(coalesce(_item->>'notes','')),''), notes)
    WHERE id = _ri.id;
  END LOOP;
  PERFORM set_config('app.return_write', 'off', true);

  PERFORM public.log_return_event(_r.id, _r.order_id, 'items_received', _r.status, _r.status,
    'Physical receipt recorded' || coalesce(' — ' || nullif(btrim(coalesce(_note,'')),''), '') || '.',
    jsonb_build_object('items', _items));
  RETURN _r;
END; $$;

-- Inspection: condition + accepted quantities. No inventory movement happens here.
CREATE OR REPLACE FUNCTION public.inspect_return_items(
  _return_id uuid, _items jsonb, _note text DEFAULT NULL
) RETURNS public.order_returns
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r public.order_returns;
  _item jsonb;
  _ri public.order_return_items;
  _received integer;
  _accepted integer;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to inspect returns';
  END IF;
  SELECT * INTO _r FROM public.order_returns WHERE id = _return_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Return not found'; END IF;
  IF _r.status NOT IN ('received','inspected') THEN
    RAISE EXCEPTION 'A return can only be inspected after it has been received';
  END IF;

  PERFORM set_config('app.return_write', 'on', true);
  FOR _item IN SELECT * FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
    SELECT * INTO _ri FROM public.order_return_items
     WHERE id = (_item->>'id')::uuid AND return_id = _r.id FOR UPDATE;
    IF _ri.id IS NULL THEN RAISE EXCEPTION 'Return line not found'; END IF;
    _received := coalesce((_item->>'quantity_received')::int, _ri.quantity_received);
    _accepted := coalesce((_item->>'quantity_accepted')::int, _ri.quantity_accepted);
    IF _received < 0 OR _accepted < 0 THEN RAISE EXCEPTION 'Quantities cannot be negative'; END IF;
    IF _received > _ri.quantity_expected THEN
      RAISE EXCEPTION 'Received quantity cannot exceed the expected quantity (%).', _ri.quantity_expected;
    END IF;
    IF _accepted > _received THEN
      RAISE EXCEPTION 'Accepted quantity cannot exceed the received quantity (%).', _received;
    END IF;
    UPDATE public.order_return_items SET
      quantity_received = _received,
      quantity_accepted = _accepted,
      condition = coalesce((_item->>'condition')::public.return_item_condition, condition),
      notes = coalesce(nullif(btrim(coalesce(_item->>'notes','')),''), notes)
    WHERE id = _ri.id;
  END LOOP;
  PERFORM set_config('app.return_write', 'off', true);

  PERFORM public.log_return_event(_r.id, _r.order_id, 'inspection_recorded', _r.status, _r.status,
    'Inspection recorded' || coalesce(' — ' || nullif(btrim(coalesce(_note,'')),''), '')
      || '. No inventory was changed.',
    jsonb_build_object('items', _items));
  RETURN _r;
END; $$;

-- ============ COURIER → OPERATIONAL EFFECTS (provider-neutral) ============
CREATE OR REPLACE FUNCTION public.apply_courier_operational_effects(
  _shipment_id uuid,
  _event_type public.shipment_event_type,
  _provider_event text,
  _at timestamptz,
  _payload jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s public.shipments;
  _reason text;
  _amount numeric;
  _etype public.shipment_exception_type;
  _r public.order_returns;
  _target public.order_return_status;
  _rank_from int; _rank_to int;
BEGIN
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id;
  IF _s.id IS NULL THEN RETURN; END IF;

  _reason := nullif(btrim(coalesce(
    _payload->>'reason', _payload->>'delivery_failed_reason', _payload->>'failure_reason',
    _payload->>'remarks', _payload->>'note', _payload->>'status_message', '')), '');
  _amount := nullif(coalesce(
    _payload->>'collected_amount', _payload->>'amount_collected',
    _payload->>'collected_price', _payload->>'partial_delivery_amount'), '')::numeric;

  -- Normalized internal event types only. No provider strings are interpreted here.
  _etype := CASE _event_type
    WHEN 'delivery_failed'  THEN 'delivery_failed'::public.shipment_exception_type
    WHEN 'delivery_on_hold' THEN 'delivery_on_hold'::public.shipment_exception_type
    WHEN 'pickup_failed'    THEN 'pickup_failed'::public.shipment_exception_type
    WHEN 'partial_delivery' THEN 'partial_delivery'::public.shipment_exception_type
    ELSE NULL END;

  IF _etype IS NOT NULL THEN
    PERFORM public.create_shipment_exception(
      _s.id, _etype, NULL, NULL, _reason, _amount, 'courier', _provider_event, _at);
  END IF;

  _target := CASE _event_type
    WHEN 'return_created'   THEN 'pending'::public.order_return_status
    WHEN 'return_requested' THEN 'pending'::public.order_return_status
    WHEN 'return_started'   THEN 'in_transit'::public.order_return_status
    WHEN 'return_received'  THEN 'received'::public.order_return_status
    ELSE NULL END;

  IF _target IS NOT NULL THEN
    SELECT * INTO _r FROM public.order_returns
     WHERE shipment_id = _s.id AND status IN ('pending','in_transit','received','inspected')
     FOR UPDATE;
    IF _r.id IS NULL THEN
      _r := public.create_order_return(
        _s.order_id, _s.id, 'return_to_merchant',
        'Courier reported a return', NULL, _s.return_tracking_number,
        '[]'::jsonb, _reason, 'courier');
    END IF;

    _rank_from := CASE _r.status WHEN 'pending' THEN 1 WHEN 'in_transit' THEN 2
                                 WHEN 'received' THEN 3 WHEN 'inspected' THEN 4 ELSE 9 END;
    _rank_to := CASE _target WHEN 'pending' THEN 1 WHEN 'in_transit' THEN 2
                             WHEN 'received' THEN 3 ELSE 9 END;
    -- Out-of-order / stale courier events never move a return backwards.
    IF _rank_to > _rank_from AND public.return_transition_valid(_r.status, _target) THEN
      PERFORM set_config('app.return_write', 'on', true);
      UPDATE public.order_returns SET
        status = _target,
        courier_reason = coalesce(_reason, courier_reason),
        tracking_reference = coalesce(tracking_reference, _s.return_tracking_number),
        initiated_at = CASE WHEN _target = 'in_transit' AND initiated_at IS NULL THEN _at ELSE initiated_at END,
        received_at  = CASE WHEN _target = 'received'  AND received_at  IS NULL THEN _at ELSE received_at END
      WHERE id = _r.id;
      PERFORM set_config('app.return_write', 'off', true);
      PERFORM public.log_return_event(_r.id, _r.order_id, 'provider_event', _r.status, _target,
        'Courier reported "' || coalesce(_provider_event,'?') || '".',
        jsonb_build_object('provider_event', _provider_event, 'provider_event_at', _at));
    END IF;
  END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION public.apply_courier_operational_effects(uuid,public.shipment_event_type,text,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;

-- Hook the effects into the existing (already idempotent) ingest function.
CREATE OR REPLACE FUNCTION public.ingest_courier_event(
  _provider_code text,
  _provider_event text,
  _consignment_id text DEFAULT NULL::text,
  _merchant_order_id text DEFAULT NULL::text,
  _provider_event_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  _provider_event_id text DEFAULT NULL::text,
  _payload jsonb DEFAULT NULL::jsonb,
  _source text DEFAULT 'webhook'::text
) RETURNS public.courier_provider_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _p public.courier_providers;
  _s public.shipments;
  _map public.courier_status_map;
  _fp text;
  _row public.courier_provider_events;
  _status public.courier_event_processing_status;
  _note text;
  _from public.shipment_status;
  _at timestamptz := coalesce(_provider_event_at, now());
  _event public.shipment_event_type;
BEGIN
  SELECT * INTO _p FROM public.courier_providers WHERE code = _provider_code;

  _fp := coalesce(
    nullif(btrim(coalesce(_provider_event_id,'')),''),
    md5(coalesce(_provider_code,'?') || '|' || coalesce(_consignment_id, _merchant_order_id, '?')
        || '|' || coalesce(_provider_event,'?') || '|' || coalesce(_at::text,'?'))
  );
  _fp := coalesce(_provider_code,'?') || ':' || _fp;

  SELECT * INTO _row FROM public.courier_provider_events WHERE fingerprint = _fp;
  IF _row.id IS NOT NULL THEN
    RETURN _row;
  END IF;

  IF _consignment_id IS NOT NULL THEN
    SELECT * INTO _s FROM public.shipments
     WHERE external_consignment_id = _consignment_id
       AND (_p.id IS NULL OR provider_id = _p.id)
     FOR UPDATE;
  END IF;
  IF _s.id IS NULL AND _merchant_order_id IS NOT NULL THEN
    SELECT * INTO _s FROM public.shipments WHERE shipment_number = _merchant_order_id FOR UPDATE;
  END IF;

  IF _p.id IS NULL THEN
    _status := 'rejected'; _note := 'Unknown courier provider code';
  ELSIF _s.id IS NULL THEN
    _status := 'unmatched'; _note := 'No shipment matches this consignment or merchant order id';
  ELSE
    SELECT * INTO _map FROM public.courier_status_map
     WHERE provider_id = _p.id AND provider_event = _provider_event;

    _from := _s.status;
    IF _s.provider_status_at IS NOT NULL AND _at < _s.provider_status_at THEN
      _status := 'stale';
      _note := 'Event is older than the last courier update already applied';
    ELSIF _map.id IS NULL THEN
      _status := 'recorded'; _note := 'No status mapping for this courier event';
    ELSIF _map.shipment_status IS NULL OR _map.shipment_status = _from THEN
      _status := 'recorded'; _note := 'Courier reported no internal state change';
      PERFORM set_config('app.shipment_write', 'on', true);
      UPDATE public.shipments
         SET provider_status = _provider_event, provider_status_slug = _provider_event,
             provider_status_at = _at, last_synced_at = now()
       WHERE id = _s.id RETURNING * INTO _s;
      PERFORM set_config('app.shipment_write', 'off', true);
      PERFORM public.apply_courier_operational_effects(
        _s.id, coalesce(_map.event_type,'provider_event'), _provider_event, _at, _payload);
    ELSIF NOT public.shipment_transition_valid(_from, _map.shipment_status) THEN
      _status := 'rejected';
      _note := 'Courier event maps to ' || _map.shipment_status::text
               || ' which is not a valid transition from ' || _from::text;
      PERFORM public.log_shipment_event(_s.id, _s.order_id, 'provider_event', _from, _from,
        'Courier reported "' || _provider_event || '" — not applied because ' || _note || '.',
        jsonb_build_object('provider_event', _provider_event, 'source', _source));
    ELSE
      _status := 'applied';
      _event := coalesce(_map.event_type, 'provider_event');
      PERFORM set_config('app.shipment_write', 'on', true);
      UPDATE public.shipments SET
        status = _map.shipment_status,
        provider_status = _provider_event,
        provider_status_slug = _provider_event,
        provider_status_at = _at,
        last_synced_at = now(),
        picked_up_at = CASE WHEN _map.shipment_status = 'picked_up' AND picked_up_at IS NULL THEN _at ELSE picked_up_at END,
        delivered_at = CASE WHEN _map.shipment_status IN ('delivered','partial_delivered') THEN _at ELSE delivered_at END,
        cancelled_at = CASE WHEN _map.shipment_status = 'cancelled' THEN _at ELSE cancelled_at END
       WHERE id = _s.id RETURNING * INTO _s;
      PERFORM set_config('app.shipment_write', 'off', true);

      PERFORM public.log_shipment_event(_s.id, _s.order_id, _event, _from, _map.shipment_status,
        'Courier reported "' || _provider_event || '".',
        jsonb_build_object('provider_event', _provider_event, 'source', _source,
                           'provider_event_at', _at));

      PERFORM public.apply_courier_operational_effects(_s.id, _event, _provider_event, _at, _payload);
    END IF;
  END IF;

  INSERT INTO public.courier_provider_events (
    provider_id, account_id, shipment_id, source, fingerprint, provider_event, provider_status,
    consignment_id, merchant_order_id, provider_event_at, payload, processing_status, processing_note
  ) VALUES (
    _p.id, _s.courier_account_id, _s.id, coalesce(_source,'webhook'), _fp, _provider_event, _provider_event,
    _consignment_id, _merchant_order_id, _at, _payload, _status, _note
  ) RETURNING * INTO _row;

  RETURN _row;
END; $$;