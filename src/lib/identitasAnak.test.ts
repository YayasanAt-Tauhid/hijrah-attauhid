import { describe, expect, it } from "vitest";
import { JENIS_IDENTITAS_ANAK, metaIdentitasAnak } from "./identitasAnak";

describe("identitas anak untuk portal orang tua", () => {
  it("menawarkan NIS, NISN, dan ID Santri dengan NIS sebagai pilihan pertama", () => {
    expect([...JENIS_IDENTITAS_ANAK]).toEqual(["nis", "nisn", "id_santri"]);
  });

  it("mempertahankan label dan placeholder NIS dan NISN yang sudah ada", () => {
    expect(metaIdentitasAnak("nis")).toEqual({ label: "NIS Anak", placeholder: "Nomor Induk Siswa", inputMode: "numeric" });
    expect(metaIdentitasAnak("nisn")).toEqual({ label: "NISN Anak", placeholder: "NISN 10 digit", inputMode: "numeric" });
  });

  it("memberi contoh format ID Santri dan keyboard yang memuat titik", () => {
    expect(metaIdentitasAnak("id_santri")).toEqual({
      label: "ID Santri Anak",
      placeholder: "Contoh: 23.01.007",
      inputMode: "decimal",
    });
  });
});
