"use client";

import type { VariableDef } from "@/lib/contract/variables";
import { Field, Input, Select, Textarea } from "./ui";

export function VariableInput({
  def,
  value,
  onChange,
  error,
}: {
  def: VariableDef;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const r = def.rules ?? {};
  const common = { id: `var-${def.key}`, name: def.key, "aria-invalid": !!error || undefined } as const;
  let control: React.ReactNode;
  switch (def.type) {
    case "longtext":
      control = <Textarea {...common} rows={3} value={value} maxLength={r.maxLength} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "date":
      control = <Input {...common} type="date" value={value} min={r.minDate} max={r.maxDate} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "number":
    case "money":
      control = (
        <div className="flex items-center gap-2">
          <Input {...common} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} />
          {def.type === "money" && <span className="text-sm text-slate-600">円</span>}
        </div>
      );
      break;
    case "email":
      control = <Input {...common} type="email" autoComplete="email" value={value} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "phone":
      control = <Input {...common} type="tel" autoComplete="tel" value={value} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "address":
      control = <Textarea {...common} rows={2} autoComplete="street-address" value={value} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "select":
      control = (
        <Select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">選択してください</option>
          {(def.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
      break;
    case "checkbox":
      return (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5"
            checked={value === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          />
          <span>
            {def.key}
            {def.required && <span className="ml-1 text-xs text-rose-600">必須</span>}
            {error && <span className="block text-xs text-rose-600">{error}</span>}
          </span>
        </label>
      );
    default:
      control = <Input {...common} value={value} maxLength={r.maxLength} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <Field label={def.key} required={def.required} hint={def.help} error={error}>
      {control}
    </Field>
  );
}
