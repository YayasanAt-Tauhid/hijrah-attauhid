import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buatWorkbook, pesanBelumIkut, siswaBelumLengkap, susunBerkasBelumLengkap, susunBerkasInternal, susunBerkasVendor,
  type KonteksEkspor, type SheetEkspor,
} from "./seragamVendorEkspor";
import { rekapVendor, type PesananResult, type PesananRow, type PesananStel } from "./seragamVendorPesanan";

const konteks: KonteksEkspor = {
  tahunAjaran: "2027/2028", lembaga: "TK", gelombang: "Semua gelombang", tanggalCetak: "25 November 2026",
};

function ok(slot: number, nama: string, ukuran: string, harga: number): PesananStel {
  return { slot, nama, ukuran, namaVendor: nama, harga, status: "ok" };
}
function tanpaHarga(slot: number, nama: string, ukuran: string): PesananStel {
  return { slot, nama, ukuran, namaVendor: null, harga: null, status: "harga_belum_ada" };
}
function tanpaUkuran(slot: number, nama: string): PesananStel {
  return { slot, nama, ukuran: "", namaVendor: null, harga: null, status: "ukuran_belum_diisi" };
}
/** stelWajib bawaan = jumlah stel yang diberikan (lengkap), kecuali daftar kosong (4) atau diatur sendiri. */
function siswa(patch: Partial<PesananRow> & Pick<PesananRow, "siswaId" | "nama" | "stel">): PesananRow {
  const stelWajib = patch.stelWajib ?? (patch.stel.length || 4);
  return {
    nis: "", lembagaId: "dept-tk", lembaga: "TK", kelas: "-", jenisKelaminKode: "L", stelWajib,
    uangPangkalTotal: 4000000, uangPangkalDibayar: 1000000,
    total: patch.stel.reduce((sum, s) => sum + (s.harga ?? 0), 0),
    masalah: patch.stel.length < stelWajib || patch.stel.some((s) => s.status !== "ok"),
    ...patch,
  };
}

const ahmad = siswa({
  siswaId: "a", nama: "Ahmad", nis: "11111",
  stel: [ok(1, "Set Gamis Merah", "S", 170000), ok(2, "Set Gamis Hijau", "M", 170000)],
});
const siti = siswa({
  siswaId: "s", nama: "Siti", nis: "22222", jenisKelaminKode: "P", stel: [ok(1, "Set Gamis Merah", "XL", 220000)],
});
const candra = siswa({
  siswaId: "c", nama: "Candra", nis: "33333",
  stel: [ok(1, "Set Gamis Merah", "S", 170000), tanpaHarga(2, "Set Gamis Biru", "L"), tanpaUkuran(3, "Set Gamis Ungu")],
});
const dewi = siswa({ siswaId: "d", nama: "Dewi", nis: "44444", jenisKelaminKode: "P", stel: [] });
const rahma = siswa({
  siswaId: "r", nama: "Rahma", nis: "66666", lembagaId: "dept-sd", lembaga: "SD", jenisKelaminKode: "P",
  stel: [ok(1, "Putih Merah", "L", 150000)],
});
/** Stel terisi sebagian: 1 dari 4 yang seharusnya, dan yang terisi berharga. */
const eko = siswa({
  siswaId: "e", nama: "Eko", nis: "77777", stel: [ok(1, "Set Gamis Merah", "S", 170000)], stelWajib: 4,
});
const anwar = siswa({
  siswaId: "w", nama: "Anwar", nis: "88888", lembagaId: "dept-sd", lembaga: "SD", kelas: "1A", jenisKelaminKode: "P",
  stel: [ok(1, "Putih Merah", "L", 150000)], stelWajib: 4,
});
const semua = [ahmad, siti, candra, dewi, rahma];

const sheet = (berkas: { sheets: SheetEkspor[] }, name: string) => {
  const s = berkas.sheets.find((x) => x.name === name);
  if (!s) throw new Error(`sheet ${name} tidak ada`);
  return s;
};
/** Baris data = baris setelah baris judul kolom (yang sel pertamanya `kolomPertama` dan punya lebih dari 2 kolom). */
const dataRows = (s: SheetEkspor, kolomPertama: string) => {
  const idx = s.rows.findIndex((r) => r[0] === kolomPertama && r.length > 2);
  if (idx < 0) throw new Error(`baris judul kolom "${kolomPertama}" tidak ada di sheet ${s.name}`);
  return s.rows.slice(idx + 1);
};
const semuaSel = (berkas: { sheets: SheetEkspor[] }) => berkas.sheets.flatMap((s) => s.rows.flat());

