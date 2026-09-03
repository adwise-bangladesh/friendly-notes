-- ============================================================
-- 20.8.3.10 — courier status mapping + statement numeric safety
-- ============================================================

-- 1) Normalised courier status key ---------------------------------------
CREATE OR REPLACE FUNCTION public.courier_status_key(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(btrim(regexp_replace(lower(coalesce(_value,'')), '[^a-z0-9]+', '-', 'g'), '-'), '');
$$;

CREATE INDEX IF NOT EXISTS courier_status_map_key_idx
  ON public.courier_status_map (provider_id, (public.courier_status_key(provider_event)));

-- 2) Provider mappings for Steadfast and RedX ----------------------------
-- Sourced from each adapter's implemented status field:
--   Steadfast: GET /status_by_cid/{id} -> delivery_status (documented enum)
--   RedX:      GET /parcel/track/{id}  -> message_en, slugified by the adapter
-- Nothing here is verified against a live credentialed provider response yet;
-- descriptions say so explicitly. Unknown values stay unmapped and are recorded
-- without touching shipment state, exactly as before.
INSERT INTO public.courier_status_map (provider_id, provider_event, shipment_status, event_type, description)
SELECT p.id, v.provider_event, v.shipment_status::public.shipment_status,
       v.event_type::public.shipment_event_type, v.description
  FROM public.courier_providers p
  JOIN (VALUES
    -- Steadfast delivery_status vocabulary
    ('steadfast','pending',                         NULL,               'status_updated',   'Consignment created, not yet collected (unverified against live API)'),
    ('steadfast','in_review',                       NULL,               'status_updated',   'Courier is reviewing the consignment (unverified against live API)'),
    ('steadfast','unknown',                         NULL,               'status_updated',   'Courier reported an unknown state (unverified against live API)'),
    ('steadfast','delivered_approval_pending',      NULL,               'status_updated',   'Delivery reported, awaiting courier approval (unverified against live API)'),
    ('steadfast','partial_delivered_approval_pending', NULL,            'status_updated',   'Partial delivery reported, awaiting courier approval (unverified against live API)'),
    ('steadfast','cancelled_approval_pending',      NULL,               'status_updated',   'Cancellation reported, awaiting courier approval (unverified against live API)'),
    ('steadfast','unknown_approval_pending',        NULL,               'status_updated',   'Unclassified outcome awaiting courier approval (unverified against live API)'),
    ('steadfast','picked_up',                       'picked_up',        'shipment_picked_up','Package collected by the courier (unverified against live API)'),
    ('steadfast','in_transit',                      'in_transit',       'status_updated',   'Moving between hubs (unverified against live API)'),
    ('steadfast','out_for_delivery',                'out_for_delivery', 'status_updated',   'Rider is delivering (unverified against live API)'),
    ('steadfast','hold',                            'delivery_on_hold', 'delivery_on_hold', 'Delivery paused by the courier (unverified against live API)'),
    ('steadfast','delivered',                       'delivered',        'shipment_delivered','Delivered in full (unverified against live API)'),
    ('steadfast','partial_delivered',               'partial_delivered','partial_delivery', 'Customer accepted part of the shipment (unverified against live API)'),
    ('steadfast','cancelled',                       'delivery_failed',  'delivery_failed',  'Courier cancelled the delivery attempt (unverified against live API)'),
    ('steadfast','returned',                        'return_in_transit','return_started',   'Return leg started (unverified against live API)'),
    ('steadfast','return_completed',                'return_received',  'return_received',  'Return received by the merchant (unverified against live API)'),
    -- RedX tracking vocabulary (adapter slugifies message_en)
    ('redx','pickup-pending',                       NULL,               'status_updated',   'Pickup not scheduled yet (unverified against live API)'),
    ('redx','pickup-assigned',                      'pickup_requested', 'pickup_requested', 'Pickup agent assigned (unverified against live API)'),
    ('redx','picked-up',                            'picked_up',        'shipment_picked_up','Parcel collected (unverified against live API)'),
    ('redx','pickup-failed',                        'pickup_failed',    'pickup_failed',    'Pickup attempt failed (unverified against live API)'),
    ('redx','received-at-sorting-hub',              'in_transit',       'status_updated',   'Received at sorting hub (unverified against live API)'),
    ('redx','in-transit',                           'in_transit',       'status_updated',   'Moving between hubs (unverified against live API)'),
    ('redx','agent-assigned',                       'out_for_delivery', 'status_updated',   'Delivery agent assigned (unverified against live API)'),
    ('redx','out-for-delivery',                     'out_for_delivery', 'status_updated',   'Out for delivery (unverified against live API)'),
    ('redx','delivered',                            'delivered',        'shipment_delivered','Delivered (unverified against live API)'),
    ('redx','delivery-failed',                      'delivery_failed',  'delivery_failed',  'Delivery attempt failed (unverified against live API)'),
    ('redx','hold',                                 'delivery_on_hold', 'delivery_on_hold', 'Delivery on hold (unverified against live API)'),
    ('redx','on-hold',                              'delivery_on_hold', 'delivery_on_hold', 'Delivery on hold (unverified against live API)'),
    ('redx','return-in-transit',                    'return_in_transit','return_started',   'Return moving to merchant (unverified against live API)'),
    ('redx','returned',                             'return_requested', 'return_requested', 'Return to sender started (unverified against live API)'),
    ('redx','returned-to-merchant',                 'return_received',  'return_received',  'Return received by merchant (unverified against live API)'),
    ('redx','parcel-delivery-cancelled-by-customer','delivery_failed',  'delivery_failed',  'Customer refused the parcel (unverified against live API)')
  ) AS v(code, provider_event, shipment_status, event_type, description)
    ON v.code = p.code
 WHERE NOT EXISTS (
   SELECT 1 FROM public.courier_status_map m
    WHERE m.provider_id = p.id
      AND public.courier_status_key(m.provider_event) = public.courier_status_key(v.provider_event));

