CREATE OR REPLACE FUNCTION public.shipments_console_list(_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _src text;
BEGIN
  RAISE EXCEPTION 'placeholder';
END;
$function$;