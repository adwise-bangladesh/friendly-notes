-- ============================================================
-- STEP 20.8.3.6 — Settlement auto-population, statement import,
-- COD reconciliation. Extends the existing settlement aggregate.
-- ============================================================

-- A. Expected snapshot on settlement items -------------------
ALTER TABLE public.courier_settlement_items
  ADD COLUMN IF NOT EXISTS expected_delivery_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_cod_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_return_charge numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_other_charge numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_net_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eligibility_reason text,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

-- B. Typed discrepancies -------------------------------------
ALTER TABLE public.courier_settlement_discrepancies
  ADD COLUMN IF NOT EXISTS discrepancy_type text NOT NULL DEFAULT 'cod';

DO $$ BEGIN
  ALTER TABLE public.courier_settlement_discrepancies
    ADD CONSTRAINT courier_settlement_discrepancy_type_check
    CHECK (discrepancy_type IN ('cod','delivery_fee','cod_fee','return_charge','other_charge','net_amount'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.courier_settlement_discrepancies
  DROP CONSTRAINT IF EXISTS courier_settlement_discrepancies_settlement_item_id_key;
DROP INDEX IF EXISTS public.courier_settlement_discrepancies_settlement_item_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_discrepancy_item_type
  ON public.courier_settlement_discrepancies (settlement_item_id, discrepancy_type);

-- C. Statement import batches --------------------------------
CREATE TABLE IF NOT EXISTS public.courier_statement_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_account_id uuid NOT NULL REFERENCES public.courier_accounts(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES public.courier_providers(id) ON DELETE RESTRICT,
  settlement_id uuid REFERENCES public.courier_settlements(id) ON DELETE SET NULL,
  statement_reference text NOT NULL,
  period_start date,
  period_end date,
  source_name text,
  status text NOT NULL DEFAULT 'draft',
  total_rows integer NOT NULL DEFAULT 0,
  matched_rows integer NOT NULL DEFAULT 0,
  unmatched_rows integer NOT NULL DEFAULT 0,
  ambiguous_rows integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0,
  invalid_rows integer NOT NULL DEFAULT 0,
  conflict_rows integer NOT NULL DEFAULT 0,
  applied_rows integer NOT NULL DEFAULT 0,
  imported_by uuid,
  confirmed_at timestamptz,
  confirmed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courier_statement_import_status_check
    CHECK (status IN ('draft','previewed','confirmed','cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_statement_import_reference
  ON public.courier_statement_imports (courier_account_id, statement_reference);

CREATE TABLE IF NOT EXISTS public.courier_statement_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.courier_statement_imports(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  row_fingerprint text NOT NULL,
  consignment_id text,
  merchant_order_reference text,
  provider_status text,
  collected_amount numeric,
  delivery_fee numeric,
  cod_fee numeric,
  return_charge numeric,
  other_charge numeric,
  net_amount numeric,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  settlement_item_id uuid REFERENCES public.courier_settlement_items(id) ON DELETE SET NULL,
  match_status text NOT NULL DEFAULT 'unmatched',
  match_note text,
  applied_at timestamptz,
  raw_row jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courier_statement_row_status_check
    CHECK (match_status IN ('matched','unmatched','ambiguous','duplicate','invalid','conflict','applied'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_statement_row_unique
  ON public.courier_statement_rows (import_id, row_fingerprint);
-- One logical courier statement line may only carry financial effect once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_statement_row_applied_once
  ON public.courier_statement_rows (shipment_id)
  WHERE applied_at IS NOT NULL AND shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_statement_row_import_status
  ON public.courier_statement_rows (import_id, match_status);
CREATE INDEX IF NOT EXISTS idx_statement_row_consignment
  ON public.courier_statement_rows (consignment_id);

GRANT SELECT ON public.courier_statement_imports TO authenticated;
GRANT SELECT ON public.courier_statement_rows TO authenticated;
GRANT ALL ON public.courier_statement_imports TO service_role;
GRANT ALL ON public.courier_statement_rows TO service_role;
REVOKE ALL ON public.courier_statement_imports FROM anon;
REVOKE ALL ON public.courier_statement_rows FROM anon;

ALTER TABLE public.courier_statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_statement_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Commerce readers view statement imports" ON public.courier_statement_imports;
CREATE POLICY "Commerce readers view statement imports"
  ON public.courier_statement_imports FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));
DROP POLICY IF EXISTS "Commerce readers view statement rows" ON public.courier_statement_rows;
CREATE POLICY "Commerce readers view statement rows"
  ON public.courier_statement_rows FOR SELECT TO authenticated
  USING (public.can_read_commerce(auth.uid()));

CREATE TRIGGER trg_statement_imports_updated_at
  BEFORE UPDATE ON public.courier_statement_imports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Statement records are written only through the controlled functions.
CREATE OR REPLACE FUNCTION public.guard_statement_import_write()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('app.financial_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Courier statement records can only be changed through the statement import workflow.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_guard_statement_imports
  BEFORE INSERT OR UPDATE OR DELETE ON public.courier_statement_imports
  FOR EACH ROW EXECUTE FUNCTION public.guard_statement_import_write();
CREATE TRIGGER trg_guard_statement_rows
  BEFORE INSERT OR UPDATE OR DELETE ON public.courier_statement_rows
  FOR EACH ROW EXECUTE FUNCTION public.guard_statement_import_write();

-- D. Authoritative eligibility -------------------------------
CREATE OR REPLACE FUNCTION public.settlement_expected_values(_shipment_id uuid)
RETURNS TABLE (
  eligible boolean, reason text, expected_collected numeric, expected_delivery_fee numeric,
  expected_cod_fee numeric, expected_return_charge numeric, expected_other_charge numeric,
  expected_net numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s public.shipments; _cod numeric; _del numeric; _codfee numeric; _ret numeric; _oth numeric;
        _eligible boolean := false; _reason text;
BEGIN
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id;
  IF _s.id IS NULL THEN RETURN; END IF;

  _del := coalesce(_s.actual_delivery_fee, _s.booked_delivery_fee, _s.quoted_delivery_fee, 0);
  _codfee := coalesce(_s.cod_fee, 0);
  _ret := coalesce(_s.return_charge, 0);
  _oth := coalesce(_s.other_courier_charge, 0);

  CASE _s.status
    WHEN 'delivered' THEN
      _eligible := true;
      _cod := coalesce(_s.collected_amount, _s.cash_on_delivery_amount, 0);
      _reason := 'Delivered — full cash on delivery expected from the courier.';
    WHEN 'partial_delivered' THEN
      _eligible := true;
      -- Never assume full COD on a partial delivery: use the recorded collection.
      _cod := coalesce(_s.collected_amount, 0);
      _reason := 'Partially delivered — only the cash actually recorded as collected is expected.';
    WHEN 'delivery_failed' THEN
      _eligible := true; _cod := 0;
      _reason := 'Delivery failed — no cash expected, courier charges may still apply.';
    WHEN 'return_received' THEN
      _eligible := true; _cod := 0;
      _reason := 'Returned to merchant — return and delivery charges may apply, no cash expected.';
    WHEN 'lost' THEN
      _eligible := true; _cod := 0;
      _reason := 'Shipment lost — no cash assumed collected; reconcile courier liability.';
    WHEN 'cancelled' THEN
      _eligible := (_del + _codfee + _ret + _oth) > 0 OR coalesce(_s.collected_amount,0) > 0;
      _cod := coalesce(_s.collected_amount, 0);
      _reason := CASE WHEN _eligible
        THEN 'Cancelled but carries an outstanding courier charge to reconcile.'
        ELSE 'Cancelled with no courier financial obligation.' END;
    ELSE
      _eligible := false; _cod := 0;
      _reason := 'Shipment is still in progress (' || _s.status::text || ').';
  END CASE;

  RETURN QUERY SELECT _eligible, _reason, round(coalesce(_cod,0),2), round(_del,2),
    round(_codfee,2), round(_ret,2), round(_oth,2),
    round(coalesce(_cod,0) - _del - _codfee - _ret - _oth, 2);
END; $$;

CREATE OR REPLACE FUNCTION public.settlement_candidate_shipments(
  _courier_account_id uuid, _limit integer DEFAULT 100, _offset integer DEFAULT 0)
RETURNS TABLE (
  shipment_id uuid, shipment_number text, order_id uuid, order_number text,
  provider_name text, courier_account_name text, consignment_id text, status text,
  expected_collected numeric, collected_amount numeric, expected_delivery_fee numeric,
  booked_delivery_fee numeric, expected_return_charge numeric, expected_net numeric,
  eligibility_reason text, already_settled boolean, settlement_reference text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT s.id, s.shipment_number, s.order_id, o.order_number,
         p.name, ca.name, s.external_consignment_id, s.status::text,
         e.expected_collected, s.collected_amount, e.expected_delivery_fee,
         s.booked_delivery_fee, e.expected_return_charge, e.expected_net,
         e.reason, existing.id IS NOT NULL, existing.settlement_reference
    FROM public.shipments s
    JOIN public.orders o ON o.id = s.order_id
    JOIN public.courier_accounts ca ON ca.id = s.courier_account_id
    JOIN public.courier_providers p ON p.id = ca.provider_id
   CROSS JOIN LATERAL public.settlement_expected_values(s.id) e
    LEFT JOIN LATERAL (
      SELECT st.id, st.settlement_reference
        FROM public.courier_settlement_items i
        JOIN public.courier_settlements st ON st.id = i.settlement_id
       WHERE i.shipment_id = s.id AND st.status <> 'cancelled' LIMIT 1) existing ON true
   WHERE public.can_read_commerce(auth.uid())
     AND s.courier_account_id = _courier_account_id
     AND e.eligible
   ORDER BY s.created_at DESC, s.id DESC
   LIMIT least(greatest(coalesce(_limit,100),1),200) OFFSET greatest(coalesce(_offset,0),0);
$$;

-- E. Idempotent population -----------------------------------
CREATE OR REPLACE FUNCTION public.populate_courier_settlement(
  _settlement_id uuid, _limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _st public.courier_settlements; _s record; _e record;
        _added int := 0; _present int := 0; _other int := 0; _cap int;
        _skipped jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change settlements';
  END IF;
  _cap := least(greatest(coalesce(_limit,200),1),500);
  SELECT * INTO _st FROM public.courier_settlements WHERE id = _settlement_id FOR UPDATE;
  IF _st.id IS NULL THEN RAISE EXCEPTION 'Settlement not found'; END IF;
  IF _st.status IN ('settled','cancelled') THEN
    RAISE EXCEPTION 'A % settlement can no longer be changed', _st.status;
  END IF;

  FOR _s IN
    SELECT sh.* FROM public.shipments sh
     WHERE sh.courier_account_id = _st.courier_account_id
     ORDER BY sh.created_at DESC LIMIT _cap
  LOOP
    SELECT * INTO _e FROM public.settlement_expected_values(_s.id);
    IF NOT _e.eligible THEN CONTINUE; END IF;

    IF EXISTS (SELECT 1 FROM public.courier_settlement_items i
                WHERE i.settlement_id = _settlement_id AND i.shipment_id = _s.id) THEN
      _present := _present + 1; CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.courier_settlement_items i
                JOIN public.courier_settlements st2 ON st2.id = i.settlement_id
               WHERE i.shipment_id = _s.id AND st2.status <> 'cancelled') THEN
      _other := _other + 1;
      _skipped := _skipped || jsonb_build_object('shipment_number', _s.shipment_number,
        'reason', 'Already part of another settlement');
      CONTINUE;
    END IF;

    PERFORM set_config('app.financial_write', 'on', true);
    INSERT INTO public.courier_settlement_items (
      settlement_id, order_id, shipment_id, expected_collected_amount,
      expected_delivery_fee, expected_cod_fee, expected_return_charge,
      expected_other_charge, expected_net_amount, eligibility_reason)
    VALUES (_settlement_id, _s.order_id, _s.id, _e.expected_collected,
      _e.expected_delivery_fee, _e.expected_cod_fee, _e.expected_return_charge,
      _e.expected_other_charge, _e.expected_net, _e.reason)
    ON CONFLICT (settlement_id, shipment_id) DO NOTHING;
    PERFORM set_config('app.financial_write', 'off', true);
    _added := _added + 1;
  END LOOP;

  PERFORM set_config('app.financial_write', 'on', true);
  UPDATE public.courier_settlements s
     SET expected_amount = (SELECT coalesce(sum(expected_collected_amount),0)
                              FROM public.courier_settlement_items WHERE settlement_id = s.id),
         updated_by = auth.uid()
   WHERE s.id = _settlement_id;
  PERFORM set_config('app.financial_write', 'off', true);

  RETURN jsonb_build_object('added', _added, 'already_present', _present,
    'skipped_other_settlement', _other, 'details', _skipped);
END; $$;

-- Keep manual add_settlement_item snapshotting the same expected values.
CREATE OR REPLACE FUNCTION public.add_settlement_item(_settlement_id uuid, _shipment_id uuid)
RETURNS courier_settlement_items LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _st public.courier_settlements; _s public.shipments;
        _row public.courier_settlement_items; _e record;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change settlements';
  END IF;
  SELECT * INTO _st FROM public.courier_settlements WHERE id = _settlement_id FOR UPDATE;
  IF _st.id IS NULL THEN RAISE EXCEPTION 'Settlement not found'; END IF;
  IF _st.status IN ('settled','cancelled') THEN
    RAISE EXCEPTION 'A % settlement can no longer be changed', _st.status;
  END IF;
  SELECT * INTO _s FROM public.shipments WHERE id = _shipment_id;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  IF _s.courier_account_id IS DISTINCT FROM _st.courier_account_id THEN
    RAISE EXCEPTION 'This shipment belongs to a different courier account';
  END IF;
  IF EXISTS (SELECT 1 FROM public.courier_settlement_items i
              JOIN public.courier_settlements s ON s.id = i.settlement_id
             WHERE i.shipment_id = _shipment_id AND s.status <> 'cancelled') THEN
    RAISE EXCEPTION 'This shipment is already part of another settlement';
  END IF;
  SELECT * INTO _e FROM public.settlement_expected_values(_shipment_id);

  PERFORM set_config('app.financial_write', 'on', true);
  INSERT INTO public.courier_settlement_items (
    settlement_id, order_id, shipment_id, expected_collected_amount,
    expected_delivery_fee, expected_cod_fee, expected_return_charge,
    expected_other_charge, expected_net_amount, eligibility_reason)
  VALUES (_settlement_id, _s.order_id, _s.id, coalesce(_e.expected_collected, 0),
    coalesce(_e.expected_delivery_fee,0), coalesce(_e.expected_cod_fee,0),
    coalesce(_e.expected_return_charge,0), coalesce(_e.expected_other_charge,0),
    coalesce(_e.expected_net,0), _e.reason)
  RETURNING * INTO _row;
  UPDATE public.courier_settlements s
     SET expected_amount = (SELECT coalesce(sum(expected_collected_amount),0)
                              FROM public.courier_settlement_items WHERE settlement_id = s.id),
         updated_by = auth.uid()
   WHERE s.id = _settlement_id;
  PERFORM set_config('app.financial_write', 'off', true);
  RETURN _row;
END; $$;

-- F. Typed discrepancy detection ------------------------------
CREATE OR REPLACE FUNCTION public.detect_settlement_item_discrepancies(_item_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _row public.courier_settlement_items; _st public.courier_settlements;
        _t text; _exp numeric; _act numeric; _diff numeric; _count int := 0;
BEGIN
  SELECT * INTO _row FROM public.courier_settlement_items WHERE id = _item_id;
  IF _row.id IS NULL THEN RETURN 0; END IF;
  SELECT * INTO _st FROM public.courier_settlements WHERE id = _row.settlement_id;

  FOREACH _t IN ARRAY ARRAY['delivery_fee','cod_fee','return_charge','other_charge','net_amount'] LOOP
    _exp := CASE _t
      WHEN 'delivery_fee' THEN _row.expected_delivery_fee
      WHEN 'cod_fee' THEN _row.expected_cod_fee
      WHEN 'return_charge' THEN _row.expected_return_charge
      WHEN 'other_charge' THEN _row.expected_other_charge
      ELSE _row.expected_net_amount END;
    _act := CASE _t
      WHEN 'delivery_fee' THEN _row.delivery_charge
      WHEN 'cod_fee' THEN _row.cod_charge
      WHEN 'return_charge' THEN _row.return_charge
      WHEN 'other_charge' THEN _row.other_charge
      ELSE _row.net_settlement_amount END;
    CONTINUE WHEN _act IS NULL;
    _diff := round(coalesce(_act,0) - coalesce(_exp,0), 2);

    PERFORM set_config('app.financial_write', 'on', true);
    IF _diff = 0 THEN
      UPDATE public.courier_settlement_discrepancies
         SET expected_amount = coalesce(_exp,0), settled_amount = coalesce(_act,0),
             difference = 0, status = 'resolved', resolution = 'settlement_received',
             resolved_at = coalesce(resolved_at, now()), resolved_by = auth.uid()
       WHERE settlement_item_id = _item_id AND discrepancy_type = _t AND status = 'open';
    ELSE
      INSERT INTO public.courier_settlement_discrepancies (
        settlement_id, settlement_item_id, shipment_id, order_id, discrepancy_type,
        expected_amount, settled_amount, difference, direction, created_by)
      VALUES (_st.id, _row.id, _row.shipment_id, _row.order_id, _t,
        coalesce(_exp,0), coalesce(_act,0), _diff,
        CASE WHEN _diff < 0 THEN 'shortfall' ELSE 'surplus' END, auth.uid())
      ON CONFLICT (settlement_item_id, discrepancy_type) DO UPDATE
        SET expected_amount = excluded.expected_amount,
            settled_amount = excluded.settled_amount,
            difference = excluded.difference,
            direction = excluded.direction
        WHERE public.courier_settlement_discrepancies.status = 'open';
      _count := _count + 1;
    END IF;
    PERFORM set_config('app.financial_write', 'off', true);
  END LOOP;

  PERFORM set_config('app.financial_write', 'on', true);
  UPDATE public.courier_settlement_items SET reconciled_at = now() WHERE id = _item_id;
  UPDATE public.courier_settlements s
     SET actual_amount = (SELECT coalesce(sum(net_settlement_amount),0)
                            FROM public.courier_settlement_items WHERE settlement_id = s.id),
         status = CASE
           WHEN s.status IN ('settled','cancelled','disputed') THEN s.status
           WHEN EXISTS (SELECT 1 FROM public.courier_settlement_discrepancies d
                         WHERE d.settlement_id = s.id AND d.status = 'open') THEN 'disputed'
           WHEN NOT EXISTS (SELECT 1 FROM public.courier_settlement_items i
                             WHERE i.settlement_id = s.id AND i.actual_collected_amount IS NULL)
             THEN 'partial'
           ELSE 'pending' END,
         updated_by = auth.uid()
   WHERE s.id = _row.settlement_id;
  PERFORM set_config('app.financial_write', 'off', true);
  RETURN _count;
END; $$;

-- G. Statement import workflow --------------------------------
CREATE OR REPLACE FUNCTION public.begin_courier_statement_import(
  _courier_account_id uuid, _statement_reference text, _source_name text DEFAULT NULL,
  _period_start date DEFAULT NULL, _period_end date DEFAULT NULL,
  _settlement_id uuid DEFAULT NULL)
RETURNS public.courier_statement_imports
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _acc public.courier_accounts; _row public.courier_statement_imports;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to import courier statements';
  END IF;
  IF coalesce(btrim(coalesce(_statement_reference,'')),'') = '' THEN
    RAISE EXCEPTION 'A statement reference is required';
  END IF;
  SELECT * INTO _acc FROM public.courier_accounts WHERE id = _courier_account_id;
  IF _acc.id IS NULL THEN RAISE EXCEPTION 'Courier account not found'; END IF;

  SELECT * INTO _row FROM public.courier_statement_imports
   WHERE courier_account_id = _courier_account_id
     AND statement_reference = btrim(_statement_reference);
  IF _row.id IS NOT NULL THEN
    IF _row.status = 'confirmed' THEN
      RAISE EXCEPTION 'This statement was already imported and confirmed on %',
        to_char(_row.confirmed_at, 'DD Mon YYYY');
    END IF;
    RETURN _row;
  END IF;

  PERFORM set_config('app.financial_write', 'on', true);
  INSERT INTO public.courier_statement_imports (
    courier_account_id, provider_id, settlement_id, statement_reference,
    period_start, period_end, source_name, imported_by)
  VALUES (_courier_account_id, _acc.provider_id, _settlement_id, btrim(_statement_reference),
    _period_start, _period_end, nullif(btrim(coalesce(_source_name,'')),''), auth.uid())
  RETURNING * INTO _row;
  PERFORM set_config('app.financial_write', 'off', true);
  RETURN _row;
END; $$;

CREATE OR REPLACE FUNCTION public.stage_courier_statement_rows(_import_id uuid, _rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _imp public.courier_statement_imports; _r jsonb; _i int := 0;
        _cons text; _ref text; _fp text; _sid uuid; _n int; _status text; _note text;
        _item uuid; _collected numeric; _matched int := 0; _unmatched int := 0;
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
    _sid := NULL; _item := NULL; _note := NULL;

    IF _cons IS NULL AND _ref IS NULL THEN
      _status := 'invalid'; _note := 'No tracking or courier reference on this row.';
    ELSIF _collected IS NOT NULL AND _collected < 0 THEN
      _status := 'invalid'; _note := 'Collected cash cannot be negative.';
    ELSE
      SELECT count(*), min(s.id) INTO _n, _sid FROM public.shipments s
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
        SELECT i.id INTO _item FROM public.courier_settlement_items i
          JOIN public.courier_settlements st ON st.id = i.settlement_id
         WHERE i.shipment_id = _sid AND st.status <> 'cancelled' LIMIT 1;
        IF EXISTS (SELECT 1 FROM public.courier_statement_rows pr
                    WHERE pr.shipment_id = _sid AND pr.applied_at IS NOT NULL) THEN
          _status := 'duplicate';
          _note := 'A statement line for this shipment was already applied.';
        ELSIF _item IS NULL THEN
          _status := 'conflict';
          _note := 'Shipment is not on a live settlement yet — populate the settlement first.';
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
      nullif(_r->>'net_amount','')::numeric, _sid, _item, _status, _note, _r)
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

CREATE OR REPLACE FUNCTION public.confirm_courier_statement_import(_import_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _imp public.courier_statement_imports; _row record;
        _applied int := 0; _failed int := 0; _disc int := 0; _errors jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to import courier statements';
  END IF;
  SELECT * INTO _imp FROM public.courier_statement_imports WHERE id = _import_id FOR UPDATE;
  IF _imp.id IS NULL THEN RAISE EXCEPTION 'Statement import not found'; END IF;
  IF _imp.status = 'confirmed' THEN
    RAISE EXCEPTION 'This statement was already confirmed — import a correcting statement instead';
  END IF;

  FOR _row IN
    SELECT * FROM public.courier_statement_rows
     WHERE import_id = _import_id AND match_status = 'matched' AND applied_at IS NULL
     ORDER BY row_number FOR UPDATE
  LOOP
    BEGIN
      PERFORM public.record_settlement_actuals(
        _row.settlement_item_id, coalesce(_row.collected_amount, 0),
        _row.delivery_fee, _row.cod_fee, _row.return_charge, _row.other_charge);
      _disc := _disc + public.detect_settlement_item_discrepancies(_row.settlement_item_id);
      PERFORM set_config('app.financial_write', 'on', true);
      UPDATE public.courier_statement_rows
         SET applied_at = now(), match_status = 'applied' WHERE id = _row.id;
      PERFORM set_config('app.financial_write', 'off', true);
      _applied := _applied + 1;
    EXCEPTION WHEN others THEN
      _failed := _failed + 1;
      PERFORM set_config('app.financial_write', 'on', true);
      UPDATE public.courier_statement_rows
         SET match_status = 'conflict', match_note = left(SQLERRM, 300) WHERE id = _row.id;
      PERFORM set_config('app.financial_write', 'off', true);
      _errors := _errors || jsonb_build_object('row', _row.row_number, 'error', left(SQLERRM, 300));
    END;
  END LOOP;

  PERFORM set_config('app.financial_write', 'on', true);
  UPDATE public.courier_statement_imports SET
    status = 'confirmed', applied_rows = _applied, confirmed_at = now(),
    confirmed_by = auth.uid(),
    conflict_rows = (SELECT count(*) FROM public.courier_statement_rows
                      WHERE import_id = _import_id AND match_status = 'conflict')
  WHERE id = _import_id;
  PERFORM set_config('app.financial_write', 'off', true);

  RETURN jsonb_build_object('applied', _applied, 'failed', _failed,
    'discrepancies_created', _disc, 'errors', _errors);
END; $$;

-- H. Operational visibility of unresolved settlement differences
CREATE OR REPLACE FUNCTION public.order_settlement_discrepancy_summary(_order_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'type', d.discrepancy_type, 'expected', d.expected_amount,
    'settled', d.settled_amount, 'difference', d.difference, 'status', d.status,
    'settlement_reference', s.settlement_reference)), '[]'::jsonb)
    FROM public.courier_settlement_discrepancies d
    JOIN public.courier_settlements s ON s.id = d.settlement_id
   WHERE d.order_id = _order_id AND d.status = 'open'
     AND public.can_read_commerce(auth.uid());
$$;

-- I. Grants ---------------------------------------------------
REVOKE ALL ON FUNCTION public.settlement_expected_values(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settlement_candidate_shipments(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.populate_courier_settlement(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.detect_settlement_item_discrepancies(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.begin_courier_statement_import(uuid, text, text, date, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stage_courier_statement_rows(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_courier_statement_import(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.order_settlement_discrepancy_summary(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_statement_import_write() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.settlement_expected_values(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_candidate_shipments(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.populate_courier_settlement(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detect_settlement_item_discrepancies(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.begin_courier_statement_import(uuid, text, text, date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stage_courier_statement_rows(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_courier_statement_import(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_settlement_discrepancy_summary(uuid) TO authenticated;

-- J. Backfill expected snapshots for existing settlement lines
DO $$ DECLARE _i record; _e record; BEGIN
  PERFORM set_config('app.financial_write', 'on', true);
  FOR _i IN SELECT * FROM public.courier_settlement_items WHERE eligibility_reason IS NULL LOOP
    SELECT * INTO _e FROM public.settlement_expected_values(_i.shipment_id);
    UPDATE public.courier_settlement_items SET
      expected_delivery_fee = coalesce(_e.expected_delivery_fee,0),
      expected_cod_fee = coalesce(_e.expected_cod_fee,0),
      expected_return_charge = coalesce(_e.expected_return_charge,0),
      expected_other_charge = coalesce(_e.expected_other_charge,0),
      expected_net_amount = coalesce(_i.expected_collected_amount,0)
        - coalesce(_e.expected_delivery_fee,0) - coalesce(_e.expected_cod_fee,0)
        - coalesce(_e.expected_return_charge,0) - coalesce(_e.expected_other_charge,0),
      eligibility_reason = coalesce(_e.reason, 'Existing settlement line (recorded before eligibility snapshots).')
    WHERE id = _i.id;
  END LOOP;
  PERFORM set_config('app.financial_write', 'off', true);
END $$;