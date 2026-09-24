-- Production follow-up for databases that already installed pg_net via the v1.1 base migration.
-- Integration webhooks are server-side only; browser-facing database roles cannot make outbound HTTP.
revoke usage on schema net from public, anon, authenticated;
grant usage on schema net to postgres, service_role;

revoke execute on function net.http_get(text,jsonb,jsonb,integer) from public, anon, authenticated;
revoke execute on function net.http_post(text,jsonb,jsonb,jsonb,integer) from public, anon, authenticated;
revoke execute on function net.http_delete(text,jsonb,jsonb,integer,jsonb) from public, anon, authenticated;

grant execute on function net.http_get(text,jsonb,jsonb,integer) to postgres, service_role;
grant execute on function net.http_post(text,jsonb,jsonb,jsonb,integer) to postgres, service_role;
grant execute on function net.http_delete(text,jsonb,jsonb,integer,jsonb) to postgres, service_role;
