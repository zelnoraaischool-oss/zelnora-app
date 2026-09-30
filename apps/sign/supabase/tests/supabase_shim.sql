-- ローカルのPostgreSQLでSupabase相当の環境を再現するためのシム（テスト専用）
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;

create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  created_at timestamptz default now()
);
grant all on storage.objects, storage.buckets to service_role;

-- Supabaseの既定権限（public スキーマの新規オブジェクトに全ロールへ付与）を再現
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
