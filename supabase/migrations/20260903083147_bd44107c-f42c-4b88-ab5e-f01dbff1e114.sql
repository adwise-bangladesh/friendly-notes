-- Enum extensions (values become usable in the next migration)
ALTER TYPE public.sync_job_status ADD VALUE IF NOT EXISTS 'dead_letter';
ALTER TYPE public.sync_failure_class ADD VALUE IF NOT EXISTS 'rate_limited';
ALTER TYPE public.sync_failure_class ADD VALUE IF NOT EXISTS 'authentication';

-- Job type registry: authoritative list of background job kinds
CREATE TABLE IF NOT EXISTS public.background_job_types (
  job_type text PRIMARY KEY,
  label text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.background_job_types TO authenticated;
GRANT ALL ON public.background_job_types TO service_role;
ALTER TABLE public.background_job_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Channel readers can read job types"
  ON public.background_job_types FOR SELECT TO authenticated
  USING (public.can_read_channels());

INSERT INTO public.background_job_types (job_type, label, description, enabled) VALUES
  ('channel_listing_sync', 'Channel listing sync', 'Representation-level sync of a published channel listing.', true),
  ('inventory_sync', 'Inventory sync', 'Reserved for future background inventory synchronisation.', false),
  ('courier_status_refresh', 'Courier status refresh', 'Reserved for future courier status polling.', false),
  ('webhook_recovery', 'Webhook recovery', 'Reserved for future webhook replay/recovery work.', false)
ON CONFLICT (job_type) DO NOTHING;

-- Reliability columns on the existing queue
ALTER TABLE public.sales_channel_sync_jobs
  ADD COLUMN IF NOT EXISTS job_type text NOT NULL DEFAULT 'channel_listing_sync'
    REFERENCES public.background_job_types(job_type),
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_after timestamptz,
  ADD COLUMN IF NOT EXISTS depends_on_job_id uuid REFERENCES public.sales_channel_sync_jobs(id);

-- Generic job types will not always reference a listing
ALTER TABLE public.sales_channel_sync_jobs ALTER COLUMN listing_id DROP NOT NULL;
ALTER TABLE public.sales_channel_sync_jobs ALTER COLUMN sales_channel_account_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS sales_channel_sync_jobs_claim_idx
  ON public.sales_channel_sync_jobs (status, available_at, priority);
CREATE INDEX IF NOT EXISTS sales_channel_sync_jobs_type_idx
  ON public.sales_channel_sync_jobs (job_type, status);

-- Append-only attempt history
CREATE TABLE IF NOT EXISTS public.background_job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.sales_channel_sync_jobs(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  worker_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  ok boolean,
  failure_class public.sync_failure_class,
  message text,
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS background_job_attempts_job_idx
  ON public.background_job_attempts (job_id, attempt_number DESC);
CREATE UNIQUE INDEX IF NOT EXISTS background_job_attempts_unique_idx
  ON public.background_job_attempts (job_id, attempt_number);

GRANT SELECT ON public.background_job_attempts TO authenticated;
GRANT ALL ON public.background_job_attempts TO service_role;
ALTER TABLE public.background_job_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Channel readers can read job attempts"
  ON public.background_job_attempts FOR SELECT TO authenticated
  USING (public.can_read_channels());

-- Direct client writes are rejected; controlled functions set the guard flag.
CREATE OR REPLACE FUNCTION public.guard_job_attempt_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if coalesce(current_setting('app.sync_job_write', true), 'off') <> 'on' then
    raise exception 'Job attempt history can only be written by the synchronisation functions';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

DROP TRIGGER IF EXISTS guard_job_attempt_write ON public.background_job_attempts;
CREATE TRIGGER guard_job_attempt_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.background_job_attempts
  FOR EACH ROW EXECUTE FUNCTION public.guard_job_attempt_write();

REVOKE ALL ON FUNCTION public.guard_job_attempt_write() FROM anon;
