-- ============ ENUMS ============
CREATE TYPE public.shipment_status AS ENUM (
  'draft','ready_for_booking','booking_requested','booked','pickup_requested','picked_up',
  'in_transit','out_for_delivery','delivery_on_hold','delivered','delivery_failed',
  'return_requested','return_in_transit','return_received','lost','cancelled'
);

CREATE TYPE public.shipment_event_type AS ENUM (
  'shipment_created','ready_for_booking','booking_requested','booking_confirmed',
  'pickup_requested','shipment_picked_up','status_updated','delivery_on_hold',
  'delivery_failed','shipment_delivered','return_requested','return_started',
  'return_received','shipment_lost','shipment_cancelled','courier_assigned'
);

CREATE TYPE public.courier_provider_status AS ENUM ('active','inactive','disabled');

CREATE TYPE public.courier_service_type AS ENUM ('standard','express','same_day','next_day','other');

CREATE TYPE public.shipment_hold_reason AS ENUM (
  'customer_requested_delay','address_issue','rider_issue','weather','operational_issue','other'
);

CREATE TYPE public.shipment_failure_reason AS ENUM (
  'customer_unreachable','customer_refused','address_not_found','delivery_attempt_failed',
  'area_unserviceable','customer_requested_cancel','other'
);

-- ============ COURIER PROVIDERS ============
CREATE TABLE public.courier_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  status public.courier_provider_status NOT NULL DEFAULT 'inactive',
  description text,
  supports_cod boolean NOT NULL DEFAULT true,
  supports_return boolean NOT NULL DEFAULT true,
  supports_tracking boolean NOT NULL DEFAULT true,
  supports_pickup boolean NOT NULL DEFAULT true,
  service_types public.courier_service_type[] NOT NULL DEFAULT ARRAY['standard']::public.courier_service_type[],
  -- shape of the future integration configuration; never credentials
  config_schema jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.courier_providers TO authenticated;
GRANT ALL ON public.courier_providers TO service_role;
ALTER TABLE public.courier_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers can view providers" ON public.courier_providers
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
CREATE POLICY "Admins manage providers insert" ON public.courier_providers
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins manage providers update" ON public.courier_providers
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins manage providers delete" ON public.courier_providers
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
CREATE TRIGGER courier_providers_updated_at BEFORE UPDATE ON public.courier_providers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ SHIPMENT NUMBER ============
CREATE SEQUENCE public.shipment_number_seq;
CREATE OR REPLACE FUNCTION public.next_shipment_number()
RETURNS text LANGUAGE sql SET search_path TO 'public' AS $$
  SELECT 'SHP-' || to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.shipment_number_seq')::text, 6, '0');
$$;

-- ============ SHIPMENTS ============
CREATE TABLE public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  -- a shipment normally originates from one fulfillment; an order may have many
  -- shipments and a fulfillment may be split into several packages.
  fulfillment_id uuid REFERENCES public.order_fulfillments(id) ON DELETE RESTRICT,
  shipment_number text NOT NULL UNIQUE,
  status public.shipment_status NOT NULL DEFAULT 'draft',
  provider_id uuid REFERENCES public.courier_providers(id) ON DELETE RESTRICT,
  service_type public.courier_service_type,
  tracking_number text,
  external_consignment_id text,
  provider_reference text,
  -- delivery address snapshot, frozen at shipment creation
  recipient_name text NOT NULL,
  recipient_phone text NOT NULL,
  delivery_address text NOT NULL,
  delivery_area text,
  delivery_city text,
  delivery_zone text,
  postal_code text,
  cash_on_delivery_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (cash_on_delivery_amount >= 0),
  declared_value numeric(12,2) CHECK (declared_value IS NULL OR declared_value >= 0),
  weight numeric(10,3) CHECK (weight IS NULL OR weight >= 0),
  package_count integer NOT NULL DEFAULT 1 CHECK (package_count >= 1),
  hold_reason public.shipment_hold_reason,
  failure_reason public.shipment_failure_reason,
  notes text,
  internal_notes text,
  booked_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipments_order_idx ON public.shipments(order_id);