describe("susunBerkasVendor", () => {
  it("dua sheet (Rekap, Daftar Nama) dengan judul: tahun ajaran, lembaga, gelombang, tanggal cetak", () => {
    const berkas = susunBerkasVendor(semua, konteks);
    expect(berkas.sheets.map((s) => s.name)).toEqual(["Rekap", "Daftar Nama"]);
    for (const s of berkas.sheets) {
      expect(s.rows[0]).toEqual(["Pesanan Seragam SPMB"]);
      expect(s.rows).toContainEqual(["Tahun ajaran", "2027/2028"]);
      expect(s.rows).toContainEqual(["Lembaga", "TK"]);
      expect(s.rows).toContainEqual(["Gelombang", "Semua gelombang"]);
      expect(s.rows).toContainEqual(["Tanggal cetak", "25 November 2026"]);
    }
  });

  it("tidak memuat NIS, total per siswa, maupun catatan internal", () => {
    const berkas = susunBerkasVendor(semua, konteks);
    const sel = semuaSel(berkas).map(String);
    for (const nis of ["11111", "22222", "33333", "44444", "66666"]) expect(sel).not.toContain(nis);
    expect(sel).not.toContain("NIS");
    expect(sel).not.toContain("Catatan");
    expect(sel).not.toContain("Total (Rp)");
    expect(sel.some((t) => t.includes("belum ada") || t.includes("belum diisi"))).toBe(false);
  });

  it("Rekap: baris per lembaga/stel/jenis kelamin/ukuran dan total sama dengan rekapVendor", () => {
    const berkas = susunBerkasVendor(semua, konteks);
    const rekap = rekapVendor(semua);
    const s = sheet(berkas, "Rekap");
    expect(s.rows).toContainEqual(["Lembaga", "Stel", "Jenis Kelamin", "Ukuran", "Jumlah", "Harga Satuan (Rp)", "Subtotal (Rp)"]);
    const rows = dataRows(s, "Lembaga");
    expect(rows).toContainEqual(["TK", "Set Gamis Merah", "Ikhwan", "S", 2, 170000, 340000]);
    expect(rows).toContainEqual(["TK", "Set Gamis Merah", "Akhwat", "XL", 1, 220000, 220000]);
    expect(rows).toContainEqual(["TK", "Set Gamis Hijau", "Ikhwan", "M", 1, 170000, 170000]);
    expect(rows).toContainEqual(["SD", "Putih Merah", "Akhwat", "L", 1, 150000, 150000]);
    expect(rows[rows.length - 1]).toEqual(["TOTAL", "", "", "", rekap.totalJumlah, "", rekap.totalBayar]);
    expect(rekap.totalJumlah).toBe(5);
    expect(rekap.totalBayar).toBe(880000);
  });

  it("entri tanpa harga atau tanpa ukuran tidak ikut dan dihitung; siswa tanpa stel dihitung belum lengkap", () => {
    const berkas = susunBerkasVendor(semua, konteks);
    expect(berkas.belumIkut).toEqual({ stel: 2, siswaBelumLengkap: 1 });
    const nama = dataRows(sheet(berkas, "Daftar Nama"), "Lembaga");
    expect(nama.some((r) => r.includes("Set Gamis Biru"))).toBe(false);
    expect(nama.some((r) => r.includes("Set Gamis Ungu"))).toBe(false);
    expect(nama.some((r) => r.includes("Dewi"))).toBe(false);
  });

  it("siswa dengan stel terisi sebagian dihitung belum lengkap, tetapi stel yang berharga tetap masuk", () => {
    const berkas = susunBerkasVendor([ahmad, eko], konteks);
    expect(berkas.belumIkut).toEqual({ stel: 0, siswaBelumLengkap: 1 });
    expect(dataRows(sheet(berkas, "Daftar Nama"), "Lembaga")).toContainEqual(["TK", "Eko", "Ikhwan", "Set Gamis Merah", "S"]);
  });

  it("belumIkut nol bila semua entri lengkap", () => {
    expect(susunBerkasVendor([ahmad, siti, rahma], konteks).belumIkut).toEqual({ stel: 0, siswaBelumLengkap: 0 });
  });

  it("Daftar Nama: satu baris per stel, urut lembaga, stel, ukuran (S sebelum XL), lalu nama; jenis kelamin Ikhwan/Akhwat", () => {
    const berkas = susunBerkasVendor(semua, konteks);
    const s = sheet(berkas, "Daftar Nama");
    expect(s.rows).toContainEqual(["Lembaga", "Nama", "Jenis Kelamin", "Stel", "Ukuran"]);
    expect(dataRows(s, "Lembaga")).toEqual([
      ["SD", "Rahma", "Akhwat", "Putih Merah", "L"],
      ["TK", "Ahmad", "Ikhwan", "Set Gamis Hijau", "M"],
      ["TK", "Ahmad", "Ikhwan", "Set Gamis Merah", "S"],
      ["TK", "Candra", "Ikhwan", "Set Gamis Merah", "S"],
      ["TK", "Siti", "Akhwat", "Set Gamis Merah", "XL"],
    ]);
  });

  it("Daftar Nama: kolom Catatan muncul hanya bila ada catatan ukuran kustom; Rekap tidak berubah", () => {
    const kiko = siswa({
      siswaId: "k", nama: "Kiko", stel: [{ ...ok(1, "Set Gamis Merah", "KUSTOM (XL)", 185000), catatan: "Lebar badan 3XL" }],
    });
    const berkas = susunBerkasVendor([ahmad, kiko], konteks);
    const s = sheet(berkas, "Daftar Nama");
    expect(s.rows).toContainEqual(["Lembaga", "Nama", "Jenis Kelamin", "Stel", "Ukuran", "Catatan"]);
    expect(dataRows(s, "Lembaga")).toEqual([
      ["TK", "Ahmad", "Ikhwan", "Set Gamis Hijau", "M", ""],
      ["TK", "Ahmad", "Ikhwan", "Set Gamis Merah", "S", ""],
      ["TK", "Kiko", "Ikhwan", "Set Gamis Merah", "KUSTOM (XL)", "Lebar badan 3XL"],
    ]);
    const rekap = dataRows(sheet(berkas, "Rekap"), "Lembaga");
    expect(rekap.every((r) => r.length === 7)).toBe(true);
    expect(rekap).toContainEqual(["TK", "Set Gamis Merah", "Ikhwan", "KUSTOM (XL)", 1, 185000, 185000]);
    // tanpa catatan: kolom Catatan tidak ada sama sekali
    expect(sheet(susunBerkasVendor([ahmad], konteks), "Daftar Nama").rows.flat()).not.toContain("Catatan");
  });

  it("memakai nama stel menurut vendor bila berbeda dari ejaan di data siswa", () => {
    const beda = siswa({
      siswaId: "b", nama: "Bima",
      stel: [{ slot: 1, nama: "merah", ukuran: "S", namaVendor: "Set Gamis Merah", harga: 170000, status: "ok" }],
    });
    const berkas = susunBerkasVendor([beda], konteks);
    expect(dataRows(sheet(berkas, "Daftar Nama"), "Lembaga")).toEqual([["TK", "Bima", "Ikhwan", "Set Gamis Merah", "S"]]);
    expect(dataRows(sheet(berkas, "Rekap"), "Lembaga")[0]).toEqual(["TK", "Set Gamis Merah", "Ikhwan", "S", 1, 170000, 170000]);
  });

  it("nama berawalan = + - @ diberi apostrof agar tidak dibaca sebagai rumus", () => {
    const jahat = siswa({ siswaId: "z", nama: '=HYPERLINK("http://x")', stel: [ok(1, "Set Gamis Merah", "S", 170000)] });
    const berkas = susunBerkasVendor([jahat], konteks);
    expect(dataRows(sheet(berkas, "Daftar Nama"), "Lembaga")[0][1]).toBe(`'=HYPERLINK("http://x")`);
    for (const awal of ["+", "-", "@"]) {
      const b = susunBerkasVendor([siswa({ siswaId: "y", nama: `${awal}cmd`, stel: [ok(1, "Set Gamis Merah", "S", 170000)] })], konteks);
      expect(dataRows(sheet(b, "Daftar Nama"), "Lembaga")[0][1]).toBe(`'${awal}cmd`);
    }
  });

  it("nama berkas: slug tahun ajaran dan lembaga, tanpa ekstensi", () => {
    expect(susunBerkasVendor(semua, konteks).filename).toBe("pesanan-seragam-vendor-2027-2028-tk");
    expect(susunBerkasVendor(semua, { ...konteks, lembaga: "Semua lembaga" }).filename).toBe("pesanan-seragam-vendor-2027-2028-semua-lembaga");
  });

  it("daftar kosong tetap menghasilkan berkas valid dengan total nol", () => {
    const berkas = susunBerkasVendor([], konteks);
    expect(dataRows(sheet(berkas, "Rekap"), "Lembaga")).toEqual([["TOTAL", "", "", "", 0, "", 0]]);
    expect(dataRows(sheet(berkas, "Daftar Nama"), "Lembaga")).toEqual([]);
    expect(berkas.belumIkut).toEqual({ stel: 0, siswaBelumLengkap: 0 });
  });
});

