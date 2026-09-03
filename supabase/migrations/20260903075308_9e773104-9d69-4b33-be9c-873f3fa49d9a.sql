revoke all on function public.effective_store_product_data(uuid) from public, anon;
revoke all on function public.channel_listing_readiness(uuid) from public, anon;
revoke all on function public.record_listing_readiness_check(uuid) from public, anon;
revoke all on function public.begin_listing_operation(uuid, public.sales_channel_sync_type) from public, anon;
revoke all on function public.finish_listing_operation(uuid, uuid, public.sales_channel_sync_type, boolean, text, text, text, numeric, numeric, boolean) from public, anon;
revoke all on function public.trg_store_product_sync_queue() from public, anon;
revoke all on function public.trg_product_sync_queue() from public, anon;
revoke all on function public.trg_inventory_sync_queue() from public, anon;
revoke all on function public.can_sync_channels() from public, anon;
revoke all on function public.can_read_channels() from public, anon;

grant execute on function public.effective_store_product_data(uuid) to authenticated, service_role;
grant execute on function public.channel_listing_readiness(uuid) to authenticated, service_role;
grant execute on function public.record_listing_readiness_check(uuid) to authenticated, service_role;
grant execute on function public.begin_listing_operation(uuid, public.sales_channel_sync_type) to authenticated, service_role;
grant execute on function public.finish_listing_operation(uuid, uuid, public.sales_channel_sync_type, boolean, text, text, text, numeric, numeric, boolean) to authenticated, service_role;
grant execute on function public.can_sync_channels() to authenticated, service_role;
grant execute on function public.can_read_channels() to authenticated, service_role;