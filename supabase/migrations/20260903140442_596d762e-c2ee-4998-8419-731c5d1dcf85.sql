CREATE OR REPLACE FUNCTION public.analytics_movement_summary(_from timestamp with time zone, _to timestamp with time zone)
RETURNS TABLE(movement_type text, category text, movements bigint, total_quantity bigint, net_quantity bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
begin
  perform public.analytics_guard(_from, _to);
  return query
  select m.movement_type::text,
         case when m.movement_type in ('reservation','release_reservation')
              then 'logical' else 'physical' end::text,
         count(*)::bigint,
         sum(abs(m.quantity))::bigint,
         -- inventory_movements.quantity stores a positive magnitude; direction
         -- lives in movement_type (see apply_inventory_movement).
         sum(
           case when m.movement_type in (
                  'adjustment_out','transfer_out','stocktake_out','damage',
                  'fulfillment_out','damaged_out','transfer_incoming_out',
                  'release_reservation')
                then -abs(m.quantity) else abs(m.quantity) end
         )::bigint
    from public.inventory_movements m
   where m.created_at >= _from and m.created_at < _to
   group by 1, 2
   order by 3 desc;
end; $function$;

REVOKE EXECUTE ON FUNCTION public.analytics_movement_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_movement_summary(timestamptz, timestamptz) TO authenticated;