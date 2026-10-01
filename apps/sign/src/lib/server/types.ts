import type { ConfirmScreenItems, DocNode, KeyClause } from "../contract/document";
import type { VariableDef } from "../contract/variables";

export interface AdminRow {
  id: string;
  email: string;
  display_name: string | null;
  role: "owner" | "staff";
  mfa_enabled: boolean;
  disabled_at: string | null;
  created_at: string;
}

export interface SettingsRow {
  organization_name: string;
  organization_representative: string;
  admin_notify_email: string | null;
  default_expiry_days: number;
  reminder_after_send_days: number;
  reminder_before_expiry_days: number;
  auto_reminder_enabled: boolean;
  anonymize_after_days: number;
  daily_hash_email_enabled: boolean;
  privacy_policy_url: string | null;
  cost_email_yen: string;
  cost_sms_yen: string;
  cost_timestamp_yen: string;
}

export interface TemplateRow {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateVersionRow {
  id: string;
  template_id: string;
  version_no: number;
  body: DocNode;
  body_hash: string | null;
  variables: VariableDef[];
  confirm_screen_items: ConfirmScreenItems;
  key_clauses: KeyClause[];
  amount_variable_key: string | null;
  transaction_date_variable_key: string | null;
  counterparty_variable_key: string | null;
  email_subject: string;
  email_body: string;
  require_sms: boolean;
  created_at: string;
  published_at: string | null;
}

export interface ClauseRow {
  id: string;
  name: string;
  category: string;
  body: DocNode;
  created_at: string;
  updated_at: string;
}

export interface ContactRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  line_user_id: string | null;
  tags: string[];
  note: string;
  anonymized_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ContractStatus = "draft" | "sent" | "viewed" | "signed" | "expired" | "canceled";

export interface ContractRow {
  id: string;
  /** 既存の契約書を格納したもの（source = imported）は null */
  template_version_id: string | null;
  template_body_hash: string | null;
  source: "template" | "imported";
  external_ref: string | null;
  note: string | null;
  title: string;
  status: ContractStatus;
  effective_status?: ContractStatus;
  amount: string | null;
  transaction_date: string | null;
  counterparty_name: string | null;
  delivery_channels: string[];
  expires_at: string;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  anonymized_at: string | null;
  signed_content_hash: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PartyRow {
  id: string;
  contract_id: string;
  contact_id: string | null;
  role: "signer";
  sign_order: number;
  status: "pending" | "viewed" | "verified" | "signed";
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  delivery_channels: string[];
  verified_email: string | null;
  verified_method: string | null;
  verified_at: string | null;
  read_completed_at: string | null;
  consents: Record<string, unknown>;
  signed_name: string | null;
  signature_image: string | null;
  signed_at: string | null;
  signed_ip: string | null;
  signed_user_agent: string | null;
  last_reminded_at: string | null;
}

export interface AccessTokenRow {
  id: string;
  contract_party_id: string;
  token_hash: string;
  token_ciphertext: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  contract_id: string;
  /** final＝確定版PDF、original＝格納した既存の契約書 */
  kind: "final" | "original";
  filename: string | null;
  storage_path: string;
  sha256: string;
  size_bytes: number;
  pades_signed: boolean;
  created_at: string;
}

export interface TimestampRow {
  id: string;
  document_id: string | null;
  contract_id: string;
  target: "pdf" | "content";
  hashed_message: string;
  tsa_url: string;
  tsa_token: string;
  tsa_time: string;
  tsa_serial: string | null;
  created_at: string;
}

export interface AuditRow {
  id: string;
  seq: string;
  contract_id: string | null;
  actor_type: string;
  actor_id: string | null;
  event_type: string;
  ip: string | null;
  user_agent: string | null;
  payload: Record<string, unknown>;
  prev_hash: string | null;
  hash: string;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  contract_id: string | null;
  channel: string;
  type: string;
  recipient: string | null;
  status: string;
  cost_yen: string;
  error: string | null;
  sent_at: string;
}

/** 管理者の操作主体 */
export interface Actor {
  id: string;
  email: string;
  role: "owner" | "staff";
}

export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string = "bad_request",
    readonly status = 400,
  ) {
    super(message);
  }
}
