DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.normalize_bd_phone(text) TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.repeat_customer_threshold() TO sandbox_exec';
  END IF;
END $$;