-- Fix the upsert helper (remove the invalid column reference) and lock it down.
CREATE OR REPLACE FUNCTION public.upsert_operational_alert(
  _fingerprint text,
  _signal text,
  _category text,
  _severity text,
  _title text,
  _detail text,
  _recommended_action text,
  _entity_type text DEFAULT NULL,
  _entity_id uuid DEFAULT NULL,
  _metrics jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rank_new int := CASE _severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END;
  _id uuid;
BEGIN
  PERFORM set_config('app.operational_alerts_writer', 'on', true);

  INSERT INTO public.operational_alerts AS a (
    fingerprint, signal, category, severity, peak_severity, status,
    title, detail, recommended_action, entity_type, entity_id, metrics
  )
  VALUES (
    _fingerprint, _signal, _category, _severity, _severity, 'open',
    _title, _detail, _recommended_action, _entity_type, _entity_id, COALESCE(_metrics, '{}'::jsonb)
  )
  ON CONFLICT (fingerprint) DO UPDATE SET
    severity = _severity,
    peak_severity = CASE
      WHEN _rank_new > (CASE a.peak_severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END)
        THEN _severity ELSE a.peak_severity END,
    title = _title,
    detail = _detail,
    recommended_action = _recommended_action,
    entity_type = _entity_type,
    entity_id = _entity_id,
    metrics = COALESCE(_metrics, '{}'::jsonb),
    last_detected_at = now(),
    detection_count = CASE WHEN a.status = 'resolved' THEN 1 ELSE a.detection_count + 1 END,
    first_detected_at = CASE WHEN a.status = 'resolved' THEN now() ELSE a.first_detected_at END,
    resolved_at = NULL,
    status = CASE
      WHEN a.status = 'acknowledged'
       AND a.acknowledged_at > now() - interval '24 hours'
       AND _rank_new <= (CASE a.severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END)
        THEN 'acknowledged'
      ELSE 'open' END,
    acknowledged_at = CASE
      WHEN a.status = 'acknowledged'
       AND a.acknowledged_at > now() - interval '24 hours'
       AND _rank_new <= (CASE a.severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END)
        THEN a.acknowledged_at ELSE NULL END
  RETURNING a.id INTO _id;

  PERFORM set_config('app.operational_alerts_writer', 'off', true);
  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_operational_alert(text,text,text,text,text,text,text,text,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_operational_alert(text,text,text,text,text,text,text,text,uuid,jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_operational_alert(text,text,text,text,text,text,text,text,uuid,jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_operational_alert(text,text,text,text,text,text,text,text,uuid,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.protect_operational_alerts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_operational_alerts() FROM anon;
REVOKE ALL ON FUNCTION public.protect_operational_alerts() FROM authenticated;

-- ------------------------------------------------------------
-- Bounded detector. Re-runnable; idempotent per fingerprint.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.detect_operational_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _active text[] := ARRAY[]::text[];
  _fp text;
  r record;
  _resolved int;
BEGIN
  -- 1/2. Worker health (bounded: 3 workers, 24h window)
  FOR r IN
    WITH expected(worker, interval_minutes) AS (
      VALUES ('courier_tracking', 15), ('sync_queue', 10), ('ops_sweeper', 60)
    ), agg AS (
      SELECT e.worker,
             e.interval_minutes,
             (SELECT max(w.finished_at) FROM public.worker_runs w
               WHERE w.worker = e.worker AND w.status = 'succeeded') AS last_success_at,
             (SELECT count(*) FROM public.worker_runs w
               WHERE w.worker = e.worker AND w.status = 'failed'
                 AND w.started_at > now() - interval '24 hours') AS failures_24h,
             (SELECT count(*) FROM public.worker_runs w
               WHERE w.worker = e.worker AND w.started_at > now() - interval '24 hours') AS runs_24h
        FROM expected e
    )
    SELECT * FROM agg
  LOOP
    -- stale worker
    IF r.last_success_at IS NULL OR r.last_success_at < now() - (r.interval_minutes * 3 || ' minutes')::interval THEN
      _fp := 'worker_stale:' || r.worker;
      _active := _active || _fp;
      PERFORM public.upsert_operational_alert(
        _fp, 'worker_stale', 'workers',
        CASE WHEN r.last_success_at IS NULL
               OR r.last_success_at < now() - (r.interval_minutes * 6 || ' minutes')::interval
             THEN 'critical' ELSE 'warning' END,
        'Worker not completing: ' || r.worker,
        CASE WHEN r.last_success_at IS NULL
             THEN 'No successful run has ever been recorded. Expected every ' || r.interval_minutes || ' minutes.'
             ELSE 'Last successful run ' || to_char(r.last_success_at, 'YYYY-MM-DD HH24:MI') ||
                  ' UTC. Expected every ' || r.interval_minutes || ' minutes.' END,
        'Open Background jobs, run the worker manually and confirm the scheduler is calling the published endpoint.',
        'worker', NULL,
        jsonb_build_object('worker', r.worker, 'interval_minutes', r.interval_minutes,
                           'last_success_at', r.last_success_at, 'runs_24h', r.runs_24h)
      );
    END IF;

    -- repeated failures
    IF r.failures_24h >= 3 THEN
      _fp := 'worker_failures:' || r.worker;
      _active := _active || _fp;
      PERFORM public.upsert_operational_alert(
        _fp, 'worker_failures', 'workers',
        CASE WHEN r.failures_24h >= 10 THEN 'critical' ELSE 'warning' END,
        'Repeated failures: ' || r.worker,
        r.failures_24h || ' failed runs out of ' || r.runs_24h || ' in the last 24 hours.',
        'Open Background jobs, review the failing run and the underlying queue or provider errors.',
        'worker', NULL,
        jsonb_build_object('worker', r.worker, 'failures_24h', r.failures_24h, 'runs_24h', r.runs_24h)
      );
    END IF;
  END LOOP;

  -- 3. Dead-letter courier events
  SELECT count(*) INTO _resolved FROM public.courier_provider_events
   WHERE processing_status = 'dead_letter';
  IF _resolved > 0 THEN
    _fp := 'courier_events_dead_letter';
    _active := _active || _fp;
    PERFORM public.upsert_operational_alert(
      _fp, 'courier_events_dead_letter', 'courier',
      CASE WHEN _resolved >= 10 THEN 'critical' ELSE 'warning' END,
      'Courier events in dead letter',
      _resolved || ' courier event(s) exhausted their retries and are not applied to shipments.',
      'Open Integrations → courier event recovery and replay or discard each event.',
      'courier_event', NULL, jsonb_build_object('count', _resolved)
    );
  END IF;

  -- 4. Overdue event retries
  SELECT count(*) INTO _resolved FROM public.courier_provider_events
   WHERE processing_status = 'retry_scheduled'
     AND next_retry_at < now() - interval '30 minutes';
  IF _resolved > 0 THEN
    _fp := 'courier_events_retry_backlog';
    _active := _active || _fp;
    PERFORM public.upsert_operational_alert(
      _fp, 'courier_events_retry_backlog', 'courier', 'warning',
      'Courier event retries overdue',
      _resolved || ' courier event(s) are past their retry time by more than 30 minutes.',
      'Check that the hourly sweeper is running; retry the events from courier event recovery.',
      'courier_event', NULL, jsonb_build_object('count', _resolved)
    );
  END IF;

  -- 5. Unknown booking outcomes (per shipment — operator decision required)
  FOR r IN
    SELECT id, shipment_number, booking_attempt_started_at
      FROM public.shipments
     WHERE booking_outcome_unknown = true
     ORDER BY booking_attempt_started_at NULLS LAST
     LIMIT 50
  LOOP
    _fp := 'booking_unknown:' || r.id::text;
    _active := _active || _fp;
    PERFORM public.upsert_operational_alert(
      _fp, 'booking_unknown', 'courier', 'critical',
      'Unknown booking outcome · ' || COALESCE(r.shipment_number, 'shipment'),
      'The courier booking request returned an unknown outcome. The parcel may or may not be booked.',
      'Open the shipment and record the real outcome with the booking recovery action.',
      'shipment', r.id, jsonb_build_object('shipment_number', r.shipment_number)
    );
  END LOOP;

  -- 6. Stuck booking attempts
  FOR r IN
    SELECT id, shipment_number, booking_attempt_started_at, booking_attempt_count
      FROM public.shipments
     WHERE booking_attempt_started_at IS NOT NULL
       AND booking_outcome_unknown = false
       AND status IN ('ready_for_booking','booking_requested')
       AND booking_attempt_started_at < now() - interval '15 minutes'
     ORDER BY booking_attempt_started_at
     LIMIT 50
  LOOP
    _fp := 'booking_stuck:' || r.id::text;
    _active := _active || _fp;
    PERFORM public.upsert_operational_alert(
      _fp, 'booking_stuck', 'courier', 'warning',
      'Booking attempt stuck · ' || COALESCE(r.shipment_number, 'shipment'),
      'A booking attempt started ' || to_char(r.booking_attempt_started_at, 'YYYY-MM-DD HH24:MI') ||
      ' UTC and never completed (attempt ' || COALESCE(r.booking_attempt_count, 0) || ').',
      'Open the shipment and retry the booking; the stale attempt lock is released automatically on retry.',
      'shipment', r.id, jsonb_build_object('shipment_number', r.shipment_number,
                                           'attempts', r.booking_attempt_count)
    );
  END LOOP;

  -- 7. Tracking poll health
  SELECT count(*) INTO _resolved FROM public.courier_tracking_polls
   WHERE consecutive_failures >= 3;
  IF _resolved > 0 THEN
    _fp := 'tracking_poll_failures';
    _active := _active || _fp;
    PERFORM public.upsert_operational_alert(
      _fp, 'tracking_poll_failures', 'courier',
      CASE WHEN _resolved >= 10 THEN 'critical' ELSE 'warning' END,
      'Courier tracking polls failing',
      _resolved || ' shipment(s) have failed tracking polls 3 or more times in a row.',
      'Check the courier account credentials and provider availability in Integrations.',
      'tracking_poll', NULL, jsonb_build_object('count', _resolved)
    );
  END IF;

  SELECT count(*) INTO _resolved FROM public.courier_tracking_polls
   WHERE next_poll_at < now() - interval '2 hours'
     AND (lease_until IS NULL OR lease_until < now());
  IF _resolved > 0 THEN
    _fp := 'tracking_polls_overdue';
    _active := _active || _fp;
    PERFORM public.upsert_operational_alert(
      _fp, 'tracking_polls_overdue', 'courier', 'warning',
      'Courier tracking polls overdue',
      _resolved || ' shipment(s) have been waiting more than 2 hours for a tracking poll.',
      'Confirm the courier tracking worker is running on schedule in Background jobs.',
      'tracking_poll', NULL, jsonb_build_object('count', _resolved)
    );
  END IF;

  -- 8. Unresolved settlement discrepancies (aggregate, aged)
  FOR r IN
    SELECT count(*) AS cnt,
           COALESCE(sum(abs(difference)), 0) AS amount,
           min(created_at) AS oldest
      FROM public.courier_settlement_discrepancies
     WHERE status = 'open'
  LOOP
    IF r.cnt > 0 THEN
      _fp := 'settlement_discrepancies_open';
      _active := _active || _fp;
      PERFORM public.upsert_operational_alert(
        _fp, 'settlement_discrepancies_open', 'finance',
        CASE WHEN r.oldest < now() - interval '7 days' OR r.amount >= 5000
             THEN 'critical' ELSE 'warning' END,
        'Unresolved COD settlement discrepancies',
        r.cnt || ' open discrepancy(ies) worth ' || round(r.amount) ||
        ' BDT; oldest opened ' || to_char(r.oldest, 'YYYY-MM-DD') || '.',
        'Open Finance → courier settlements and resolve each discrepancy with an adjustment or write-off.',
        'settlement', NULL,
        jsonb_build_object('count', r.cnt, 'amount', r.amount, 'oldest', r.oldest)
      );
    END IF;
  END LOOP;

  -- 9. Statement imports needing attention
  FOR r IN
    SELECT id, statement_reference, status, created_at,
           COALESCE(invalid_rows,0) + COALESCE(unmatched_rows,0) + COALESCE(ambiguous_rows,0) AS attention_rows
      FROM public.courier_statement_imports
     WHERE status NOT IN ('confirmed','cancelled')
       AND created_at > now() - interval '30 days'
     ORDER BY created_at
     LIMIT 50
  LOOP
    IF r.attention_rows > 0 OR r.created_at < now() - interval '24 hours' THEN
      _fp := 'statement_import_attention:' || r.id::text;
      _active := _active || _fp;
      PERFORM public.upsert_operational_alert(
        _fp, 'statement_import_attention', 'finance', 'warning',
        'Statement import needs attention · ' || COALESCE(r.statement_reference, 'import'),
        r.attention_rows || ' row(s) are invalid, unmatched or ambiguous and the import is still ' || r.status || '.',
        'Open the settlement, review the flagged rows and either fix the source file or confirm the import.',
        'statement_import', r.id,
        jsonb_build_object('attention_rows', r.attention_rows, 'status', r.status)
      );
    END IF;
  END LOOP;

  -- Resolve everything that is no longer detected.
  PERFORM set_config('app.operational_alerts_writer', 'on', true);
  UPDATE public.operational_alerts
     SET status = 'resolved', resolved_at = now(), severity = 'info'
   WHERE status <> 'resolved'
     AND NOT (fingerprint = ANY (_active));
  GET DIAGNOSTICS _resolved = ROW_COUNT;
  PERFORM set_config('app.operational_alerts_writer', 'off', true);

  RETURN jsonb_build_object(
    'detected', array_length(_active, 1),
    'resolved', _resolved,
    'evaluated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.detect_operational_alerts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.detect_operational_alerts() FROM anon;
REVOKE ALL ON FUNCTION public.detect_operational_alerts() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.detect_operational_alerts() TO service_role;

-- ------------------------------------------------------------
-- Read projection for the operations UI.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operational_health_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result jsonb;
BEGIN
  IF NOT public.can_read_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to read operational health';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'summary', jsonb_build_object(
      'critical', count(*) FILTER (WHERE severity = 'critical' AND status = 'open'),
      'warning', count(*) FILTER (WHERE severity = 'warning' AND status = 'open'),
      'info', count(*) FILTER (WHERE severity = 'info' AND status = 'open'),
      'acknowledged', count(*) FILTER (WHERE status = 'acknowledged'),
      'resolved_24h', count(*) FILTER (WHERE status = 'resolved' AND resolved_at > now() - interval '24 hours')
    ),
    'alerts', COALESCE((
      SELECT jsonb_agg(x ORDER BY
               CASE x->>'severity' WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
               x->>'last_detected_at' DESC)
        FROM (
          SELECT to_jsonb(a) - 'acknowledged_by' AS x
            FROM public.operational_alerts a
           WHERE a.status <> 'resolved'
           ORDER BY a.last_detected_at DESC
           LIMIT 200
        ) s
    ), '[]'::jsonb)
  ) INTO _result
  FROM public.operational_alerts;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.operational_health_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.operational_health_overview() FROM anon;
GRANT EXECUTE ON FUNCTION public.operational_health_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.operational_health_overview() TO service_role;

-- ------------------------------------------------------------
-- Acknowledgement (staff and above).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acknowledge_operational_alert(_alert_id uuid, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.operational_alerts;
BEGIN
  IF NOT public.can_manage_commerce(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to acknowledge operational alerts';
  END IF;

  PERFORM set_config('app.operational_alerts_writer', 'on', true);
  UPDATE public.operational_alerts
     SET status = 'acknowledged',
         acknowledged_at = now(),
         acknowledged_by = auth.uid(),
         acknowledged_note = left(COALESCE(_note, ''), 300)
   WHERE id = _alert_id
     AND status = 'open'
  RETURNING * INTO _row;
  PERFORM set_config('app.operational_alerts_writer', 'off', true);

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'This incident is not open, so it cannot be acknowledged';
  END IF;

  RETURN jsonb_build_object('id', _row.id, 'status', _row.status, 'acknowledged_at', _row.acknowledged_at);
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_operational_alert(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acknowledge_operational_alert(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_operational_alert(uuid, text) TO authenticated;
