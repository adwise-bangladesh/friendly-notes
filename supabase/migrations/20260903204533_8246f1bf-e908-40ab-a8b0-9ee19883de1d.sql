CREATE SCHEMA IF NOT EXISTS extensions;
DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;
REVOKE ALL ON SCHEMA extensions FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA extensions FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA extensions TO postgres, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO postgres, service_role;