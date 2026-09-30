import { addDays, today, systemClock } from "@zelnora/core";
import { useState } from "react";
import { call } from "../lib/api";
import { Alert, Button, Field, Input, Modal, Textarea } from "./ui";

/** 次のアクションの完了と、次のアクションの入力（ZN-SALES-05） */
export function CompleteActionDialog({ dealId, current, onClose, onDone }: { dealId: string; current: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(addDays(today(systemClock), 3));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title={`完了：${current}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await call("deals.completeAction", { id: dealId, next: title.trim() ? { title, due } : null, note });
                onDone();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            完了にする
          </Button>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="結果のメモ">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <p className="text-sm font-semibold">次のアクション</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
        <Field label="内容">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：資料を送る" autoFocus />
        </Field>
        <Field label="期限">
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/** 延期（明日・来週・日付指定） */
export function PostponeButtons({ refs, onDone }: { refs: { dealId?: string; deliveryId?: string }; onDone: () => void }) {
  const [custom, setCustom] = useState(false);
  const [date, setDate] = useState(addDays(today(systemClock), 1));
  const t = today(systemClock);
  const go = async (due: string) => {
    await call("actions.postpone", { ...refs, due });
    onDone();
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Button size="sm" variant="ghost" onClick={() => go(addDays(t, 1))}>
        明日
      </Button>
      <Button size="sm" variant="ghost" onClick={() => go(addDays(t, 7))}>
        来週
      </Button>
      {custom ? (
        <>
          <Input type="date" className="w-36 py-1" value={date} onChange={(e) => setDate(e.target.value)} aria-label="延期する日付" />
          <Button size="sm" variant="secondary" onClick={() => go(date)}>
            延期
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setCustom(true)}>
          日付指定
        </Button>
      )}
    </span>
  );
}
