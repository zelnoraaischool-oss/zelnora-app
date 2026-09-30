// 初期テンプレート：AIエンジニア育成マンツーマン講座 受講契約書
// ※別添のdocx（既存の受講契約書）は受領していないため、一般的な受講契約の構成で作成した雛形です。
//   実運用前に既存の契約書の文言へ差し替え、弁護士の確認を受けてください（docs/DECISIONS.md 参照）。
import type { DocNode, KeyClause, ConfirmScreenItems } from "../contract/document";
import type { VariableDef } from "../contract/variables";

const t = (text: string, bold = false): DocNode => ({ type: "text", text, ...(bold ? { marks: [{ type: "bold" }] } : {}) });
const v = (key: string): DocNode => ({ type: "variable", attrs: { key } });
const p = (...content: (DocNode | string)[]): DocNode => ({
  type: "paragraph",
  content: content.map((c) => (typeof c === "string" ? t(c) : c)),
});
const article = (title: string): DocNode => ({ type: "heading", attrs: { level: 2, numbered: true }, content: [t(title)] });
const ol = (...items: (DocNode | string)[][]): DocNode => ({
  type: "orderedList",
  attrs: { start: 1 },
  content: items.map((c) => ({ type: "listItem", content: [p(...c)] })),
});

export const COURSE_TEMPLATE_NAME = "AIエンジニア育成マンツーマン講座 受講契約書";

export const courseVariables: VariableDef[] = [
  { key: "受講者氏名", type: "text", filledBy: "admin", required: true, sample: "山田 太郎" },
  { key: "プラン名", type: "text", filledBy: "admin", required: true, defaultValue: "マンツーマン講座", sample: "マンツーマン講座 3か月プラン" },
  { key: "受講料", type: "money", filledBy: "admin", required: true, defaultValue: "30000", rules: { min: 0 } },
  { key: "受講期間（月）", type: "number", filledBy: "admin", required: true, defaultValue: "3", rules: { min: 1, max: 24 } },
  { key: "受講開始日", type: "date", filledBy: "admin", required: true },
  { key: "支払方法", type: "select", filledBy: "admin", required: true, options: ["銀行振込", "クレジットカード"], defaultValue: "銀行振込" },
  { key: "支払期限", type: "date", filledBy: "admin", required: true },
  { key: "契約日", type: "date", filledBy: "admin", required: true, help: "取引年月日として検索に使われます" },
  { key: "受講者住所", type: "address", filledBy: "signer", required: true, rules: { maxLength: 200 } },
  { key: "受講者電話番号", type: "phone", filledBy: "signer", required: true },
  { key: "生年月日", type: "date", filledBy: "signer", required: false },
];

