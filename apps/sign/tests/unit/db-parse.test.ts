import { describe, expect, it } from "vitest";
import { pgTimestampToIso } from "@/lib/server/db";

describe("timestamptzの変換", () => {
  it("オフセット付きの値をUTCのISO文字列にする", () => {
    expect(pgTimestampToIso("2026-09-30 16:17:05.664123+00")).toBe("2026-09-30T16:17:05.664Z");
    expect(pgTimestampToIso("2026-10-01 01:17:05+09")).toBe("2026-09-30T16:17:05.000Z");
    expect(pgTimestampToIso("2026-10-01 01:47:05+09:30")).toBe("2026-09-30T16:17:05.000Z");
  });
});
