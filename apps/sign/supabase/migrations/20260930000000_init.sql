-- 電子契約システム 初期スキーマ（フェーズ1）
-- 方針:
--   * すべてのテーブルでRLSを有効化。authenticated（管理者）には参照のみを許可し、
--     書き込みはサーバー（service_role）経由に限定する。
--   * 署名済み契約・確定版PDF・監査ログは、トリガーでUPDATE/DELETEを禁止する。
--     トリガーは service_role にも適用されるため、APIからは誰も変更できない。
--   * 監査ログはハッシュチェーンで連結する。

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 共通ヘルパー
-- ---------------------------------------------------------------------------
create or replace function public.sha256_hex(input text)
returns text language sql immutable strict
set search_path = ''
as $$ select encode(extensions.digest(convert_to(input, 'UTF8'), 'sha256'), 'hex') $$;

create or replace function public.raise_immutable()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  raise exception 'immutable: % on %.% is not allowed', tg_op, tg_table_schema, tg_table_name
    using errcode = '42501';
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------------
-- 管理者
-- ---------------------------------------------------------------------------
create table public.admins (
  id uuid primary key references auth.users(id) on delete restrict,
  email text not null unique,
  display_name text,
  role text not null check (role in ('owner', 'staff')),
  mfa_enabled boolean not null default false,
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);

-- MFA（aal2）を通過した有効な管理者か
create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins a
    where a.id = auth.uid() and a.disabled_at is null
  ) and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select public.is_admin() and exists (
    select 1 from public.admins a where a.id = auth.uid() and a.role = 'owner'
  )
$$;

-- ---------------------------------------------------------------------------
-- 設定（1行のみ）
-- ---------------------------------------------------------------------------
create table public.settings (
  id boolean primary key default true check (id),
  organization_name text not null default 'AIエンジニアスクール',
  organization_representative text not null default '代表 中倉来希',
  admin_notify_email text,
  default_expiry_days integer not null default 14 check (default_expiry_days between 1 and 365),
  reminder_after_send_days integer not null default 3 check (reminder_after_send_days >= 0),
  reminder_before_expiry_days integer not null default 1 check (reminder_before_expiry_days >= 0),
  auto_reminder_enabled boolean not null default true,
  anonymize_after_days integer not null default 365 check (anonymize_after_days >= 30),
  daily_hash_email_enabled boolean not null default false,
  privacy_policy_url text,
  cost_email_yen numeric(10, 3) not null default 0.14,
  cost_sms_yen numeric(10, 3) not null default 10,
  cost_timestamp_yen numeric(10, 3) not null default 10,
  updated_at timestamptz not null default now()
);
insert into public.settings default values;
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- テンプレート
-- ---------------------------------------------------------------------------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),
  current_version_id uuid,
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger templates_touch before update on public.templates
  for each row execute function public.touch_updated_at();

create table public.template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates(id) on delete cascade,
  version_no integer not null,
  body jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  body_hash text,
  variables jsonb not null default '[]'::jsonb,
  confirm_screen_items jsonb not null default '{}'::jsonb,
  key_clauses jsonb not null default '[]'::jsonb,
  amount_variable_key text,
  transaction_date_variable_key text,
  counterparty_variable_key text,
  email_subject text not null default '【ご確認ください】{{契約名}}',
  email_body text not null default '',
  require_sms boolean not null default false,
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (template_id, version_no)
);
-- 下書きはテンプレートごとに1つまで
create unique index template_versions_one_draft
  on public.template_versions (template_id) where published_at is null;

alter table public.templates
  add constraint templates_current_version_fk
  foreign key (current_version_id) references public.template_versions(id);

create or replace function public.template_version_content_hash(v public.template_versions)
returns text language sql immutable
set search_path = ''
as $$
  select public.sha256_hex(jsonb_build_object(
    'body', v.body,
    'variables', v.variables,
    'confirm_screen_items', v.confirm_screen_items,
    'key_clauses', v.key_clauses
  )::text)
$$;

create or replace function public.template_versions_guard()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null then
      raise exception 'immutable: published template version cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.published_at is not null then
    raise exception 'immutable: published template version cannot be modified' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.published_at is not null then
    raise exception 'template version must be created as draft' using errcode = '22023';
  end if;
  -- 公開の瞬間に本文ハッシュを確定させる
  if new.published_at is not null then
    new.body_hash := public.template_version_content_hash(new);
  else
    new.body_hash := null;
  end if;
  return new;
end $$;
create trigger template_versions_guard
  before insert or update or delete on public.template_versions
  for each row execute function public.template_versions_guard();

