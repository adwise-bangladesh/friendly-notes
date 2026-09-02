REVOKE EXECUTE ON FUNCTION public.ai_protect_insight_content() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.ai_protect_recommendation_content() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.ai_block_history_change() FROM anon, authenticated, public;