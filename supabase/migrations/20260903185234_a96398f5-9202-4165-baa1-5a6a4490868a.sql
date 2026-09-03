CREATE OR REPLACE FUNCTION public.stage_courier_statement_rows(_import_id uuid, _rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _imp public.courier_statement_imports; _r jsonb; _i int := 0;
        _cons text; _ref text; _fp text; _sid uuid; _n int; _status text; _note text;
        _item uuid; _item_status text; _collected numeric; _matched int := 0; _unmatched int := 0;
        _amb int := 0; _dup int := 0; _inv int := 0; _conf int := 0;
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
    _collected := nullif(_r->>'collected_amount','')::numeric;
    _fp := md5(coalesce(_cons,'') || '|' || coalesce(_ref,'') || '|' ||
               coalesce(_r->>'collected_amount','') || '|' || coalesce(_r->>'net_amount',''));
    _sid := NULL; _item := NULL; _note := NULL; _item_status := NULL;

    IF _cons IS NULL AND _ref IS NULL THEN
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
      _collected, nullif(_r->>'delivery_fee','')::numeric, nullif(_r->>'cod_fee','')::numeric,
      nullif(_r->>'return_charge','')::numeric, nullif(_r->>'other_charge','')::numeric,
      nullif(_r->>'net_amount','')::numeric, _sid,
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
END; $$;

REVOKE ALL ON FUNCTION public.stage_courier_statement_rows(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stage_courier_statement_rows(uuid, jsonb) TO authenticated;