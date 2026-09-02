ALTER TYPE public.shipment_status ADD VALUE IF NOT EXISTS 'pickup_failed' AFTER 'pickup_requested';
ALTER TYPE public.shipment_status ADD VALUE IF NOT EXISTS 'partial_delivered' AFTER 'delivered';
ALTER TYPE public.shipment_status ADD VALUE IF NOT EXISTS 'booking_failed' AFTER 'booking_requested';

ALTER TYPE public.shipment_event_type ADD VALUE IF NOT EXISTS 'provider_event';
ALTER TYPE public.shipment_event_type ADD VALUE IF NOT EXISTS 'status_refreshed';
ALTER TYPE public.shipment_event_type ADD VALUE IF NOT EXISTS 'booking_failed';
ALTER TYPE public.shipment_event_type ADD VALUE IF NOT EXISTS 'partial_delivery';
ALTER TYPE public.shipment_event_type ADD VALUE IF NOT EXISTS 'pickup_failed';
ALTER TYPE public.shipment_event_type ADD VALUE IF NOT EXISTS 'return_created';

CREATE TYPE public.courier_environment AS ENUM ('sandbox','production');
CREATE TYPE public.courier_event_processing_status AS ENUM ('applied','recorded','duplicate','stale','unmatched','rejected');