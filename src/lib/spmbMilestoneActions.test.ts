import { describe, expect, it } from "vitest";
import { getAvailableSpmbMilestones } from "./spmbMilestoneActions";

describe("SPMB milestone tindakan", () => {
  it("memulai dari pencatatan tes bila belum tes", () => {
    expect(getAvailableSpmbMilestones({}, false)).toEqual(["tes"]);
    expect(getAvailableSpmbMilestones({}, true)).toEqual(["tes"]);
  });

  it("menawarkan keputusan lulus/tidak lulus sebelum aktif", () => {
    expect(getAvailableSpmbMilestones({ spmb_tanggal_tes: "2026-09-30" }, false))
      .toEqual(["lulus", "tidak_lulus"]);
  });

  it("hanya boleh melengkapi lulus untuk murid yang sudah aktif", () => {
    expect(getAvailableSpmbMilestones({ spmb_tanggal_tes: "2026-09-30" }, true))
      .toEqual(["lulus"]);
  });

  it("tetap menawarkan daftar ulang untuk TK yang sudah aktif dan lulus", () => {
    expect(getAvailableSpmbMilestones({
      spmb_tanggal_tes: "2026-09-30",
      spmb_status_kelulusan: "lulus",
    }, true)).toEqual(["daftar_ulang"]);
  });

  it("tidak membuat pencatatan ganda atau meluluskan yang tidak lulus", () => {
    expect(getAvailableSpmbMilestones({
      spmb_tanggal_tes: "2026-09-30",
      spmb_status_kelulusan: "lulus",
      spmb_tanggal_daftar_ulang: "2026-10-04",
    }, true)).toEqual([]);
    expect(getAvailableSpmbMilestones({
      spmb_tanggal_tes: "2026-09-30",
      spmb_status_kelulusan: "tidak_lulus",
    }, false)).toEqual([]);
    expect(getAvailableSpmbMilestones(null, false)).toEqual([]);
  });
});
