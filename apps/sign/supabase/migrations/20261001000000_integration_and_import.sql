-- =============================================================================
-- 1. 既存の契約書（他の方法で締結済みのPDF）の格納
-- 2. 外部システム（顧客管理）との連携：依頼元の識別子と、署名完了の通知の送信キュー
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 契約の出どころ：template＝このシステムで作成・署名、imported＝既存の契約書を格納
-- ---------------------------------------------------------------------------
alter table public.contracts
  add column source text not null default 'template' check (source in ('template', 'imported')),
  add column external_ref text,
  add column note text;
alter table public.contracts alter column template_version_id drop not null;
alter table public.contracts alter column template_body_hash drop not null;
alter table public.contracts add constraint contracts_source_template_check check (
  (source = 'template' and template_version_id is not null and template_body_hash is not null)
  or (source = 'imported' and template_version_id is null and template_body_hash is null)
);
create index contracts_external_ref_idx on public.contracts (external_ref);
create index contracts_source_idx on public.contracts (source);

-- contracts_view は c.* を展開済みのため作り直す
drop view public.contracts_view;
create view public.contracts_view
with (security_invoker = true) as
select c.*,
  case
    when c.status in ('draft', 'sent', 'viewed') and c.expires_at < now() then 'expired'
    else c.status
  end as effective_status
from public.contracts c;
revoke all on public.contracts_view from anon, authenticated;
grant select on public.contracts_view to authenticated;

create or replace function public.contracts_guard()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'immutable: contracts cannot be deleted' using errcode = '42501';
  end if;
  if old.status = 'signed' then
    raise exception 'immutable: signed contract cannot be modified' using errcode = '42501';
  end if;
  if old.status = 'canceled' and new.status <> 'canceled' then
    raise exception 'immutable: canceled contract cannot be reopened' using errcode = '42501';
  end if;
  if new.template_version_id is distinct from old.template_version_id
     or new.template_body_hash is distinct from old.template_body_hash
     or new.source is distinct from old.source then
    raise exception 'template version of a contract cannot be changed' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.contracts_insert_guard()
returns trigger language plpgsql
set search_path = ''
as $$
declare v record;
begin
  if new.status = 'signed' then
    raise exception 'contract cannot be inserted as signed' using errcode = '22023';
  end if;
  if new.source = 'imported' then
    -- 既存の契約書の格納は、下書きで作成 → 原本の登録 → 署名済みへ、を1トランザクションで行う
    if new.status <> 'draft' then
      raise exception 'imported contract must be inserted as draft' using errcode = '22023';
    end if;
    return new;
  end if;
  select published_at, body_hash into v from public.template_versions where id = new.template_version_id;
  if v.published_at is null then
    raise exception 'contracts can only be created from a published template version' using errcode = '22023';
  end if;
  if new.template_body_hash is distinct from v.body_hash then
    raise exception 'template body hash mismatch' using errcode = '22023';
  end if;
  return new;
end $$;

-- 文書の種類：final＝署名完了時に作成した確定版PDF、original＝格納した既存の契約書（原本）
alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check check (kind in ('final', 'original'));
alter table public.documents add column filename text;

-- 文書は契約が下書き（＝格納の途中）か、確定処理の中でだけ追加できる
create or replace function public.documents_insert_guard()
returns trigger language plpgsql
set search_path = ''
as $$
declare c record;
begin
  select status, source into c from public.contracts where id = new.contract_id;
  if new.kind = 'original' and (c.source <> 'imported' or c.status <> 'draft') then
    raise exception 'original documents can only be attached while importing' using errcode = '22023';
  end if;
  if new.kind = 'final' and c.source <> 'template' then
    raise exception 'final documents are only for contracts signed in this system' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger documents_insert_guard before insert on public.documents
  for each row execute function public.documents_insert_guard();

-- ---------------------------------------------------------------------------
-- 外部システムへの通知（署名完了など）。送信に失敗したら定期実行で再送する
-- ---------------------------------------------------------------------------
create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id),
  event text not null,
  payload jsonb not null,
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (contract_id, event)
);
create index webhook_deliveries_pending_idx on public.webhook_deliveries (next_attempt_at) where delivered_at is null;

revoke all on public.webhook_deliveries from anon, authenticated;
grant select on public.webhook_deliveries to authenticated;
alter table public.webhook_deliveries enable row level security;
create policy webhook_deliveries_select on public.webhook_deliveries for select to authenticated using (public.is_admin());

-- 検証ページ：格納した原本も照合できる（種類も返す）
drop function public.verify_document(text);
create function public.verify_document(p_sha256 text)
returns table (contract_id uuid, title text, signed_at timestamptz, tsa_time timestamptz, created_at timestamptz, kind text)
language sql stable security definer
set search_path = ''
as $$
  select d.contract_id, c.title, c.signed_at,
    (select min(t.tsa_time) from public.document_timestamps t
      where t.document_id = d.id and t.target = 'pdf') as tsa_time,
    d.created_at, d.kind
  from public.documents d join public.contracts c on c.id = d.contract_id
  where d.sha256 = lower(p_sha256)
$$;
revoke all on function public.verify_document(text) from public;
grant execute on function public.verify_document(text) to anon, authenticated;
