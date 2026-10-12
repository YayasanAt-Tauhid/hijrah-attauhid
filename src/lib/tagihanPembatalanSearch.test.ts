import { describe, it, expect } from "vitest";
import {
  normalizeCancelSearchTerm, escapeCancelIlike, collectCancelStudentIds,
  MAX_CANCEL_SEARCH_STUDENTS, MIN_CANCEL_SEARCH_LENGTH, withinCancelDueDateRange,
} from "./tagihanPembatalanSearch";

describe("pencarian tagihan yang boleh dibatalkan", () => {
  it("requires a meaningful query and normalizes whitespace", () => {
    expect(MIN_CANCEL_SEARCH_LENGTH).toBe(3);
    expect(normalizeCancelSearchTerm("  Al   Akhtar  ")).toBe("Al Akhtar");
  });
  it("escapes ILIKE metacharacters instead of broadening queries", () => {
    expect(escapeCancelIlike("Ab_%\\")).toBe("Ab\\_\\%\\\\");
  });
  it("deduplicates students returned from NIS and name searches", () => {
    expect(collectCancelStudentIds([{ id: "student1" }], [{ id: "student1" }, { id: "student2" }]))
      .toEqual(["student1", "student2"]);
  });
  it("refuses truncated multi-student search results", () => {
    const tooMany = Array.from({ length: MAX_CANCEL_SEARCH_STUDENTS + 1 }, (_, i) => ({ id: String(i) }));
    expect(() => collectCancelStudentIds(tooMany, [])).toThrow(/Terlalu banyak siswa/);
    expect(() => collectCancelStudentIds(tooMany.slice(0, 12), tooMany.slice(12))).toThrow(/Terlalu banyak siswa/);
  });
  it("shows exactly August–December 2026 when the due-date range is used", () => {
    for (let month = 8; month <= 12; month++) {
      expect(withinCancelDueDateRange({
        jatuh_tempo: "2026-" + String(month).padStart(2, "0") + "-10",
      }, "2026-08-01", "2026-12-31")).toBe(true);
    }
    expect(withinCancelDueDateRange({ jatuh_tempo: "2027-01-10" }, "2026-08-01", "2026-12-31")).toBe(false);
    expect(withinCancelDueDateRange({ jatuh_tempo: "2026-07-10" }, "2026-08-01", "2026-12-31")).toBe(false);
    expect(withinCancelDueDateRange({ jatuh_tempo: null }, "2026-08-01", "2026-12-31")).toBe(false);
  });

  it("does not invent results for missing students", () => {
    expect(collectCancelStudentIds([], [])).toEqual([]);
  });
});