-- 3) Case/punctuation-insensitive mapping lookup -------------------------
CREATE OR REPLACE FUNCTION public.courier_apply_event(_event_id uuid)
 RETURNS public.courier_provider_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row public.courier_provider_events;
  _p public.courier_providers;
  _s public.shipments;
  _map public.courier_status_map;
  _status public.courier_event_processing_status;
  _note text;
  _from public.shipment_status;
  _at timestamptz;
  _event public.shipment_event_type;
BEGIN
  SELECT * INTO _row FROM public.courier_provider_events WHERE id = _event_id FOR UPDATE;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Courier event not found';
  END IF;
  IF _row.processing_status = 'applied' THEN
    RETURN _row;
  END IF;

  _at := coalesce(_row.provider_event_at, _row.received_at, now());
  SELECT * INTO _p FROM public.courier_providers WHERE id = _row.provider_id;

  IF _row.consignment_id IS NOT NULL THEN
    SELECT * INTO _s FROM public.shipments
     WHERE external_consignment_id = _row.consignment_id
       AND (_p.id IS NULL OR provider_id = _p.id)
     FOR UPDATE;
  END IF;
  IF _s.id IS NULL AND _row.merchant_order_id IS NOT NULL THEN
    SELECT * INTO _s FROM public.shipments WHERE shipment_number = _row.merchant_order_id FOR UPDATE;
  END IF;

  IF _p.id IS NULL THEN
    _status := 'rejected'; _note := 'Unknown courier provider code';
  ELSIF _s.id IS NULL THEN
    _status := 'unmatched'; _note := 'No shipment matches this consignment or merchant order id';
  ELSE
    -- exact match first (unchanged behaviour), then normalised key
    SELECT * INTO _map FROM public.courier_status_map
     WHERE provider_id = _p.id AND provider_event = _row.provider_event;
    IF _map.id IS NULL THEN
      SELECT * INTO _map FROM public.courier_status_map
       WHERE provider_id = _p.id
         AND public.courier_status_key(provider_event) = public.courier_status_key(_row.provider_event)
       LIMIT 1;
    END IF;

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
         SET provider_status = _row.provider_event, provider_status_slug = _row.provider_event,
             provider_status_at = _at, last_synced_at = now()
       WHERE id = _s.id RETURNING * INTO _s;
      PERFORM set_config('app.shipment_write', 'off', true);
      PERFORM public.apply_courier_operational_effects(
        _s.id, coalesce(_map.event_type,'provider_event'), _row.provider_event, _at, _row.payload);
    ELSIF NOT public.shipment_transition_valid(_from, _map.shipment_status) THEN
      _status := 'rejected';
      _note := 'Courier event maps to ' || _map.shipment_status::text
               || ' which is not a valid transition from ' || _from::text;
      PERFORM public.log_shipment_event(_s.id, _s.order_id, 'provider_event', _from, _from,
        'Courier reported "' || _row.provider_event || '" — not applied because ' || _note || '.',
        jsonb_build_object('provider_event', _row.provider_event, 'source', _row.source));
    ELSE
      _status := 'applied';
      _event := coalesce(_map.event_type, 'provider_event');
      PERFORM set_config('app.shipment_write', 'on', true);
      UPDATE public.shipments SET
        status = _map.shipment_status,
        provider_status = _row.provider_event,
        provider_status_slug = _row.provider_event,
        provider_status_at = _at,
        last_synced_at = now(),
        picked_up_at = CASE WHEN _map.shipment_status = 'picked_up' AND picked_up_at IS NULL THEN _at ELSE picked_up_at END,
        delivered_at = CASE WHEN _map.shipment_status IN ('delivered','partial_delivered') THEN _at ELSE delivered_at END,
        cancelled_at = CASE WHEN _map.shipment_status = 'cancelled' THEN _at ELSE cancelled_at END
       WHERE id = _s.id RETURNING * INTO _s;
      PERFORM set_config('app.shipment_write', 'off', true);

      PERFORM public.log_shipment_event(_s.id, _s.order_id, _event, _from, _map.shipment_status,
        'Courier reported "' || _row.provider_event || '".',
        jsonb_build_object('provider_event', _row.provider_event, 'source', _row.source,
                           'provider_event_at', _at));

      PERFORM public.apply_courier_operational_effects(_s.id, _event, _row.provider_event, _at, _row.payload);
    END IF;
  END IF;

  UPDATE public.courier_provider_events SET
    shipment_id = coalesce(_s.id, shipment_id),
    account_id = coalesce(_s.courier_account_id, account_id),
    processing_status = _status,
    processing_note = _note,
    last_attempt_at = now(),
    next_retry_at = CASE WHEN _status = 'unmatched'
                         THEN now() + make_interval(mins => least(60, power(2, least(retry_count, 6))::int))
                         ELSE NULL END
  WHERE id = _row.id
  RETURNING * INTO _row;

  RETURN _row;