describe("susunBerkasInternal", () => {
  const pesanan: PesananResult = { layak: semua, belumMemenuhi: 3, denganMasalah: 2 };

  it("tiga sheet dengan judul yang menandai berkas internal", () => {
    const berkas = susunBerkasInternal(pesanan, konteks);
    expect(berkas.sheets.map((s) => s.name)).toEqual(["Ringkasan", "Daftar Pesanan", "Rekap Vendor"]);
    expect(berkas.sheets[0].rows[0]).toEqual(["Pesanan Seragam SPMB (Internal Yayasan)"]);
    expect(berkas.sheets[0].rows).toContainEqual(["Tahun ajaran", "2027/2028"]);
    expect(berkas.filename).toBe("pesanan-seragam-internal-2027-2028-tk");
  });

  it("Ringkasan: layak dipesan, belum memenuhi 25%, perlu dilengkapi, total pembayaran vendor", () => {
    const rows = sheet(susunBerkasInternal(pesanan, konteks), "Ringkasan").rows;
    expect(rows).toContainEqual(["Layak dipesan", 5]);
    expect(rows).toContainEqual(["Belum memenuhi 25%", 3]);
    expect(rows).toContainEqual(["Perlu dilengkapi", 2]);
    expect(rows).toContainEqual(["Total pembayaran vendor (Rp)", 880000]);
  });

  it("Daftar Pesanan memuat NIS, total, dan catatan masalah; siswa bermasalah tetap ada", () => {
    const rows = dataRows(sheet(susunBerkasInternal(pesanan, konteks), "Daftar Pesanan"), "Nama");
    const candraRow = rows.find((r) => r[0] === "Candra");
    expect(candraRow).toBeDefined();
    expect(candraRow).toContain("33333");
    expect(candraRow).toContain(170000);
    expect(candraRow!.some((c) => String(c).includes("Harga belum ada: Set Gamis Biru (L)"))).toBe(true);
    expect(rows.find((r) => r[0] === "Dewi")!.some((c) => String(c).includes("Belum ada stel yang diisi"))).toBe(true);
  });

  it("Rekap Vendor memuat baris 'Harga belum ada' dan total", () => {
    const rows = dataRows(sheet(susunBerkasInternal(pesanan, konteks), "Rekap Vendor"), "Lembaga");
    expect(rows.some((r) => r[1] === "Set Gamis Biru" && r[2] === "Ikhwan" && r[5] === "Harga belum ada")).toBe(true);
    expect(rows[rows.length - 1]).toEqual(["TOTAL", "", "", "", 5, "", 880000]);
  });

  it("nama berawalan = juga diamankan di berkas internal", () => {
    const jahat = siswa({ siswaId: "z", nama: "=1+1", stel: [ok(1, "Set Gamis Merah", "S", 170000)] });
    const rows = dataRows(sheet(susunBerkasInternal({ layak: [jahat], belumMemenuhi: 0, denganMasalah: 0 }, konteks), "Daftar Pesanan"), "Nama");
    expect(rows[0][0]).toBe("'=1+1");
  });
});

