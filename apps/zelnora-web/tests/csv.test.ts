import { describe, expect, it } from "vitest";
import { guessField, parseCsv } from "../src/lib/csv";

describe("CSVの読み込み", () => {
  it("引用符・改行・BOMを扱える", () => {
    expect(parseCsv('﻿氏名,メール\r\n"山田, 太郎",a@example.com\n"改行\nあり","x""y"\n')).toEqual([
      ["氏名", "メール"],
      ["山田, 太郎", "a@example.com"],
      ["改行\nあり", 'x"y'],
    ]);
  });
  it("見出しから項目を推測する", () => {
    expect(["お名前", "フリガナ", "メールアドレス", "電話番号", "会社名", "流入経路", "備考", "年齢"].map(guessField)).toEqual(["name", "kana", "email", "phone", "company", "source", "note", ""]);
  });
});
