// Apps Script 実行環境への依存をまとめる（テストでは使わない）
import type { BookLike } from "./sheets-store";

export function prop(name: string): string {
  return PropertiesService.getScriptProperties().getProperty(name) ?? "";
}

export function setProp(name: string, value: string): void {
  PropertiesService.getScriptProperties().setProperty(name, value);
}

export function openBook(id: string): BookLike {
  return SpreadsheetApp.openById(id) as unknown as BookLike;
}