describe("siswaBelumLengkap dan susunBerkasBelumLengkap", () => {
  const layak = [ahmad, siti, candra, dewi, rahma, eko, anwar];

  it("siswaBelumLengkap: tanpa stel, stel kurang, atau ada stel tanpa harga/ukuran; yang lengkap tidak ikut", () => {
    expect(siswaBelumLengkap(layak).map((r) => r.nama)).toEqual(["Candra", "Dewi", "Eko", "Anwar"]);
    expect(siswaBelumLengkap([ahmad, siti, rahma])).toEqual([]);
  });

  it("satu sheet internal berisi hanya siswa belum lengkap, urut lembaga lalu nama, dengan keterangan apa yang kurang", () => {
    const berkas = susunBerkasBelumLengkap(layak, konteks);
    expect(berkas.sheets.map((s) => s.name)).toEqual(["Belum Lengkap"]);
    const s = berkas.sheets[0];
    expect(s.rows[0]).toEqual(["Pesanan Seragam SPMB (Internal Yayasan): Daftar Belum Lengkap"]);
    expect(s.rows).toContainEqual(["Tahun ajaran", "2027/2028"]);
    expect(s.rows).toContainEqual(["Tanggal cetak", "25 November 2026"]);
    expect(s.rows).toContainEqual(["Jumlah siswa", 4]);
    expect(s.rows).toContainEqual([
      "Lembaga", "Kelas", "Nama", "NIS", "Jenis Kelamin", "Uang Pangkal (Rp)", "Dibayar (Rp)", "Stel Terisi", "Keterangan",
    ]);
    expect(dataRows(s, "Lembaga")).toEqual([
      ["SD", "1A", "Anwar", "88888", "Akhwat", 4000000, 1000000, "1 dari 4", "Baru 1 dari 4 stel diisi"],
      ["TK", "", "Candra", "33333", "Ikhwan", 4000000, 1000000, "3 dari 3",
        "Harga belum ada: Set Gamis Biru (L); Ukuran belum diisi: Set Gamis Ungu"],
      ["TK", "", "Dewi", "44444", "Akhwat", 4000000, 1000000, "0 dari 4", "Belum ada stel yang diisi"],
      ["TK", "", "Eko", "77777", "Ikhwan", 4000000, 1000000, "1 dari 4", "Baru 1 dari 4 stel diisi"],
    ]);
    expect(berkas.filename).toBe("pesanan-seragam-belum-lengkap-2027-2028-tk");
    expect(berkas.belumIkut).toEqual({ stel: 0, siswaBelumLengkap: 0 });
  });

  it('siswa yang belum punya kelas (placeholder "-") tampil kosong, bukan "\'-"', () => {
    const baris = dataRows(susunBerkasBelumLengkap([dewi], konteks).sheets[0], "Lembaga")[0];
    expect(baris[1]).toBe("");
  });

  it("semua lengkap: berkas valid dengan jumlah nol dan tanpa baris data", () => {
    const berkas = susunBerkasBelumLengkap([ahmad, siti, rahma], konteks);
    expect(berkas.sheets[0].rows).toContainEqual(["Jumlah siswa", 0]);
    expect(dataRows(berkas.sheets[0], "Lembaga")).toEqual([]);
  });

  it("nama berawalan = diamankan", () => {
    const jahat = siswa({ siswaId: "z", nama: "=cmd", stel: [], stelWajib: 4 });
    expect(dataRows(susunBerkasBelumLengkap([jahat], konteks).sheets[0], "Lembaga")[0][2]).toBe("'=cmd");
  });
});

