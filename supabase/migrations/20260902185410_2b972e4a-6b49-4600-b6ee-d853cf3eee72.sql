revoke insert, update, delete, truncate, references on public.automation_rules from authenticated, anon, public;
revoke insert, update, delete, truncate, references on public.automation_rule_executions from authenticated, anon, public;
revoke insert, update, delete, truncate, references on public.automation_notes from authenticated, anon, public;
revoke select on public.automation_rules from anon, public;
revoke select on public.automation_rule_executions from anon, public;
revoke select on public.automation_notes from anon, public;