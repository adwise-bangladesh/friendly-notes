-- Concurrency hardening for goods receiving:
-- only one open (draft) receipt may exist per purchase order, enforced by the
-- database rather than only by the in-function existence check, which two
-- simultaneous warehouse users could otherwise pass at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS goods_receipts_one_open_draft
  ON public.goods_receipts (purchase_order_id)
  WHERE status = 'draft';

-- Speed up receipt history lookups per purchase order.
CREATE INDEX IF NOT EXISTS goods_receipts_po_idx
  ON public.goods_receipts (purchase_order_id, created_at DESC);