describe("pesanBelumIkut", () => {
  const akhir = "Lengkapi dulu sebelum diserahkan ke vendor.";
  it("null bila semua lengkap", () => {
    expect(pesanBelumIkut({ stel: 0, siswaBelumLengkap: 0 })).toBeNull();
  });
  it("menyebut entri stel yang tidak ikut dan siswa yang stelnya belum lengkap bila keduanya ada", () => {
    expect(pesanBelumIkut({ stel: 2, siswaBelumLengkap: 1 }))
      .toBe(`Berkas vendor belum lengkap: 2 entri stel tidak ikut (harga atau ukuran belum ada) dan 1 siswa stelnya belum lengkap. ${akhir}`);
  });
  it("hanya entri stel", () => {
    expect(pesanBelumIkut({ stel: 3, siswaBelumLengkap: 0 }))
      .toBe(`Berkas vendor belum lengkap: 3 entri stel tidak ikut (harga atau ukuran belum ada). ${akhir}`);
  });
  it("hanya siswa dengan stel belum lengkap", () => {
    expect(pesanBelumIkut({ stel: 0, siswaBelumLengkap: 1 })).toBe(`Berkas vendor belum lengkap: 1 siswa stelnya belum lengkap. ${akhir}`);
  });
});

describe("buatWorkbook", () => {
  it("sheet dan isi sel sama dengan berkas; judul ada di sel A1", () => {
    const berkas = susunBerkasVendor(semua, konteks);
    const wb = buatWorkbook(berkas);
    expect(wb.SheetNames).toEqual(["Rekap", "Daftar Nama"]);
    expect(wb.Sheets["Rekap"]["A1"].v).toBe("Pesanan Seragam SPMB");
    const baris = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Daftar Nama"], { header: 1, blankrows: false });
    expect(baris).toContainEqual(["TK", "Siti", "Akhwat", "Set Gamis Merah", "XL"]);
  });
});