export const courseBody: DocNode = {
  type: "doc",
  content: [
    p(
      v("受講者氏名"),
      "（以下「甲」という。）と",
      v("発注者名"),
      "（以下「乙」という。）は、乙が提供する「AIエンジニア育成マンツーマン講座」（以下「本講座」という。）の受講について、次のとおり契約（以下「本契約」という。）を締結する。",
    ),
    article("（目的）"),
    p("本契約は、乙が甲に対して本講座を提供し、甲がこれを受講することに関する条件を定めることを目的とする。"),
    article("（講座の内容）"),
    ol(
      ["本講座の内容は、", v("プラン名"), "とし、講師による個別指導（オンライン）、課題の添削、質問対応その他乙が定めるサービスとする。"],
      ["具体的な指導内容・日程は、甲の習熟度に応じて甲乙協議のうえ決定する。"],
    ),
    article("（受講期間）"),
    p("受講期間は、", v("受講開始日"), "から", v("受講期間（月）"), "か月間とする。"),
    article("（受講料及び支払方法）"),
    ol(
      ["甲は乙に対し、本講座の受講料として金", v("受講料"), "（消費税込み）を支払う。"],
      ["甲は、前項の受講料を", v("支払期限"), "までに、", v("支払方法"), "により支払う。振込手数料その他支払に要する費用は甲の負担とする。"],
    ),
    article("（受講の予約・変更）"),
    p("個別指導の日時の予約及び変更は、乙が定める方法により、原則として指導日の前日までに行うものとする。無断で欠席した回は、受講したものとみなす。"),
    article("（禁止事項）"),
    p("甲は、本講座の受講にあたり、次の行為をしてはならない。"),
    {
      type: "bulletList",
      content: [
        "教材・動画その他乙が提供する資料を、第三者に開示・譲渡・販売し、又は複製・公開すること",
        "受講の権利を第三者に譲渡し、又は第三者に受講させること",
        "講師その他の受講者に対する誹謗中傷、迷惑行為",
        "その他、法令又は公序良俗に反する行為",
      ].map((s) => ({ type: "listItem", content: [p(s)] })),
    },
    article("（知的財産権）"),
    p("本講座で提供する教材その他一切の資料に関する著作権その他の知的財産権は、乙又は正当な権利者に帰属する。甲は、自己の学習の目的の範囲内でのみこれを利用できる。"),
    article("（秘密保持）"),
    p("甲及び乙は、本契約に関して知り得た相手方の技術上又は営業上の秘密を、相手方の事前の書面による承諾なく第三者に開示し、又は本契約の目的以外に利用してはならない。"),
    article("（個人情報の取扱い）"),
    p("乙は、甲の個人情報を、本講座の提供、連絡、受講料の請求その他本契約の履行に必要な範囲でのみ利用し、乙のプライバシーポリシーに従って適切に管理する。"),
    article("（中途解約及び返金）"),
    ol(
      ["甲は、乙に対して書面又は電磁的方法により通知することで、本契約を中途解約することができる。"],
      [t("受講開始後の中途解約の場合、受講料の返金は、法令に定める場合を除き、行わないものとする。", true)],
      ["特定商取引に関する法律その他の法令により甲に認められる権利（契約の申込みの撤回等を含む。）は、本条の定めにかかわらず妨げられない。"],
    ),
    article("（契約の解除）"),
    p("甲又は乙は、相手方が本契約に違反し、相当の期間を定めて催告したにもかかわらず是正されないときは、本契約を解除することができる。"),
    article("（反社会的勢力の排除）"),
    p("甲及び乙は、自己が暴力団、暴力団員、暴力団関係企業その他の反社会的勢力に該当しないこと、及び将来にわたっても該当しないことを表明し、保証する。相手方がこれに違反した場合、何らの催告を要せず、本契約を解除することができる。"),
    article("（免責）"),
    p("乙は、本講座の受講により、甲が特定の資格の取得、就職、転職又は収入の増加等の成果を得ることを保証するものではない。"),
    article("（協議）"),
    p("本契約に定めのない事項又は本契約の解釈に疑義が生じた事項については、甲乙誠実に協議のうえ解決する。"),
    article("（合意管轄）"),
    p("本契約に関する紛争については、乙の所在地を管轄する地方裁判所を第一審の専属的合意管轄裁判所とする。"),
    { type: "horizontalRule" },
    p("本契約の成立を証するため、本契約書を電磁的記録により作成し、甲乙がそれぞれ電子署名等の方法により合意のうえ、その電磁的記録を各自保管する。"),
    p("契約締結日：", v("契約締結日")),
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", attrs: { colspan: 1, rowspan: 1 }, content: [p("甲（受講者）")] },
            { type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [p("氏名：", v("受講者氏名")), p("住所：", v("受講者住所")), p("電話番号：", v("受講者電話番号"))] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", attrs: { colspan: 1, rowspan: 1 }, content: [p("乙（事業者）")] },
            { type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [p(v("発注者名"))] },
          ],
        },
      ],
    },
  ],
};

export const courseConfirmItems: ConfirmScreenItems = {
  service: "{{プラン名}}（講師によるオンライン個別指導・課題添削・質問対応）",
  price: "{{受講料}}（消費税込み）",
  payment: "{{支払方法}}により、{{支払期限}}までにお支払いください",
  delivery: "{{受講開始日}}から{{受講期間（月）}}か月間",
  period: "本契約書の署名URLの有効期限まで",
  cancellation: "書面又は電磁的方法による通知で中途解約できます。受講開始後の中途解約の場合、法令に定める場合を除き受講料は返金されません（第10条）。",
};

export const courseKeyClauses: KeyClause[] = [
  { id: "refund", title: "受講開始後の返金について（第10条）", description: "受講開始後に中途解約した場合、法令に定める場合を除き、受講料は返金されません。" },
  { id: "noshow", title: "無断欠席について（第5条）", description: "無断で欠席した回は、受講したものとみなされます。" },
];

/** 条項ライブラリの初期データ */
export const defaultClauses: { name: string; category: string; body: DocNode }[] = [
  {
    name: "秘密保持",
    category: "一般条項",
    body: { type: "doc", content: [article("（秘密保持）"), p("甲及び乙は、本契約に関して知り得た相手方の技術上又は営業上の秘密を、相手方の事前の書面による承諾なく第三者に開示し、又は本契約の目的以外に利用してはならない。")] },
  },
  {
    name: "個人情報の取扱い",
    category: "一般条項",
    body: { type: "doc", content: [article("（個人情報の取扱い）"), p("乙は、甲の個人情報を、本契約の履行に必要な範囲でのみ利用し、乙のプライバシーポリシーに従って適切に管理する。")] },
  },
  {
    name: "反社会的勢力の排除",
    category: "一般条項",
    body: {
      type: "doc",
      content: [
        article("（反社会的勢力の排除）"),
        p("甲及び乙は、自己が暴力団、暴力団員、暴力団関係企業その他の反社会的勢力に該当しないこと、及び将来にわたっても該当しないことを表明し、保証する。相手方がこれに違反した場合、何らの催告を要せず、本契約を解除することができる。"),
      ],
    },
  },
  {
    name: "合意管轄",
    category: "一般条項",
    body: { type: "doc", content: [article("（合意管轄）"), p("本契約に関する紛争については、乙の所在地を管轄する地方裁判所を第一審の専属的合意管轄裁判所とする。")] },
  },
];