-- ---------------------------------------------------------------------------
-- 条項ライブラリ
-- ---------------------------------------------------------------------------
create table public.clauses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default '',
  body jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger clauses_touch before update on public.clauses
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 連絡先
-- ---------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  company text,
  line_user_id text unique,
  tags text[] not null default '{}',
  note text not null default '',
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index contacts_email_unique on public.contacts (lower(email)) where email is not null;
create index contacts_name_idx on public.contacts (name);
create trigger contacts_touch before update on public.contacts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 契約
-- ---------------------------------------------------------------------------
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.template_versions(id),
  template_body_hash text not null,
  title text not null,
  status text not null default 'sent'
    check (status in ('draft', 'sent', 'viewed', 'signed', 'expired', 'canceled')),
  amount numeric(14, 0),
  transaction_date date,
  counterparty_name text,
  delivery_channels text[] not null default '{}',
  expires_at timestamptz not null,
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text,
  anonymized_at timestamptz,
  signed_content_hash text,
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'canceled' or (canceled_at is not null and coalesce(cancel_reason, '') <> '')),
  check (status <> 'signed' or signed_at is not null)
);
create index contracts_status_idx on public.contracts (status);
create index contracts_created_idx on public.contracts (created_at desc);
create index contracts_tx_date_idx on public.contracts (transaction_date);
create index contracts_amount_idx on public.contracts (amount);
create index contracts_counterparty_idx on public.contracts (counterparty_name);

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
  if new.template_version_id <> old.template_version_id
     or new.template_body_hash <> old.template_body_hash then
    raise exception 'template version of a contract cannot be changed' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger contracts_guard before update or delete on public.contracts
  for each row execute function public.contracts_guard();

-- 契約作成時に、公開済みバージョンであることと本文ハッシュを検証
create or replace function public.contracts_insert_guard()
returns trigger language plpgsql
set search_path = ''
as $$
declare v record;
begin
  select published_at, body_hash into v from public.template_versions where id = new.template_version_id;
  if v.published_at is null then
    raise exception 'contracts can only be created from a published template version' using errcode = '22023';
  end if;
  if new.template_body_hash is distinct from v.body_hash then
    raise exception 'template body hash mismatch' using errcode = '22023';
  end if;
  if new.status = 'signed' then
    raise exception 'contract cannot be inserted as signed' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger contracts_insert_guard before insert on public.contracts
  for each row execute function public.contracts_insert_guard();

-- 実効ステータス（期限切れを反映）
create or replace view public.contracts_view
with (security_invoker = true) as
select c.*,
  case
    when c.status in ('draft', 'sent', 'viewed') and c.expires_at < now() then 'expired'
    else c.status
  end as effective_status
from public.contracts c;

-- 子テーブル共通: 親契約が署名済みなら変更不可
create or replace function public.contract_child_guard()
returns trigger language plpgsql
set search_path = ''
as $$
declare cid uuid; st text;
begin
  cid := case when tg_op = 'DELETE' then old.contract_id else new.contract_id end;
  select status into st from public.contracts where id = cid;
  if st = 'signed' then
    raise exception 'immutable: % on %.% of a signed contract is not allowed', tg_op, tg_table_schema, tg_table_name
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.contract_id <> new.contract_id then
    raise exception 'contract_id cannot be changed' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create table public.contract_parties (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id),
  contact_id uuid references public.contacts(id),
  role text not null default 'signer' check (role in ('signer')),
  sign_order integer not null default 1,
  status text not null default 'pending'
    check (status in ('pending', 'viewed', 'verified', 'signed')),
  name text not null,
  email text,
  phone text,
  company text,
  delivery_channels text[] not null default '{}',
  verified_email text,
  verified_method text,
  verified_at timestamptz,
  read_completed_at timestamptz,
  consents jsonb not null default '{}'::jsonb,
  signed_name text,
  signature_image text,
  signed_at timestamptz,
  signed_ip text,
  signed_user_agent text,
  last_reminded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (contract_id, sign_order)
);
create index contract_parties_contact_idx on public.contract_parties (contact_id);
create trigger contract_parties_guard before update or delete on public.contract_parties
  for each row execute function public.contract_child_guard();
create trigger contract_parties_insert_guard before insert on public.contract_parties
  for each row execute function public.contract_child_guard();

create table public.contract_values (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id),
  variable_key text not null,
  value text not null default '',
  entered_by text not null check (entered_by in ('admin', 'signer')),
  updated_at timestamptz not null default now(),
  unique (contract_id, variable_key)
);
create trigger contract_values_guard before insert or update or delete on public.contract_values
  for each row execute function public.contract_child_guard();

