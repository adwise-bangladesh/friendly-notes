create or replace function public.automation_max_depth()
returns integer language sql immutable set search_path to 'public' as $$ select 3 $$;

create or replace function public.automation_sanitize_error(_msg text)
returns text language sql immutable set search_path to 'public' as $$
  select left(regexp_replace(coalesce(_msg,'Automation action failed'), '[\r\n].*$', '', 'g'), 300);
$$;

revoke all on function public.automation_order_context(uuid) from public, anon, authenticated;
revoke all on function public.emit_order_automation_events() from public, anon, authenticated;
revoke all on function public.automation_evaluate_conditions(public.automation_trigger_type, public.automation_condition_mode, jsonb, jsonb) from public, anon;
revoke all on function public.automation_max_depth() from anon;
revoke all on function public.automation_sanitize_error(text) from public, anon, authenticated;