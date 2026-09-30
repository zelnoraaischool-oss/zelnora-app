// Googleフォームとの連携：質問ID（item ID）で回答を読み、事前入力URLを作る（10.3）
import type { FormMapping, FormResponsePayload } from "@zelnora/core";

function answerText(r: GoogleAppsScript.Forms.ItemResponse): string {
  const v = r.getResponse() as unknown;
  if (Array.isArray(v)) return v.map((x) => (Array.isArray(x) ? x.join(" / ") : String(x))).join(", ");
  return v === null || v === undefined ? "" : String(v);
}

export function payloadFromResponse(formId: string, response: GoogleAppsScript.Forms.FormResponse): FormResponsePayload {
  const answers: Record<string, string> = {};
  const questions: Record<string, string> = {};
  for (const r of response.getItemResponses()) {
    const id = String(r.getItem().getId());
    answers[id] = answerText(r);
    questions[id] = r.getItem().getTitle();
  }
  const email = response.getRespondentEmail?.();
  if (email) answers["__respondentEmail"] = email;
  return { formId, responseId: response.getId(), submittedAt: response.getTimestamp().toISOString(), answers, questions };
}

/** フォームの質問一覧（対応付けの画面で使う） */
export function inspectForm(formId: string) {
  const form = FormApp.openById(formId);
  return {
    id: form.getId(),
    title: form.getTitle(),
    publishedUrl: form.getPublishedUrl(),
    destinationId: (() => {
      try {
        return form.getDestinationId();
      } catch {
        return "";
      }
    })(),
    items: form.getItems().map((i) => ({ id: String(i.getId()), title: i.getTitle(), type: String(i.getType()) })),
  };
}

/** 名前とメールを入力済みにした登録フォームのURL（ZN-SALES-11） */
export function prefillUrl(forms: FormMapping[], formId: string, values: { name?: string; email?: string }): string | null {
  const mapping = forms.find((f) => f.id === formId);
  try {
    const form = FormApp.openById(formId);
    const resp = form.createResponse();
    const set = (qid: string | undefined, value: string | undefined) => {
      if (!qid || !value) return;
      const item = form.getItemById(Number(qid));
      if (!item) return;
      if (item.getType() === FormApp.ItemType.TEXT) resp.withItemResponse(item.asTextItem().createResponse(value));
      if (item.getType() === FormApp.ItemType.PARAGRAPH_TEXT) resp.withItemResponse(item.asParagraphTextItem().createResponse(value));
    };
    set(mapping?.prefillQuestions?.name, values.name);
    set(mapping?.prefillQuestions?.email, values.email);
    return resp.toPrefilledUrl();
  } catch {
    return mapping?.publishedUrl ?? null;
  }
}

/** フォームごとに送信トリガーを入れる（重複しないよう既存を確認） */
export function ensureFormTriggers(forms: FormMapping[]): number {
  const existing = new Set(
    ScriptApp.getProjectTriggers()
      .filter((t) => t.getHandlerFunction() === "onFormSubmitTrigger")
      .map((t) => t.getTriggerSourceId()),
  );
  let n = 0;
  for (const f of forms.filter((x) => x.active)) {
    if (existing.has(f.id)) continue;
    ScriptApp.newTrigger("onFormSubmitTrigger").forForm(f.id).onFormSubmit().create();
    n++;
  }
  return n;
}
