CREATE OR REPLACE FUNCTION public.set_fulfillment_item_qc(
  _item_id uuid, _qc_status public.fulfillment_qc_status, _note text DEFAULT NULL
) RETURNS public.order_fulfillments
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _f public.order_fulfillments; _item public.order_fulfillment_items; _clean text; _from public.fulfillment_record_status;
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
  _from := _f.status;

  PERFORM set_config('app.fulfillment_record_write', 'on', true);
  UPDATE public.order_fulfillment_items SET qc_status = _qc_status, qc_note = _clean WHERE id = _item_id;

  IF _qc_status = 'failed' THEN
    UPDATE public.order_fulfillments
       SET status = 'qc_failed', updated_by = auth.uid()
     WHERE id = _f.id RETURNING * INTO _f;
  END IF;
  PERFORM set_config('app.fulfillment_record_write', 'off', true);

  PERFORM public.log_fulfillment_event(_f.id, _f.order_id,
    CASE WHEN _qc_status = 'failed' THEN 'qc_failed'::public.fulfillment_event_type
         WHEN _qc_status = 'passed' THEN 'qc_passed'::public.fulfillment_event_type
         ELSE 'qc_started'::public.fulfillment_event_type END,
    _from, _f.status,
    'Item quality control set to ' || _qc_status || coalesce(' — ' || _clean, '') || '.',
    jsonb_build_object('fulfillment_item_id', _item_id));

  IF _qc_status = 'failed' THEN
    INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by)
    VALUES (_f.order_id, 'Fulfillment #' || _f.fulfillment_number
            || ': quality control failed — ' || _clean, 'system', true, auth.uid());
  END IF;

  RETURN _f;
END; $$;