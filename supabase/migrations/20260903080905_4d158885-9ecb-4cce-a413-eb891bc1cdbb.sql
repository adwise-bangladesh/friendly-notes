create or replace function public.channel_listing_readiness(_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare _src text;
begin
  if not public.can_read_channels() then
    raise exception 'Not permitted to read the store catalog';
  end if;
  return public.channel_listing_readiness_internal(_listing_id);
end $function$;