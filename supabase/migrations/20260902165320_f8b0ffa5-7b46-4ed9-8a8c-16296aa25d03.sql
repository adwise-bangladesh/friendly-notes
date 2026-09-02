CREATE OR REPLACE FUNCTION public.customer_list(_search text DEFAULT NULL::text, _status customer_status DEFAULT NULL::customer_status, _customer_type text DEFAULT NULL::text, _attention boolean DEFAULT false, _limit integer DEFAULT 25, _offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _rows jsonb; _total bigint; _term text; _norm text; _lim int; _off int;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted to read customers';
  END IF;
  _lim := least(greatest(coalesce(_limit,25),1), 100);
  _off := greatest(coalesce(_offset,0),0);
  _term := nullif(btrim(lower(coalesce(_search,''))),'');
  _norm := CASE WHEN _term IS NULL THEN NULL ELSE public.normalize_bd_phone(_term) END;

  WITH agg AS (
    SELECT c.id, c.name, c.primary_phone, c.email, c.status, c.created_at,
           count(o.id) AS total_orders,
           count(o.id) FILTER (WHERE o.delivery_status IN ('delivered','partially_delivered')) AS delivered_orders,
           count(o.id) FILTER (WHERE o.delivery_status IN ('returned','partially_returned')) AS returned_orders,
           count(o.id) FILTER (WHERE o.delivery_status IN
             ('delivered','partially_delivered','returned','partially_returned','delivery_failed')) AS final_orders,
           count(o.id) FILTER (WHERE o.verification_status IN ('failed','unreachable')) AS verification_failures,
           count(o.id) FILTER (WHERE o.delivery_status = 'delivery_failed') AS failed_deliveries,
           max(o.created_at) AS last_order_at,
           EXISTS (SELECT 1 FROM public.customer_manual_flags f
                    WHERE f.customer_id = c.id AND f.is_active) AS has_manual_flag
      FROM public.customers c
      LEFT JOIN public.orders o ON o.customer_id = c.id
     WHERE (_status IS NULL OR c.status = _status)
       AND (_term IS NULL
            OR lower(c.name) LIKE '%'||_term||'%'
            OR lower(coalesce(c.email,'')) LIKE '%'||_term||'%'
            OR (_norm IS NOT NULL AND (
                 c.primary_phone_normalized LIKE '%'||_norm||'%'
                 OR coalesce(c.secondary_phone_normalized,'') LIKE '%'||_norm||'%')))
     GROUP BY c.id
  ), scored AS (
    SELECT *,
      CASE WHEN final_orders > 0 THEN round(delivered_orders::numeric*100/final_orders,1) END AS delivery_success_rate,
      CASE WHEN (delivered_orders+returned_orders) > 0
           THEN round(returned_orders::numeric*100/(delivered_orders+returned_orders),1) END AS return_rate,
      total_orders >= public.repeat_customer_threshold() AS is_repeat_customer
      FROM agg
  ), filtered AS (
    SELECT * FROM scored
     WHERE (_customer_type IS NULL
            OR (_customer_type = 'repeat' AND is_repeat_customer)
            OR (_customer_type = 'new' AND NOT is_repeat_customer))
       AND (NOT _attention OR status = 'blocked' OR has_manual_flag
            OR verification_failures >= 2 OR failed_deliveries >= 2
            OR (return_rate IS NOT NULL AND return_rate >= 30
                AND (delivered_orders + returned_orders) >= 2))
  ), page AS (
    SELECT * FROM filtered
     ORDER BY last_order_at DESC NULLS LAST, created_at DESC
     LIMIT _lim OFFSET _off
  )
  SELECT (SELECT count(*) FROM filtered),
         coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.last_order_at DESC NULLS LAST, p.created_at DESC)
                     FROM page p), '[]'::jsonb)
    INTO _total, _rows;

  RETURN jsonb_build_object('rows', _rows, 'approx_total', _total,
                            'limit', _lim, 'offset', _off);
END; $function$;

CREATE OR REPLACE FUNCTION public.resolve_customer_for_order(_name text, _phone text, _email text, _customer_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _norm text; _existing public.customers; _id uuid; _matches int; _status public.customer_status;
BEGIN
  IF _customer_id IS NOT NULL THEN
    SELECT * INTO _existing FROM public.customers WHERE id = _customer_id;
    IF _existing.id IS NULL THEN RAISE EXCEPTION 'Selected customer not found'; END IF;
    IF _existing.status = 'blocked' THEN
      RAISE EXCEPTION 'Customer is blocked and cannot place new orders';
    END IF;
    RETURN _existing.id;
  END IF;

  _norm := public.normalize_bd_phone(_phone);
  IF _norm IS NULL OR _norm = '' THEN RETURN NULL; END IF;

  SELECT count(*) INTO _matches FROM public.customers
   WHERE primary_phone_normalized = _norm OR secondary_phone_normalized = _norm;

  IF _matches = 1 THEN
    SELECT id, status INTO _id, _status FROM public.customers
     WHERE primary_phone_normalized = _norm OR secondary_phone_normalized = _norm;
    IF _status = 'blocked' THEN
      RAISE EXCEPTION 'Customer is blocked and cannot place new orders';
    END IF;
    RETURN _id;
  ELSIF _matches > 1 THEN
    RAISE EXCEPTION 'This phone number matches more than one customer — pick the customer explicitly';
  END IF;

  PERFORM set_config('app.customer_write', 'on', true);
  INSERT INTO public.customers (name, primary_phone, email, created_by, updated_by)
  VALUES (btrim(_name), btrim(_phone), nullif(btrim(coalesce(_email,'')),''), auth.uid(), auth.uid())
  RETURNING id INTO _id;
  PERFORM set_config('app.customer_write', 'off', true);
  RETURN _id;
END; $function$;

REVOKE ALL ON FUNCTION public.resolve_customer_for_order(text,text,text,uuid) FROM PUBLIC, anon, authenticated;