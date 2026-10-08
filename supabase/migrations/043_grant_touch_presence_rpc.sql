-- The presence heartbeat is called by signed-in clients through PostgREST.
-- Restrict execution to authenticated users and refresh PostgREST's schema
-- cache so the RPC is discoverable after this migration is applied.
REVOKE ALL ON FUNCTION public.touch_presence(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_presence(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';