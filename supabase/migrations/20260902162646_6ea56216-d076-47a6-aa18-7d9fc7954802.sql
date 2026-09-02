ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS seq bigserial;
CREATE INDEX IF NOT EXISTS inventory_movements_seq_idx ON public.inventory_movements (seq DESC);