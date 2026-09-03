CREATE OR REPLACE FUNCTION public.record_settlement_actuals(_item_id uuid, _actual_collected_amount numeric DEFAULT NULL::numeric, _delivery_charge numeric DEFAULT NULL::numeric, _cod_charge numeric DEFAULT NULL::numeric, _return_charge numeric DEFAULT NULL::numeric, _other_charge numeric DEFAULT NULL::numeric)
 RETURNS courier_settlement_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _st public.courier_settlements; _row public.courier_settlement_items;
  _s public.shipments; _expected numeric; _settled numeric; _diff numeric; _existing uuid;
  _resolved public.courier_settlement_discrepancies;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to change settlements';
  END IF;
  SELECT * INTO _row FROM public.courier_settlement_items WHERE id = _item_id FOR UPDATE;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Settlement item not found'; END IF;
  SELECT * INTO _st FROM public.courier_settlements WHERE id = _row.settlement_id FOR UPDATE;
  IF _st.status IN ('settled','cancelled') THEN
    RAISE EXCEPTION 'A % settlement can no longer be changed', _st.status;
  END IF;
  IF coalesce(_actual_collected_amount,0) < 0 OR coalesce(_delivery_charge,0) < 0
     OR coalesce(_cod_charge,0) < 0 OR coalesce(_return_charge,0) < 0
     OR coalesce(_other_charge,0) < 0 THEN
    RAISE EXCEPTION 'Financial amounts cannot be negative';
  END IF;

  -- A reviewed and resolved difference is a closed financial decision. Changing
  -- the settled amount afterwards would leave the resolved record stale.
  SELECT * INTO _resolved FROM public.courier_settlement_discrepancies
   WHERE settlement_item_id = _row.id AND status = 'resolved';
  IF _resolved.id IS NOT NULL
     AND _actual_collected_amount IS NOT NULL
     AND round(_actual_collected_amount, 2) IS DISTINCT FROM round(coalesce(_resolved.settled_amount, 0), 2) THEN
    RAISE EXCEPTION 'The difference on this settlement line was already reviewed and resolved. Record a correcting financial adjustment instead.';
  END IF;

  PERFORM set_config('app.financial_write', 'on', true);
  UPDATE public.courier_settlement_items SET
    actual_collected_amount = coalesce(_actual_collected_amount, actual_collected_amount),
    delivery_charge = coalesce(_delivery_charge, delivery_charge),
    cod_charge = coalesce(_cod_charge, cod_charge),
    return_charge = coalesce(_return_charge, return_charge),
    other_charge = coalesce(_other_charge, other_charge)
  WHERE id = _item_id RETURNING * INTO _row;
  UPDATE public.courier_settlement_items SET
    net_settlement_amount = coalesce(actual_collected_amount,0) - coalesce(delivery_charge,0)
      - coalesce(cod_charge,0) - coalesce(return_charge,0) - coalesce(other_charge,0)
  WHERE id = _item_id RETURNING * INTO _row;
  UPDATE public.courier_settlements s
     SET status = CASE WHEN s.status = 'draft' THEN 'pending'::public.courier_settlement_status
                       ELSE s.status END,
         updated_by = auth.uid()
   WHERE s.id = _row.settlement_id;
  PERFORM set_config('app.financial_write', 'off', true);

  SELECT * INTO _s FROM public.shipments WHERE id = _row.shipment_id;
  _settled := coalesce(_row.actual_collected_amount, 0);
  _expected := _s.collected_amount;

  PERFORM public.record_shipment_financials(_row.shipment_id,
    CASE WHEN _expected IS NULL THEN _settled ELSE NULL END,
    _row.delivery_charge, _row.cod_charge, _row.return_charge, _row.other_charge,
    'Courier settlement ' || _st.settlement_reference || ' actuals recorded.');

  IF _expected IS NOT NULL THEN
    _diff := round(_settled - _expected, 2);
    SELECT id INTO _existing FROM public.courier_settlement_discrepancies
     WHERE settlement_item_id = _row.id;

    PERFORM set_config('app.financial_write', 'on', true);
    IF _diff = 0 THEN
      IF _existing IS NOT NULL THEN
        UPDATE public.courier_settlement_discrepancies
           SET expected_amount = _expected, settled_amount = _settled, difference = 0,
               status = 'resolved', resolution = 'settlement_received',
               resolved_at = coalesce(resolved_at, now()), resolved_by = auth.uid()
         WHERE id = _existing AND status = 'open';
      END IF;
    ELSIF _existing IS NULL THEN
      INSERT INTO public.courier_settlement_discrepancies (
        settlement_id, settlement_item_id, shipment_id, order_id,
        expected_amount, settled_amount, difference, direction, created_by)
      VALUES (_st.id, _row.id, _s.id, _s.order_id, _expected, _settled, _diff,
              CASE WHEN _diff < 0 THEN 'shortfall' ELSE 'surplus' END, auth.uid());
    ELSE
      UPDATE public.courier_settlement_discrepancies
         SET expected_amount = _expected, settled_amount = _settled, difference = _diff,
             direction = CASE WHEN _diff < 0 THEN 'shortfall' ELSE 'surplus' END
       WHERE id = _existing AND status = 'open';
    END IF;
    PERFORM set_config('app.financial_write', 'off', true);
  END IF;

  RETURN _row;
END; $function$;