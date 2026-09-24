-- Production follow-up originally attempted to narrow pg_net ACLs. On hosted Supabase the net schema/functions are owned by supabase_admin and platform-managed, so these REVOKE statements may be no-ops. The actual application security boundary is: keep net out of Data API Exposed schemas and expose only service-role application wrappers.
revoke usage on schema net from public, anon, authenticated;
grant usage on schema net to postgres, service_role;

revoke execute on function net.http_get(text,jsonb,jsonb,integer) from public, anon, authenticated;
revoke execute on function net.http_post(text,jsonb,jsonb,jsonb,integer) from public, anon, authenticated;
revoke execute on function net.http_delete(text,jsonb,jsonb,integer,jsonb) from public, anon, authenticated;

grant execute on function net.http_get(text,jsonb,jsonb,integer) to postgres, service_role;
grant execute on function net.http_post(text,jsonb,jsonb,jsonb,integer) to postgres, service_role;
grant execute on function net.http_delete(text,jsonb,jsonb,integer,jsonb) to postgres, service_role;
