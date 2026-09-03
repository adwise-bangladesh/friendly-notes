ALTER TYPE public.courier_event_processing_status ADD VALUE IF NOT EXISTS 'received';
ALTER TYPE public.courier_event_processing_status ADD VALUE IF NOT EXISTS 'retry_scheduled';
ALTER TYPE public.courier_event_processing_status ADD VALUE IF NOT EXISTS 'dead_letter';

ALTER TABLE public.courier_provider_events
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS replay_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_replay_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_replay_by uuid;

CREATE INDEX IF NOT EXISTS courier_provider_events_status_idx
  ON public.courier_provider_events (processing_status, received_at DESC);
CREATE INDEX IF NOT EXISTS courier_provider_events_retry_idx
  ON public.courier_provider_events (next_retry_at)
  WHERE next_retry_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.courier_tracking_polls (
  shipment_id uuid PRIMARY KEY REFERENCES public.shipments(id) ON DELETE CASCADE,
  next_poll_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  worker_id text,
  attempts integer NOT NULL DEFAULT 0,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_polled_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.courier_tracking_polls TO service_role;
ALTER TABLE public.courier_tracking_polls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages courier tracking polls"
  ON public.courier_tracking_polls FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS courier_tracking_polls_due_idx
  ON public.courier_tracking_polls (next_poll_at);

CREATE TRIGGER update_courier_tracking_polls_updated_at
  BEFORE UPDATE ON public.courier_tracking_polls
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();