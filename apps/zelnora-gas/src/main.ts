// Apps Script のエントリーポイント。build.mjs がこれらをグローバル関数として公開する。
import {
  type ApiRequest,
  type ApiResponse,
  applyEsignStatus,
  bootstrapOwner,
  can,
  type Ctx,
  type DataSource,
  getSettings,
  handleApi,
  type Handler,
  importWithLog,
  isReadOnly,
  listUsers,
  monthlySheet,
  retryFailedImports,
  runDailyJobs,
  saveDataSource,
  syncEsignStatuses,
  systemClock,
  updateSettings,
  ZnError,
} from "@zelnora/core";
import { verifyIdToken } from "./auth";
import { esignGateway, type EsignWebhookBody, verifyEsignWebhook } from "./esign";
import { ensureFormTriggers, inspectForm, payloadFromResponse, prefillUrl } from "./forms";
import { openBook, prop, setProp } from "./gas-env";
import { GasNotifier } from "./notifier";
import { SheetsStore, testDataSource, writeTable } from "./sheets-store";

const DB_PROP = "DB_SPREADSHEET_ID";

interface Runtime {
  ctx: Ctx;
  store: SheetsStore;
  notifier: GasNotifier;
}

function runtime(): Runtime {
  const dbId = prop(DB_PROP);
  if (!dbId) throw new Error("初期設定がまだです。Apps Script のエディタで setup を実行してください");
  const notifier = new GasNotifier();
  const problems: { ds: DataSource; message: string }[] = [];
  const store = new SheetsStore(openBook, dbId, (ds, message) => problems.push({ ds, message }));
  const ctx: Ctx = {
    store,
    clock: systemClock,
    notifier,
    prefillUrl: (formId, values) => prefillUrl(getSettings(ctx).forms, formId, values),
  };
  ctx.esign = esignGateway(() => getSettings(ctx).esign?.baseUrl ?? "");
  // 見出しの変更を検知したら、オーナーに知らせる（ZN-SET-11）
  const original = notifier.deliver.bind(notifier);
  notifier.deliver = (settings, users, appUrl) => {
    for (const p of problems) {
      notifier.send({ kind: "datasource.check", to: users.filter((u) => u.role === "owner").map((u) => u.email), title: `データソースの確認が必要です：${p.ds.name}`, body: p.message });
    }
    problems.length = 0;
    original(settings, users, appUrl);
  };
  return { ctx, store, notifier };
}

function finish(rt: Runtime): void {
  rt.store.flush();
  try {
    rt.notifier.deliver(rt.store.getSettings(), listUsers(rt.ctx), prop("APP_URL"));
  } catch (e) {
    console.warn("notification failed", e);
  }
}

function withLock<T>(fn: () => T): T {
  const lock = LockService.getScriptLock();
  lock.waitLock(30_000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** 管理シートへ「月次売上」タブとデータソース一覧を書き出す（ZN-REV-07, 10.4） */
function exportSummaries(rt: Runtime): void {
  const s = getSettings(rt.ctx);
  const summary = s.dataSources.find((d) => d.entity === "summary" && d.status !== "stopped");
  const book = openBook(summary?.spreadsheetId || prop(DB_PROP));
  writeTable(book, summary?.sheetName || "月次売上", monthlySheet(rt.ctx));
  const registry = s.dataSources.find((d) => d.entity === "registry" && d.status !== "stopped");
  const rbook = openBook(registry?.spreadsheetId || prop(DB_PROP));
  writeTable(rbook, registry?.sheetName || "データソース一覧", [
    ["データソース名", "スプレッドシートID", "URL", "用途", "タブ", "見出し行", "列の対応", "状態", "最終確認日時"],
    ...s.dataSources.map((d) => [
      d.name,
      d.spreadsheetId,
      `https://docs.google.com/spreadsheets/d/${d.spreadsheetId}`,
      d.entity,
      d.sheetName,
      d.headerRow,
      Object.entries(d.columns).map(([k, h]) => `${k}=${h}`).join(" / "),
      d.status === "ok" ? "正常" : d.status === "check" ? "要確認" : "停止",
      d.lastCheckedAt ?? "",
    ]),
  ]);
}

/** Apps Script でだけ動く操作 */
const gasHandlers: Record<string, Handler> = {
  "dataSources.test": (ctx, user, p) => {
    if (!can(user, "settings.sources")) throw new ZnError("権限がありません", "forbidden");
    const ds = getSettings(ctx).dataSources.find((d) => d.id === p.id) ?? (p.dataSource as DataSource);
    if (!ds) throw new ZnError("データソースが見つかりません", "not_found");
    const r = testDataSource(openBook, ds);
    if (getSettings(ctx).dataSources.some((d) => d.id === ds.id)) {
      saveDataSource(ctx, user, { ...ds, status: r.ok ? "ok" : "check", lastCheckedAt: new Date().toISOString(), message: r.message });
    }
    return r;
  },
  "forms.inspect": (_ctx, user, p) => {
    if (!can(user, "settings.sources")) throw new ZnError("権限がありません", "forbidden");
    return inspectForm(String(p.formId));
  },
  "forms.installTriggers": (ctx, user) => {
    if (!can(user, "settings.sources")) throw new ZnError("権限がありません", "forbidden");
    return { installed: ensureFormTriggers(getSettings(ctx).forms) };
  },
  "summary.export": (ctx, user) => {
    if (!can(user, "revenues.summary")) throw new ZnError("権限がありません", "forbidden");
    exportSummaries({ ctx, store: ctx.store as SheetsStore, notifier: ctx.notifier as GasNotifier });
    return true;
  },
};

const SUMMARY_TRIGGERS = /^(revenues\.|months\.|deals\.(move|refreshEsign)|deliveries\.finish|settings\.(savePlan|revisePrice|saveProduct))/;

function json(res: unknown) {
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

/** Web API（Cloudflare Pages の画面から text/plain の POST で呼ぶ） */
export function doPost(e: GoogleAppsScript.Events.DoPost) {
  let body: { idToken?: string; kind?: string } & ApiRequest;
  try {
    body = JSON.parse(e.postData?.contents || "{}");
  } catch {
    return json({ ok: false, error: "リクエストの形式が正しくありません", code: "bad_request" });
  }
  if (body.kind === "esign.webhook") return esignWebhook(body as unknown as EsignWebhookBody);
  let email: string;
  try {
    email = verifyIdToken(body.idToken ?? "");
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err), code: "unauthorized" });
  }
  const run = (): ApiResponse => {
    const rt = runtime();
    const res = handleApi(rt.ctx, email, { action: body.action, params: body.params }, gasHandlers);
    // 読み取り専用の操作でも、ログイン時の自動登録（許可ドメイン）などの書き込みは保存する
    if (isReadOnly(body.action)) rt.store.flush();
    if (res.ok && !isReadOnly(body.action)) {
      finish(rt);
      if (SUMMARY_TRIGGERS.test(body.action)) {
        try {
          exportSummaries(rt);
        } catch (err) {
          console.warn("summary export failed", err);
        }
      }
    }
    return res;
  };
  try {
    return json(isReadOnly(body.action) ? run() : withLock(run));
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err), code: "server_error" });
  }
}

