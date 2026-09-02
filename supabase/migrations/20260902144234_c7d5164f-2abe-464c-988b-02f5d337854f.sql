CREATE OR REPLACE FUNCTION public.shipment_transition_valid(_from shipment_status, _to shipment_status)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- Couriers routinely skip intermediate movement updates (a parcel can go from
  -- "picked up" straight to "delivered"), so any forward jump into a delivery
  -- outcome is accepted. Backwards moves and terminal states stay closed.
  SELECT CASE _from
    WHEN 'draft' THEN _to IN ('ready_for_booking','cancelled')
    WHEN 'ready_for_booking' THEN _to IN ('booking_requested','booked','booking_failed','draft','cancelled')
    WHEN 'booking_requested' THEN _to IN ('booked','booking_failed','ready_for_booking','cancelled')
    WHEN 'booking_failed' THEN _to IN ('ready_for_booking','booking_requested','cancelled')
    WHEN 'booked' THEN _to IN ('pickup_requested','picked_up','pickup_failed','cancelled')
    WHEN 'pickup_requested' THEN _to IN ('picked_up','pickup_failed','booked','cancelled')
    WHEN 'pickup_failed' THEN _to IN ('pickup_requested','picked_up','cancelled')
    WHEN 'picked_up' THEN _to IN ('in_transit','out_for_delivery','delivery_on_hold','delivered','partial_delivered','delivery_failed','return_requested','lost')
    WHEN 'in_transit' THEN _to IN ('out_for_delivery','delivery_on_hold','delivered','partial_delivered','delivery_failed','return_requested','lost')
    WHEN 'out_for_delivery' THEN _to IN ('delivered','partial_delivered','delivery_on_hold','delivery_failed','return_requested','lost')
    WHEN 'delivery_on_hold' THEN _to IN ('out_for_delivery','delivered','partial_delivered','delivery_failed','return_requested','lost')
    WHEN 'delivery_failed' THEN _to IN ('out_for_delivery','delivery_on_hold','delivered','partial_delivered','return_requested','lost')
    WHEN 'partial_delivered' THEN _to IN ('return_requested','return_in_transit','return_received','lost')
    WHEN 'return_requested' THEN _to IN ('return_in_transit','return_received','lost')
    WHEN 'return_in_transit' THEN _to IN ('return_received','lost')
    ELSE false  -- delivered / return_received / lost / cancelled are terminal
  END;
$function$;