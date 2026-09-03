CREATE OR REPLACE FUNCTION public.record_listing_readiness_check(_listing_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _result jsonb; _row public.sales_channel_product_listings;
begin
  if not public.can_manage_commerce(auth.uid()) then
    raise exception 'Not permitted to check listing readiness';
  end if;
  _result := public.channel_listing_readiness(_listing_id);
  select * into _row from public.sales_channel_product_listings where id = _listing_id;
  perform set_config('app.catalog_write','on',true);
  insert into public.channel_listing_events (listing_id, event_type, status_to, message, created_by)
  values (_listing_id, 'listing_readiness_checked', _row.listing_status,
    case when (_result->>'ready')::boolean then 'Ready to publish'
         else left('Blocked: ' || coalesce(array_to_string(array(select jsonb_array_elements_text(_result->'blocking')), '; '),''), 300) end,
    auth.uid());
  perform set_config('app.catalog_write','off',true);
  return _result;
end $function$;

REVOKE EXECUTE ON FUNCTION public.record_listing_readiness_check(uuid) FROM anon;