CREATE INDEX shipments_fulfillment_idx ON public.shipments(fulfillment_id);
CREATE INDEX shipments_status_idx ON public.shipments(status);
CREATE INDEX shipments_provider_idx ON public.shipments(provider_id);
CREATE INDEX shipments_tracking_idx ON public.shipments(tracking_number);
CREATE INDEX shipments_created_idx ON public.shipments(created_at DESC);

GRANT SELECT ON public.shipments TO authenticated;
GRANT ALL ON public.shipments TO service_role;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers can view shipments" ON public.shipments
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));
-- no insert/update/delete policy: every write goes through the workflow functions

-- ============ SHIPMENT ITEMS ============
CREATE TABLE public.shipment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
  fulfillment_item_id uuid REFERENCES public.order_fulfillment_items(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, order_item_id)
);
CREATE INDEX shipment_items_shipment_idx ON public.shipment_items(shipment_id);
CREATE INDEX shipment_items_order_item_idx ON public.shipment_items(order_item_id);
GRANT SELECT ON public.shipment_items TO authenticated;
GRANT ALL ON public.shipment_items TO service_role;
ALTER TABLE public.shipment_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers can view shipment items" ON public.shipment_items
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));

-- ============ SHIPMENT EVENTS (append only) ============
CREATE TABLE public.shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  event_type public.shipment_event_type NOT NULL,
  from_status public.shipment_status,
  to_status public.shipment_status,
  message text NOT NULL,
  metadata jsonb,
  provider_event_id text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipment_events_shipment_idx ON public.shipment_events(shipment_id, created_at);
CREATE INDEX shipment_events_order_idx ON public.shipment_events(order_id, created_at);
GRANT SELECT ON public.shipment_events TO authenticated;
GRANT ALL ON public.shipment_events TO service_role;
ALTER TABLE public.shipment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Commerce readers can view shipment events" ON public.shipment_events
  FOR SELECT TO authenticated USING (public.can_read_commerce(auth.uid()));