END; $function$;

REVOKE ALL ON FUNCTION public.courier_apply_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_apply_event(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.courier_status_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.courier_status_key(text) TO authenticated, service_role;

-- 4) Tolerant money parsing for statement rows ---------------------------
-- Returns (ok, value). Blank/absent -> ok with NULL value. Anything that is not
-- a readable amount -> ok = false, so the caller can classify the ROW as invalid
-- instead of aborting the whole import batch.
CREATE OR REPLACE FUNCTION public.parse_statement_amount(_raw text, OUT ok boolean, OUT value numeric)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE _t text;
BEGIN
  _t := btrim(coalesce(_raw, ''));
  -- strip currency symbols, spaces and thousand separators
  _t := regexp_replace(_t, '[৳$£€,\s]', '', 'g');
  _t := regexp_replace(_t, '^\((.*)\)$', '-\1');       -- (120.00) => -120.00
  IF _t = '' THEN ok := true; value := NULL; RETURN; END IF;
  IF _t !~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN ok := false; value := NULL; RETURN; END IF;
  BEGIN
    value := _t::numeric; ok := true;
  EXCEPTION WHEN others THEN
    ok := false; value := NULL;
  END;
END; $$;

REVOKE ALL ON FUNCTION public.parse_statement_amount(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parse_statement_amount(text) TO authenticated, service_role;

-- 5) Row-independent statement staging -----------------------------------
CREATE OR REPLACE FUNCTION public.stage_courier_statement_rows(_import_id uuid, _rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _imp public.courier_statement_imports; _r jsonb; _i int := 0;
        _cons text; _ref text; _fp text; _sid uuid; _n int; _status text; _note text;
        _item uuid; _item_status text; _matched int := 0; _unmatched int := 0;
        _amb int := 0; _dup int := 0; _inv int := 0; _conf int := 0;
        _collected numeric; _delivery numeric; _codfee numeric; _retchg numeric;
        _other numeric; _net numeric; _bad text[]; _f text; _res record;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to import courier statements';
  END IF;
  SELECT * INTO _imp FROM public.courier_statement_imports WHERE id = _import_id FOR UPDATE;
  IF _imp.id IS NULL THEN RAISE EXCEPTION 'Statement import not found'; END IF;
  IF _imp.status = 'confirmed' THEN RAISE EXCEPTION 'This statement was already confirmed'; END IF;
  IF jsonb_typeof(_rows) <> 'array' THEN RAISE EXCEPTION 'Statement rows must be a list'; END IF;
  IF jsonb_array_length(_rows) > 2000 THEN
    RAISE EXCEPTION 'Import at most 2000 statement rows at a time';
  END IF;

  PERFORM set_config('app.financial_write', 'on', true);
  DELETE FROM public.courier_statement_rows
   WHERE import_id = _import_id AND applied_at IS NULL;

  FOR _r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    _i := _i + 1;
    _cons := nullif(btrim(coalesce(_r->>'consignment_id','')),'');
    _ref := nullif(btrim(coalesce(_r->>'merchant_order_reference','')),'');
    _sid := NULL; _item := NULL; _note := NULL; _item_status := NULL;
    _bad := ARRAY[]::text[];
    _collected := NULL; _delivery := NULL; _codfee := NULL;
    _retchg := NULL; _other := NULL; _net := NULL;

    -- Parse every amount independently; a bad value only spoils its own row.
    FOREACH _f IN ARRAY ARRAY['collected_amount','delivery_fee','cod_fee','return_charge','other_charge','net_amount'] LOOP
      SELECT * INTO _res FROM public.parse_statement_amount(_r->>_f);
      IF NOT _res.ok THEN
        _bad := array_append(_bad, _f || ' = "' || btrim(coalesce(_r->>_f,'')) || '"');
      ELSE
        CASE _f
          WHEN 'collected_amount' THEN _collected := _res.value;
          WHEN 'delivery_fee'     THEN _delivery  := _res.value;
          WHEN 'cod_fee'          THEN _codfee    := _res.value;
          WHEN 'return_charge'    THEN _retchg    := _res.value;
          WHEN 'other_charge'     THEN _other     := _res.value;
          ELSE                         _net       := _res.value;
        END CASE;
      END IF;
    END LOOP;

    _fp := md5(coalesce(_cons,'') || '|' || coalesce(_ref,'') || '|' ||
               coalesce(_r->>'collected_amount','') || '|' || coalesce(_r->>'net_amount',''));

    IF array_length(_bad, 1) IS NOT NULL THEN
      _status := 'invalid';
      _note := 'Unreadable amount: ' || array_to_string(_bad, ', ') || '. Fix the value and import again.';
      _collected := NULL; _delivery := NULL; _codfee := NULL;
      _retchg := NULL; _other := NULL; _net := NULL;
    ELSIF _cons IS NULL AND _ref IS NULL THEN
      _status := 'invalid'; _note := 'No tracking or courier reference on this row.';
    ELSIF _collected IS NOT NULL AND _collected < 0 THEN
      _status := 'invalid'; _note := 'Collected cash cannot be negative.';
    ELSE
      SELECT count(*), (array_agg(s.id))[1] INTO _n, _sid FROM public.shipments s
       WHERE s.courier_account_id = _imp.courier_account_id
         AND ((_cons IS NOT NULL AND (s.external_consignment_id = _cons
                                      OR s.tracking_number = _cons))
              OR (_cons IS NULL AND _ref IS NOT NULL
                  AND (s.provider_reference = _ref OR s.shipment_number = _ref)));
      IF _n = 0 THEN
        _status := 'unmatched'; _sid := NULL;
        _note := 'No shipment found for this courier reference.';
      ELSIF _n > 1 THEN
        _status := 'ambiguous'; _sid := NULL;
        _note := 'More than one shipment matches this reference.';
      ELSE
        SELECT i.id, st.status::text INTO _item, _item_status
          FROM public.courier_settlement_items i
          JOIN public.courier_settlements st ON st.id = i.settlement_id
         WHERE i.shipment_id = _sid AND st.status <> 'cancelled'
         ORDER BY (i.settlement_id = _imp.settlement_id) DESC, i.created_at DESC
         LIMIT 1;
        IF EXISTS (SELECT 1 FROM public.courier_statement_rows pr
                    WHERE pr.shipment_id = _sid AND pr.applied_at IS NOT NULL) THEN
          _status := 'duplicate';
          _note := 'A statement line for this shipment was already applied.';
        ELSIF _item IS NULL THEN
          _status := 'conflict';
          _note := 'Shipment is not on a live settlement yet — populate the settlement first.';
        ELSIF _item_status = 'settled' THEN
          _status := 'conflict';
          _note := 'This shipment sits on a settlement that is already closed.';
        ELSE
          _status := 'matched';
        END IF;
      END IF;
    END IF;

    INSERT INTO public.courier_statement_rows (
      import_id, row_number, row_fingerprint, consignment_id, merchant_order_reference,
      provider_status, collected_amount, delivery_fee, cod_fee, return_charge, other_charge,
      net_amount, shipment_id, settlement_item_id, match_status, match_note, raw_row)
    VALUES (_import_id, _i, _fp, _cons, _ref,
      nullif(btrim(coalesce(_r->>'provider_status','')),''),
      _collected, _delivery, _codfee, _retchg, _other, _net,
      CASE WHEN _status = 'invalid' THEN NULL ELSE _sid END,
      CASE WHEN _status = 'matched' THEN _item ELSE NULL END, _status, _note, _r)
    ON CONFLICT (import_id, row_fingerprint) DO UPDATE
      SET match_status = 'duplicate',
          match_note = 'Identical row appears more than once in this statement.';

    CASE _status
      WHEN 'matched' THEN _matched := _matched + 1;
      WHEN 'unmatched' THEN _unmatched := _unmatched + 1;
      WHEN 'ambiguous' THEN _amb := _amb + 1;
      WHEN 'duplicate' THEN _dup := _dup + 1;
      WHEN 'invalid' THEN _inv := _inv + 1;
      ELSE _conf := _conf + 1;
    END CASE;
  END LOOP;

  UPDATE public.courier_statement_imports SET
    status = 'previewed', total_rows = _i, matched_rows = _matched,
    unmatched_rows = _unmatched, ambiguous_rows = _amb, duplicate_rows = _dup,
    invalid_rows = _inv, conflict_rows = _conf
  WHERE id = _import_id;
  PERFORM set_config('app.financial_write', 'off', true);

  RETURN jsonb_build_object('total', _i, 'matched', _matched, 'unmatched', _unmatched,
    'ambiguous', _amb, 'duplicate', _dup, 'invalid', _inv, 'conflict', _conf);
END; $function$;

REVOKE ALL ON FUNCTION public.stage_courier_statement_rows(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stage_courier_statement_rows(uuid, jsonb) TO authenticated, service_role;