/** 電子契約システムからの通知（署名完了・取消・期限切れ） */
function esignWebhook(body: EsignWebhookBody) {
  let event: ReturnType<typeof verifyEsignWebhook>;
  try {
    event = verifyEsignWebhook(body);
  } catch (err) {
    console.warn("esign webhook rejected", err instanceof Error ? err.message : err);
    return json({ ok: false, error: "通知を受け付けられません", code: "unauthorized" });
  }
  try {
    const r = withLock(() => {
      const rt = runtime();
      const res = applyEsignStatus(rt.ctx, event);
      finish(rt);
      if (res.won) {
        try {
          exportSummaries(rt);
        } catch (err) {
          console.warn("summary export failed", err);
        }
      }
      return res;
    });
    return json({ ok: true, data: r });
  } catch (err) {
    // ok:false を返すと電子契約システムが後で再送する
    return json({ ok: false, error: err instanceof Error ? err.message : String(err), code: "server_error" });
  }
}

export function doGet() {
  return json({ ok: true, name: "Zelnora API", configured: !!prop(DB_PROP) });
}

/** フォーム送信トリガー（5.2） */
export function onFormSubmitTrigger(e: GoogleAppsScript.Events.FormsOnFormSubmit) {
  withLock(() => {
    const rt = runtime();
    importWithLog(rt.ctx, payloadFromResponse(e.source.getId(), e.response));
    finish(rt);
    exportSummaries(rt);
  });
}

/** 15分ごとの見直し処理：失敗した取り込みの再試行、署名待ちの電子契約の状態の確認 */
export function retryImportsJob() {
  withLock(() => {
    const rt = runtime();
    retryFailedImports(rt.ctx);
    try {
      syncEsignStatuses(rt.ctx);
    } catch (err) {
      console.warn("esign sync failed", err);
    }
    finish(rt);
  });
}

/** 毎日の処理：遅れの通知、終了日の確認、月末の締め依頼、集計の書き出し */
export function dailyJob() {
  withLock(() => {
    const rt = runtime();
    runDailyJobs(rt.ctx);
    finish(rt);
    exportSummaries(rt);
  });
}

/**
 * 初期設定（エディタから1回実行する）
 * - DBスプレッドシートを作る（DB_SPREADSHEET_ID が未設定の場合）
 * - 実行したアカウントをオーナーとして登録する
 * - 15分ごと・毎日のトリガーを入れる
 */
export function setup() {
  let dbId = prop(DB_PROP);
  if (!dbId) {
    dbId = SpreadsheetApp.create("Zelnora DB").getId();
    setProp(DB_PROP, dbId);
  }
  const rt = runtime();
  const me = Session.getEffectiveUser().getEmail();
  if (!listUsers(rt.ctx).length) bootstrapOwner(rt.ctx, me, me.split("@")[0] ?? me);
  const s = getSettings(rt.ctx);
  if (s.version === 0) {
    const owner = listUsers(rt.ctx).find((u) => u.role === "owner")!;
    updateSettings(rt.ctx, owner, (x) => {
      x.organizationName = x.organizationName || "（事業者名を設定してください）";
    }, "初期設定", { permission: "settings.sources" });
  }
  finish(rt);
  const handlers = new Set(ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction()));
  if (!handlers.has("retryImportsJob")) ScriptApp.newTrigger("retryImportsJob").timeBased().everyMinutes(15).create();
  if (!handlers.has("dailyJob")) ScriptApp.newTrigger("dailyJob").timeBased().everyDays(1).atHour(7).inTimezone("Asia/Tokyo").create();
  ensureFormTriggers(getSettings(rt.ctx).forms);
  console.log(`DB: https://docs.google.com/spreadsheets/d/${dbId}  オーナー: ${me}`);
}