-- ---------------------------------------------------------------------------
-- 署名URLのトークン（ハッシュのみで照合。token_ciphertextはURL再コピー用に
-- アプリ側の鍵で暗号化した値で、DB単体からはURLを復元できない）
-- ---------------------------------------------------------------------------
create table public.access_tokens (
  id uuid primary key default gen_random_uuid(),
  contract_party_id uuid not null references public.contract_parties(id),
  token_hash text not null unique,
  token_ciphertext text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text,
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now()
);
create index access_tokens_party_idx on public.access_tokens (contract_party_id);

create or replace function public.access_tokens_guard()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'immutable: access tokens cannot be deleted' using errcode = '42501';
  end if;
  if new.token_hash <> old.token_hash or new.contract_party_id <> old.contract_party_id then
    raise exception 'immutable: token identity cannot be changed' using errcode = '42501';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'revoked token cannot be reactivated' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger access_tokens_guard before update or delete on public.access_tokens
  for each row execute function public.access_tokens_guard();

-- ---------------------------------------------------------------------------
-- ワンタイムパスワード
-- ---------------------------------------------------------------------------
create table public.otp_challenges (
  id uuid primary key default gen_random_uuid(),
  contract_party_id uuid not null references public.contract_parties(id),
  channel text not null check (channel in ('email', 'sms')),
  destination text not null,
  code_hash text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  expires_at timestamptz not null,
  verified_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now()
);
create index otp_challenges_party_idx on public.otp_challenges (contract_party_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 確定版PDF（更新・削除不可）とタイムスタンプ（追記のみ）
-- ---------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id),
  kind text not null default 'final' check (kind in ('final')),
  storage_path text not null unique,
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer not null,
  pades_signed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (contract_id, kind)
);
create trigger documents_immutable before update or delete on public.documents
  for each row execute function public.raise_immutable();
create trigger documents_no_truncate before truncate on public.documents
  for each statement execute function public.raise_immutable();

create table public.document_timestamps (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id),
  contract_id uuid not null references public.contracts(id),
  target text not null check (target in ('pdf', 'content')),
  hashed_message text not null,
  tsa_url text not null,
  tsa_token text not null, -- DERのbase64（TimeStampToken）
  tsa_time timestamptz not null,
  tsa_serial text,
  created_at timestamptz not null default now()
);
create index document_timestamps_contract_idx on public.document_timestamps (contract_id);
create trigger document_timestamps_immutable before update or delete on public.document_timestamps
  for each row execute function public.raise_immutable();
create trigger document_timestamps_no_truncate before truncate on public.document_timestamps
  for each statement execute function public.raise_immutable();

-- TSA再試行キュー（運用上の状態なので更新可）
create table public.timestamp_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references public.documents(id),
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  done_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 監査ログ（追記のみ・ハッシュチェーン）
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint not null unique,
  contract_id uuid references public.contracts(id),
  actor_type text not null check (actor_type in ('admin', 'signer', 'system', 'public')),
  actor_id text,
  event_type text not null,
  ip text,
  user_agent text,
  payload jsonb not null default '{}'::jsonb,
  prev_hash text,
  hash text not null,
  created_at timestamptz not null
);
create index audit_events_contract_idx on public.audit_events (contract_id, seq);

