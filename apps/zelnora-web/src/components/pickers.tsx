import { useSession } from "../lib/session";
import { Select } from "./ui";

export function ProductPicker({ value, onChange, allowAll }: { value: string; onChange: (v: string) => void; allowAll?: boolean }) {
  const s = useSession();
  return (
    <Select aria-label={s.labels().product} className="w-auto min-w-40" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll && <option value="">すべての{s.labels().product}</option>}
      {s.activeProducts.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

/** 「自分」「特定の担当者」「チーム全体」の切り替え（ZN-SALES-02, ZN-DLV-04） */
export function OwnerSwitch({ value, onChange, roles, productId }: { value: string; onChange: (v: string) => void; roles: string[]; productId?: string }) {
  const s = useSession();
  const people = s.users.filter((u) => u.active && roles.includes(u.role) && (!productId || u.productIds.includes(productId)));
  return (
    <Select aria-label="担当者" className="w-auto min-w-36" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="me">自分</option>
      <option value="all">チーム全体</option>
      {people.map((u) => (
        <option key={u.email} value={u.email}>
          {u.name}
        </option>
      ))}
    </Select>
  );
}

export function UserSelect({ value, onChange, roles, allowEmpty, label = "担当者" }: { value: string; onChange: (v: string) => void; roles?: string[]; allowEmpty?: boolean; label?: string }) {
  const s = useSession();
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">（未設定）</option>}
      {s.users
        .filter((u) => u.active && (!roles || roles.includes(u.role)))
        .map((u) => (
          <option key={u.email} value={u.email}>
            {u.name}
          </option>
        ))}
    </Select>
  );
}
