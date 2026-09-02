-- New movement types for transfers and stocktakes
ALTER TYPE public.inventory_movement_type ADD VALUE IF NOT EXISTS 'transfer_out';
ALTER TYPE public.inventory_movement_type ADD VALUE IF NOT EXISTS 'transfer_in';
ALTER TYPE public.inventory_movement_type ADD VALUE IF NOT EXISTS 'transfer_incoming_in';
ALTER TYPE public.inventory_movement_type ADD VALUE IF NOT EXISTS 'transfer_incoming_out';
ALTER TYPE public.inventory_movement_type ADD VALUE IF NOT EXISTS 'stocktake_in';
ALTER TYPE public.inventory_movement_type ADD VALUE IF NOT EXISTS 'stocktake_out';

DO $$ BEGIN
  CREATE TYPE public.inventory_transfer_status AS ENUM ('draft','pending','in_transit','received','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.stocktake_status AS ENUM ('draft','in_progress','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.inventory_adjustment_reason AS ENUM
    ('stock_found','stock_missing','counting_error','damage','correction','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;