create or replace function public.audit_event_hash(
  p_prev_hash text, p_seq bigint, p_id uuid, p_contract_id uuid, p_actor_type text, p_actor_id text,
  p_event_type text, p_ip text, p_user_agent text, p_payload jsonb, p_created_at timestamptz
) returns text language sql immutable
set search_path = ''
as $$
  select public.sha256_hex(concat_ws('|',
    coalesce(p_prev_hash, ''),
    p_seq::text,
    p_id::text,
    coalesce(p_contract_id::text, ''),
    p_actor_type,
    coalesce(p_actor_id, ''),
    p_event_type,
    coalesce(p_ip, ''),
    coalesce(p_user_agent, ''),
    p_payload::text,
    to_char(p_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ))
$$;

create or replace function public.audit_events_chain()
returns trigger language plpgsql
set search_path = ''
as $$
declare last record;
begin
  -- 直列化して、直前のレコードを確実に参照する
  perform pg_advisory_xact_lock(8214501);
  select seq, hash into last from public.audit_events order by seq desc limit 1;
  new.seq := coalesce(last.seq, 0) + 1;
  new.prev_hash := last.hash;
  new.created_at := clock_timestamp();
  new.hash := public.audit_event_hash(new.prev_hash, new.seq, new.id, new.contract_id, new.actor_type,
    new.actor_id, new.event_type, new.ip, new.user_agent, new.payload, new.created_at);
  return new;
end $$;
create trigger audit_events_chain before insert on public.audit_events
  for each row execute function public.audit_events_chain();
create trigger audit_events_immutable before update or delete on public.audit_events
  for each row execute function public.raise_immutable();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function public.raise_immutable();

-- 整合性チェック: 途切れ・改ざんのある最初のレコードを返す（なければ0行）
create or replace function public.verify_audit_chain()
returns table (ok boolean, checked bigint, broken_seq bigint, reason text, last_hash text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  r record;
  prev text := null;
  expected_seq bigint := 1;
  n bigint := 0;
begin
  if not (public.is_admin() or current_user in ('service_role', 'postgres')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  for r in select * from public.audit_events order by seq loop
    n := n + 1;
    if r.seq <> expected_seq then
      return query select false, n, r.seq, 'シーケンスが途切れています（欠落または削除）', prev; return;
    end if;
    if r.prev_hash is distinct from prev then
      return query select false, n, r.seq, '直前のレコードのハッシュと一致しません', prev; return;
    end if;
    if r.hash <> public.audit_event_hash(r.prev_hash, r.seq, r.id, r.contract_id, r.actor_type, r.actor_id,
         r.event_type, r.ip, r.user_agent, r.payload, r.created_at) then
      return query select false, n, r.seq, 'レコードの内容がハッシュと一致しません（改ざんの可能性）', prev; return;
    end if;
    prev := r.hash;
    expected_seq := expected_seq + 1;
  end loop;
  return query select true, n, null::bigint, null::text, prev;
end $$;

-- ---------------------------------------------------------------------------
-- 通知
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid references public.contracts(id),
  contract_party_id uuid references public.contract_parties(id),
  channel text not null check (channel in ('email', 'line', 'sms')),
  type text not null,
  recipient text,
  status text not null check (status in ('sent', 'failed', 'logged')),
  provider_message_id text,
  cost_yen numeric(10, 3) not null default 0,
  error text,
  sent_at timestamptz not null default now()
);
create index notifications_contract_idx on public.notifications (contract_id);

-- ---------------------------------------------------------------------------
-- 署名の確定（1トランザクション）
-- ---------------------------------------------------------------------------
create or replace function public.finalize_signature(
  p_party_id uuid,
  p_signed_name text,
  p_signature_image text,
  p_consents jsonb,
  p_signed_at timestamptz,
  p_ip text,
  p_user_agent text,
  p_storage_path text,
  p_sha256 text,
  p_size_bytes integer,
  p_content_hash text
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  p record;
  c record;
  doc_id uuid;
begin
  select * into p from public.contract_parties where id = p_party_id for update;
  if p is null then raise exception 'party not found' using errcode = 'P0002'; end if;
  select * into c from public.contracts where id = p.contract_id for update;
  if c.status in ('signed', 'canceled') then
    raise exception 'contract is %', c.status using errcode = '55000';
  end if;
  if c.expires_at < now() then
    raise exception 'contract expired' using errcode = '55000';
  end if;
  if p.verified_at is null then
    raise exception 'signer not verified' using errcode = '55000';
  end if;
  if p.read_completed_at is null then
    raise exception 'signer has not read the document' using errcode = '55000';
  end if;

  update public.contract_parties set
    status = 'signed', signed_name = p_signed_name, signature_image = p_signature_image,
    consents = p_consents, signed_at = p_signed_at, signed_ip = p_ip, signed_user_agent = p_user_agent
  where id = p_party_id;

  insert into public.documents (contract_id, kind, storage_path, sha256, size_bytes)
  values (c.id, 'final', p_storage_path, p_sha256, p_size_bytes)
  returning id into doc_id;

  insert into public.timestamp_jobs (document_id) values (doc_id);

  insert into public.audit_events (contract_id, actor_type, actor_id, event_type, ip, user_agent, payload)
  values
    (c.id, 'signer', p_party_id::text, 'contract.signed', p_ip, p_user_agent,
      jsonb_build_object('signed_name', p_signed_name, 'signed_at', p_signed_at,
        'consents', p_consents, 'handwritten_signature', p_signature_image is not null)),
    (c.id, 'system', null, 'document.generated', p_ip, p_user_agent,
      jsonb_build_object('document_id', doc_id, 'sha256', p_sha256, 'size_bytes', p_size_bytes,
        'content_hash', p_content_hash));

  -- 最後に契約を署名済みにする（以降は変更不可）
  update public.contracts set status = 'signed', signed_at = p_signed_at, signed_content_hash = p_content_hash
  where id = c.id;

  return doc_id;
end $$;

-- ---------------------------------------------------------------------------
-- 検証（誰でも利用可。ハッシュのみで照合し、個人情報は返さない）
-- ---------------------------------------------------------------------------
create or replace function public.verify_document(p_sha256 text)
returns table (contract_id uuid, title text, signed_at timestamptz, tsa_time timestamptz, created_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select d.contract_id, c.title, c.signed_at,
    (select min(t.tsa_time) from public.document_timestamps t
      where t.document_id = d.id and t.target = 'pdf') as tsa_time,
    d.created_at
  from public.documents d join public.contracts c on c.id = d.contract_id
  where d.sha256 = lower(p_sha256)
$$;

-- ---------------------------------------------------------------------------
-- 権限: Supabaseの既定権限を取り消し、必要最小限だけ付与する
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
revoke update, delete, truncate on public.audit_events, public.documents, public.document_timestamps
  from service_role;

grant usage on schema public to anon, authenticated, service_role;
grant select on
  public.admins, public.settings, public.templates, public.template_versions, public.clauses,
  public.contacts, public.contracts, public.contracts_view, public.contract_parties,
  public.contract_values, public.documents, public.document_timestamps, public.timestamp_jobs,
  public.audit_events, public.notifications
to authenticated;
grant execute on function public.is_admin(), public.is_owner(), public.verify_audit_chain() to authenticated;
grant execute on function public.verify_document(text) to anon, authenticated;
grant execute on function public.finalize_signature(uuid, text, text, jsonb, timestamptz, text, text, text, text, integer, text)
  to service_role;

alter table public.admins enable row level security;
alter table public.settings enable row level security;
alter table public.templates enable row level security;
alter table public.template_versions enable row level security;
alter table public.clauses enable row level security;
alter table public.contacts enable row level security;
alter table public.contracts enable row level security;
alter table public.contract_parties enable row level security;
alter table public.contract_values enable row level security;
alter table public.access_tokens enable row level security;
alter table public.otp_challenges enable row level security;
alter table public.documents enable row level security;
alter table public.document_timestamps enable row level security;
alter table public.timestamp_jobs enable row level security;
alter table public.audit_events enable row level security;
alter table public.notifications enable row level security;

-- 管理者（aal2）は参照のみ。access_tokens と otp_challenges はポリシーなし＝参照も不可。
create policy admins_select on public.admins for select to authenticated using (public.is_admin());
create policy settings_select on public.settings for select to authenticated using (public.is_admin());
create policy templates_select on public.templates for select to authenticated using (public.is_admin());
create policy template_versions_select on public.template_versions for select to authenticated using (public.is_admin());
create policy clauses_select on public.clauses for select to authenticated using (public.is_admin());
create policy contacts_select on public.contacts for select to authenticated using (public.is_admin());
create policy contracts_select on public.contracts for select to authenticated using (public.is_admin());
create policy contract_parties_select on public.contract_parties for select to authenticated using (public.is_admin());
create policy contract_values_select on public.contract_values for select to authenticated using (public.is_admin());
create policy documents_select on public.documents for select to authenticated using (public.is_admin());
create policy document_timestamps_select on public.document_timestamps for select to authenticated using (public.is_admin());
create policy timestamp_jobs_select on public.timestamp_jobs for select to authenticated using (public.is_admin());
create policy audit_events_select on public.audit_events for select to authenticated using (public.is_admin());
create policy notifications_select on public.notifications for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- ストレージ: 確定版PDFのバケット（非公開・上書き/削除不可）
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create or replace function public.storage_documents_guard()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if old.bucket_id = 'documents' then
    raise exception 'immutable: objects in the documents bucket cannot be % ', lower(tg_op) using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
-- Supabaseの環境によっては storage スキーマへのトリガー作成が許可されないため、
-- 失敗しても移行全体は止めない（その場合もポリシー不在により anon/authenticated は変更不可、
-- かつ documents.sha256 との照合で差し替えは検知できる）。
do $$
begin
  create trigger storage_documents_guard before update or delete on storage.objects
    for each row execute function public.storage_documents_guard();
exception when insufficient_privilege then
  raise notice 'storage.objects trigger could not be created: %', sqlerrm;
end $$;
-- documentsバケットにはポリシーを作らない（anon/authenticatedは読み書き不可。service_roleのみ作成可能）
