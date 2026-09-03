ALTER TYPE public.financial_adjustment_type ADD VALUE IF NOT EXISTS 'refund';
ALTER TYPE public.financial_adjustment_type ADD VALUE IF NOT EXISTS 'settlement_shortfall';

DO $$ BEGIN
  CREATE TYPE public.return_financial_outcome AS ENUM ('pending','refunded','partially_refunded','retained');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.settlement_discrepancy_status AS ENUM ('open','resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.settlement_discrepancy_resolution AS ENUM ('courier_corrected','settlement_received','merchant_adjustment','written_off');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;