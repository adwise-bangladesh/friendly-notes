CREATE OR REPLACE FUNCTION public.fulfillment_transition_valid(
  _from public.fulfillment_record_status,
  _to public.fulfillment_record_status
) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
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