-- ============ WRITE GUARD ============
CREATE OR REPLACE FUNCTION public.guard_shipment_write()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('app.shipment_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Shipment records can only be changed through the shipping workflow functions.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER shipments_guard BEFORE INSERT OR UPDATE OR DELETE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.guard_shipment_write();
CREATE TRIGGER shipment_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.shipment_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_shipment_write();
CREATE TRIGGER shipment_events_guard BEFORE INSERT OR UPDATE OR DELETE ON public.shipment_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_shipment_write();
-- events are append-only even for the workflow functions
CREATE OR REPLACE FUNCTION public.guard_shipment_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'Shipment history is append-only. Record a new event instead.';
END; $$;
CREATE TRIGGER shipment_events_append_only BEFORE UPDATE OR DELETE ON public.shipment_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_shipment_events_append_only();

CREATE TRIGGER shipments_updated_at BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ TRANSITIONS ============
CREATE OR REPLACE FUNCTION public.shipment_transition_valid(_from public.shipment_status, _to public.shipment_status)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _from
    WHEN 'draft' THEN _to IN ('ready_for_booking','cancelled')
    WHEN 'ready_for_booking' THEN _to IN ('booking_requested','draft','cancelled')
    WHEN 'booking_requested' THEN _to IN ('booked','ready_for_booking','cancelled')
    WHEN 'booked' THEN _to IN ('pickup_requested','picked_up','cancelled')
    WHEN 'pickup_requested' THEN _to IN ('picked_up','booked','cancelled')
    WHEN 'picked_up' THEN _to IN ('in_transit','lost')
    WHEN 'in_transit' THEN _to IN ('out_for_delivery','delivery_on_hold','return_requested','lost')
    WHEN 'out_for_delivery' THEN _to IN ('delivered','delivery_on_hold','delivery_failed','return_requested','lost')
    WHEN 'delivery_on_hold' THEN _to IN ('out_for_delivery','delivery_failed','return_requested','lost')
    WHEN 'delivery_failed' THEN _to IN ('out_for_delivery','return_requested','lost')
    WHEN 'return_requested' THEN _to IN ('return_in_transit','lost')
    WHEN 'return_in_transit' THEN _to IN ('return_received','lost')
    ELSE false  -- delivered / return_received / lost / cancelled are terminal
  END;
$$;

CREATE OR REPLACE FUNCTION public.log_shipment_event(
  _shipment_id uuid, _order_id uuid, _event public.shipment_event_type,
  _from public.shipment_status, _to public.shipment_status, _message text,
  _metadata jsonb DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM set_config('app.shipment_write', 'on', true);
  INSERT INTO public.shipment_events
    (shipment_id, order_id, event_type, from_status, to_status, message, metadata, created_by)
  VALUES (_shipment_id, _order_id, _event, _from, _to, _message, _metadata, auth.uid());
  PERFORM set_config('app.shipment_write', 'off', true);
END; $$;

-- ============ SHIPPABLE QUANTITIES ============
-- ordered / fulfilled(packed or picked) / already shipped / shippable, per order item of a fulfillment
CREATE OR REPLACE FUNCTION public.fulfillment_shippable_summary(_fulfillment_id uuid)
RETURNS TABLE(
  fulfillment_item_id uuid, order_item_id uuid, product_name text, variant_name text,
  sku text, planned integer, fulfilled integer, shipped integer, shippable integer
) LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT fi.id, fi.order_item_id, oi.product_name, oi.variant_name, oi.sku,
         fi.quantity,
         greatest(coalesce(nullif(fi.packed_quantity,0), fi.picked_quantity), 0)::int,
         coalesce(s.qty, 0)::int,
         greatest(greatest(coalesce(nullif(fi.packed_quantity,0), fi.picked_quantity),0)::int - coalesce(s.qty,0)::int, 0)
    FROM public.order_fulfillment_items fi
    JOIN public.order_items oi ON oi.id = fi.order_item_id
    LEFT JOIN (
      SELECT si.fulfillment_item_id, sum(si.quantity)::int AS qty
        FROM public.shipment_items si
        JOIN public.shipments sh ON sh.id = si.shipment_id
       WHERE sh.status <> 'cancelled'
       GROUP BY si.fulfillment_item_id
    ) s ON s.fulfillment_item_id = fi.id
   WHERE fi.fulfillment_id = _fulfillment_id
   ORDER BY oi.sort_order;
$$;

-- ============ CREATE SHIPMENT ============
CREATE OR REPLACE FUNCTION public.create_shipment(
  _fulfillment_id uuid,
  _items jsonb DEFAULT NULL,
  _provider_id uuid DEFAULT NULL,
  _service_type public.courier_service_type DEFAULT NULL,
  _cash_on_delivery_amount numeric DEFAULT NULL,
  _declared_value numeric DEFAULT NULL,
  _weight numeric DEFAULT NULL,
  _package_count integer DEFAULT 1,
  _notes text DEFAULT NULL,
  _internal_notes text DEFAULT NULL
) RETURNS public.shipments LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _f public.order_fulfillments;
  _order public.orders;
  _addr public.order_addresses;
  _s public.shipments;
  _line jsonb;
  _fi_id uuid;
  _qty integer;
  _shippable integer;
  _oi_id uuid;
  _count integer := 0;
  _cod numeric;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to create shipments';
  END IF;

  SELECT * INTO _f FROM public.order_fulfillments WHERE id = _fulfillment_id FOR UPDATE;
  IF _f.id IS NULL THEN RAISE EXCEPTION 'Fulfillment not found'; END IF;
  IF _f.status <> 'ready_for_handover' THEN
    RAISE EXCEPTION 'Only a fulfillment that is ready for handover can be shipped (current: %)', _f.status;
  END IF;

  SELECT * INTO _order FROM public.orders WHERE id = _f.order_id FOR UPDATE;
  IF _order.status = 'cancelled' THEN RAISE EXCEPTION 'Cancelled orders cannot be shipped'; END IF;

  SELECT * INTO _addr FROM public.order_addresses
   WHERE order_id = _order.id ORDER BY created_at LIMIT 1;
  IF _addr.id IS NULL THEN RAISE EXCEPTION 'The order has no delivery address'; END IF;

  IF _provider_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.courier_providers WHERE id = _provider_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Courier provider is missing or not active';
  END IF;

  IF coalesce(_package_count, 1) < 1 THEN RAISE EXCEPTION 'Package count must be at least 1'; END IF;
  IF _weight IS NOT NULL AND _weight < 0 THEN RAISE EXCEPTION 'Weight cannot be negative'; END IF;
  IF _declared_value IS NOT NULL AND _declared_value < 0 THEN RAISE EXCEPTION 'Declared value cannot be negative'; END IF;

  -- COD expectation: explicit value, else the order due amount for cash-on-delivery orders
  _cod := coalesce(_cash_on_delivery_amount,
            CASE WHEN _order.payment_method = 'cod' THEN greatest(coalesce(_order.due_amount,0),0) ELSE 0 END);
  IF _cod < 0 THEN RAISE EXCEPTION 'Cash on delivery amount cannot be negative'; END IF;

  PERFORM set_config('app.shipment_write', 'on', true);

  INSERT INTO public.shipments (
    order_id, fulfillment_id, shipment_number, status, provider_id, service_type,
    recipient_name, recipient_phone, delivery_address, delivery_area, delivery_city,
    delivery_zone, postal_code, cash_on_delivery_amount, declared_value, weight,
    package_count, notes, internal_notes, created_by, updated_by
  ) VALUES (
    _order.id, _f.id, public.next_shipment_number(), 'draft', _provider_id, _service_type,
    _addr.recipient_name, _addr.phone, _addr.address_line, _addr.area, _addr.district,
    _addr.division, _addr.postal_code, _cod, _declared_value, _weight,
    coalesce(_package_count, 1), nullif(btrim(coalesce(_notes,'')),''),
    nullif(btrim(coalesce(_internal_notes,'')),''), auth.uid(), auth.uid()
  ) RETURNING * INTO _s;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    -- default: everything of this fulfillment that has not been shipped yet
    FOR _fi_id, _oi_id, _qty IN
      SELECT fulfillment_item_id, order_item_id, shippable
        FROM public.fulfillment_shippable_summary(_f.id) WHERE shippable > 0
    LOOP
      INSERT INTO public.shipment_items (shipment_id, order_item_id, fulfillment_item_id, quantity)
      VALUES (_s.id, _oi_id, _fi_id, _qty);
      _count := _count + 1;
    END LOOP;
  ELSE
    FOR _line IN SELECT * FROM jsonb_array_elements(_items) LOOP
      _fi_id := (_line->>'fulfillment_item_id')::uuid;
      _qty := coalesce((_line->>'quantity')::int, 0);
      IF _qty <= 0 THEN CONTINUE; END IF;

      SELECT order_item_id, shippable INTO _oi_id, _shippable
        FROM public.fulfillment_shippable_summary(_f.id)
       WHERE fulfillment_item_id = _fi_id;
      IF _oi_id IS NULL THEN
        RAISE EXCEPTION 'Item % does not belong to this fulfillment', _fi_id;
      END IF;
      IF _qty > _shippable THEN
        RAISE EXCEPTION 'Quantity % exceeds the shippable quantity % for this item', _qty, _shippable;
      END IF;

      INSERT INTO public.shipment_items (shipment_id, order_item_id, fulfillment_item_id, quantity)
      VALUES (_s.id, _oi_id, _fi_id, _qty);
      _count := _count + 1;
    END LOOP;
  END IF;

  PERFORM set_config('app.shipment_write', 'off', true);

  IF _count = 0 THEN
    RAISE EXCEPTION 'Nothing is left to ship for this fulfillment';
  END IF;

  PERFORM public.log_shipment_event(_s.id, _order.id, 'shipment_created', NULL, 'draft',
    'Shipment ' || _s.shipment_number || ' created from fulfillment #' || _f.fulfillment_number
      || ' with ' || _count || ' item line(s).',
    jsonb_build_object('fulfillment_id', _f.id, 'line_count', _count));

  INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
  VALUES (_order.id, 'Shipment ' || _s.shipment_number || ' created.', 'system', true, auth.uid());

  RETURN _s;
END; $$;

-- ============ COURIER ASSIGNMENT ============
CREATE OR REPLACE FUNCTION public.assign_shipment_courier(
  _shipment_id uuid, _provider_id uuid, _service_type public.courier_service_type DEFAULT NULL
) RETURNS public.shipments LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s public.shipments; _p public.courier_providers;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to assign couriers';
  END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  IF _s.status NOT IN ('draft','ready_for_booking','booking_requested') THEN
    RAISE EXCEPTION 'The courier can no longer be changed once booking is confirmed (current: %)', _s.status;
  END IF;
  SELECT * INTO _p FROM public.courier_providers WHERE id = _provider_id;
  IF _p.id IS NULL OR _p.status <> 'active' THEN
    RAISE EXCEPTION 'Courier provider is missing or not active';
  END IF;

  PERFORM set_config('app.shipment_write', 'on', true);
  UPDATE public.shipments SET provider_id = _p.id, service_type = _service_type, updated_by = auth.uid()
   WHERE id = _s.id RETURNING * INTO _s;
  PERFORM set_config('app.shipment_write', 'off', true);

  PERFORM public.log_shipment_event(_s.id, _s.order_id, 'courier_assigned', _s.status, _s.status,
    'Courier assigned: ' || _p.name || coalesce(' (' || _service_type::text || ')', '') || '.',
    jsonb_build_object('provider_id', _p.id, 'service_type', _service_type));
  RETURN _s;
END; $$;

-- ============ SHIPMENT DETAILS (pre-booking operational data) ============
CREATE OR REPLACE FUNCTION public.update_shipment_details(
  _shipment_id uuid,
  _cash_on_delivery_amount numeric DEFAULT NULL,
  _declared_value numeric DEFAULT NULL,
  _weight numeric DEFAULT NULL,
  _package_count integer DEFAULT NULL,
  _notes text DEFAULT NULL,
  _internal_notes text DEFAULT NULL
) RETURNS public.shipments LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s public.shipments;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to update shipments';
  END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  IF _s.status IN ('delivered','return_received','lost','cancelled') THEN
    RAISE EXCEPTION 'This shipment is closed and cannot be edited';
  END IF;
  IF _cash_on_delivery_amount IS NOT NULL AND _cash_on_delivery_amount < 0 THEN
    RAISE EXCEPTION 'Cash on delivery amount cannot be negative'; END IF;
  IF _declared_value IS NOT NULL AND _declared_value < 0 THEN
    RAISE EXCEPTION 'Declared value cannot be negative'; END IF;
  IF _weight IS NOT NULL AND _weight < 0 THEN RAISE EXCEPTION 'Weight cannot be negative'; END IF;
  IF _package_count IS NOT NULL AND _package_count < 1 THEN
    RAISE EXCEPTION 'Package count must be at least 1'; END IF;

  PERFORM set_config('app.shipment_write', 'on', true);
  UPDATE public.shipments SET
    cash_on_delivery_amount = coalesce(_cash_on_delivery_amount, cash_on_delivery_amount),
    declared_value = coalesce(_declared_value, declared_value),
    weight = coalesce(_weight, weight),
    package_count = coalesce(_package_count, package_count),
    notes = coalesce(nullif(btrim(coalesce(_notes,'')),''), notes),
    internal_notes = coalesce(nullif(btrim(coalesce(_internal_notes,'')),''), internal_notes),
    updated_by = auth.uid()
   WHERE id = _s.id RETURNING * INTO _s;
  PERFORM set_config('app.shipment_write', 'off', true);

  PERFORM public.log_shipment_event(_s.id, _s.order_id, 'status_updated', _s.status, _s.status,
    'Shipment package and financial details updated.', NULL);
  RETURN _s;
END; $$;

-- ============ CONTROLLED STATE TRANSITIONS ============
CREATE OR REPLACE FUNCTION public.set_shipment_state(
  _shipment_id uuid,
  _action text,
  _reason text DEFAULT NULL,
  _hold_reason public.shipment_hold_reason DEFAULT NULL,
  _failure_reason public.shipment_failure_reason DEFAULT NULL,
  _tracking_number text DEFAULT NULL,
  _external_consignment_id text DEFAULT NULL
) RETURNS public.shipments LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _s public.shipments;
  _order public.orders;
  _from public.shipment_status;
  _next public.shipment_status;
  _event public.shipment_event_type;
  _msg text;
  _clean text := nullif(btrim(coalesce(_reason,'')), '');
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change shipment state';
  END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  SELECT * INTO _order FROM public.orders WHERE id = _s.order_id;
  _from := _s.status;

  IF _order.status = 'cancelled' AND _action <> 'cancel'
     AND _from IN ('draft','ready_for_booking','booking_requested','booked','pickup_requested') THEN
    RAISE EXCEPTION 'The order is cancelled. This shipment can only be cancelled.';
  END IF;

  CASE _action
    WHEN 'mark_ready_for_booking' THEN
      IF _s.provider_id IS NULL THEN
        RAISE EXCEPTION 'Assign a courier provider before marking the shipment ready for booking';
      END IF;
      _next := 'ready_for_booking'; _event := 'ready_for_booking';
      _msg := 'Shipment is ready for courier booking.';
    WHEN 'request_booking' THEN
      _next := 'booking_requested'; _event := 'booking_requested';
      _msg := 'Booking requested with the courier (internal operational action).';
    WHEN 'revert_booking_request' THEN
      _next := 'ready_for_booking'; _event := 'status_updated';
      _msg := 'Booking request withdrawn' || coalesce(' — ' || _clean, '') || '.';
    WHEN 'confirm_booking' THEN
      _next := 'booked'; _event := 'booking_confirmed';
      _msg := 'Courier booking confirmed (recorded manually)'
        || coalesce(' — tracking ' || nullif(btrim(coalesce(_tracking_number,'')),''), '') || '.';
    WHEN 'request_pickup' THEN
      _next := 'pickup_requested'; _event := 'pickup_requested'; _msg := 'Courier pickup requested.';
    WHEN 'mark_picked_up' THEN
      _next := 'picked_up'; _event := 'shipment_picked_up'; _msg := 'Courier collected the package.';
    WHEN 'mark_in_transit' THEN
      _next := 'in_transit'; _event := 'status_updated'; _msg := 'Package is in transit.';
    WHEN 'mark_out_for_delivery' THEN
      _next := 'out_for_delivery'; _event := 'status_updated'; _msg := 'Package is out for delivery.';
    WHEN 'hold_delivery' THEN
      IF _hold_reason IS NULL THEN RAISE EXCEPTION 'A hold reason is required'; END IF;
      _next := 'delivery_on_hold'; _event := 'delivery_on_hold';
      _msg := 'Delivery on hold — ' || _hold_reason::text || coalesce(' — ' || _clean, '') || '.';
    WHEN 'mark_delivered' THEN
      _next := 'delivered'; _event := 'shipment_delivered';
      _msg := 'Package delivered. No financial settlement was performed.';
    WHEN 'mark_delivery_failed' THEN
      IF _failure_reason IS NULL THEN RAISE EXCEPTION 'A delivery failure reason is required'; END IF;
      _next := 'delivery_failed'; _event := 'delivery_failed';
      _msg := 'Delivery failed — ' || _failure_reason::text || coalesce(' — ' || _clean, '') || '.';
    WHEN 'start_return' THEN
      IF _from = 'delivered' THEN RAISE EXCEPTION 'A delivered shipment needs the customer return workflow'; END IF;
      _next := 'return_requested'; _event := 'return_requested';
      _msg := 'Return to sender requested' || coalesce(' — ' || _clean, '') || '.';
    WHEN 'mark_return_in_transit' THEN
      _next := 'return_in_transit'; _event := 'return_started'; _msg := 'Return package is in transit.';
    WHEN 'mark_return_received' THEN
      _next := 'return_received'; _event := 'return_received';
      _msg := 'Returned package received. Inventory was not restocked.';
    WHEN 'mark_lost' THEN
      IF _clean IS NULL THEN RAISE EXCEPTION 'A reason is required to mark a shipment lost'; END IF;
      _next := 'lost'; _event := 'shipment_lost'; _msg := 'Shipment reported lost — ' || _clean;
    WHEN 'cancel' THEN
      IF _from IN ('picked_up','in_transit','out_for_delivery','delivery_on_hold','delivery_failed',
                   'return_requested','return_in_transit') THEN
        RAISE EXCEPTION 'The courier already collected this package. Use the return workflow instead of cancelling.';
      END IF;
      _next := 'cancelled'; _event := 'shipment_cancelled';
      _msg := 'Shipment cancelled' || coalesce(' — ' || _clean, '') || '.';
    ELSE
      RAISE EXCEPTION 'Unknown shipment action: %', _action;
  END CASE;

  IF NOT public.shipment_transition_valid(_from, _next) THEN
    RAISE EXCEPTION 'Transition from % to % is not allowed', _from, _next;
  END IF;

  PERFORM set_config('app.shipment_write', 'on', true);
  UPDATE public.shipments SET
    status = _next,
    updated_by = auth.uid(),
    tracking_number = coalesce(nullif(btrim(coalesce(_tracking_number,'')),''), tracking_number),
    external_consignment_id = coalesce(nullif(btrim(coalesce(_external_consignment_id,'')),''), external_consignment_id),
    hold_reason = CASE WHEN _next = 'delivery_on_hold' THEN _hold_reason ELSE NULL END,
    failure_reason = CASE WHEN _next = 'delivery_failed' THEN _failure_reason ELSE failure_reason END,
    booked_at = CASE WHEN _next = 'booked' AND booked_at IS NULL THEN now() ELSE booked_at END,
    picked_up_at = CASE WHEN _next = 'picked_up' AND picked_up_at IS NULL THEN now() ELSE picked_up_at END,
    delivered_at = CASE WHEN _next = 'delivered' THEN now() ELSE delivered_at END,
    cancelled_at = CASE WHEN _next = 'cancelled' THEN now() ELSE cancelled_at END
   WHERE id = _s.id RETURNING * INTO _s;
  PERFORM set_config('app.shipment_write', 'off', true);

  PERFORM public.log_shipment_event(_s.id, _s.order_id, _event, _from, _next, _msg, NULL);

  IF _next IN ('booked','picked_up','delivered','delivery_failed','return_received','lost','cancelled') THEN
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_s.order_id, 'Shipment ' || _s.shipment_number || ': ' || _msg, 'system', true, auth.uid());
  END IF;

  RETURN _s;
END; $$;

-- ============ ORDER CANCELLATION SYNC ============
CREATE OR REPLACE FUNCTION public.cancel_order(_order_id uuid, _reason text DEFAULT NULL::text, _force boolean DEFAULT false)
 RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _order public.orders; _from public.order_verification_status; _committed int;
        _f public.order_fulfillments; _s public.shipments;
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

  -- Shipments: cancel everything not yet collected by the courier; anything the
  -- courier already holds stays operational and is only annotated.
  FOR _s IN SELECT * FROM public.shipments
             WHERE order_id = _order_id
               AND status NOT IN ('delivered','return_received','lost','cancelled')
             FOR UPDATE LOOP
    IF _s.status IN ('draft','ready_for_booking','booking_requested','booked','pickup_requested') THEN
      PERFORM set_config('app.shipment_write', 'on', true);
      UPDATE public.shipments SET status = 'cancelled', cancelled_at = now(), updated_by = auth.uid()
       WHERE id = _s.id;
      PERFORM set_config('app.shipment_write', 'off', true);
      PERFORM public.log_shipment_event(_s.id, _order_id, 'shipment_cancelled', _s.status, 'cancelled',
        'Shipment cancelled because the order was cancelled'
          || coalesce(' — ' || nullif(btrim(coalesce(_reason,'')),''), '') || '.', NULL);
    ELSE
      PERFORM public.log_shipment_event(_s.id, _order_id, 'status_updated', _s.status, _s.status,
        'The order was cancelled while this shipment was already with the courier. It stays active and needs return handling.',
        jsonb_build_object('order_cancelled', true));
    END IF;
  END LOOP;

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