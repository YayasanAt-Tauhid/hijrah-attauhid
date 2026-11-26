import { describe, expect, it } from "vitest";
import { amanPdf, buatPdfVendor, susunPdfVendor } from "./seragamVendorPdf";
import { susunBerkasVendor, type KonteksEkspor } from "./seragamVendorEkspor";
import { rekapVendor, type PesananRow, type PesananStel } from "./seragamVendorPesanan";

const konteks: KonteksEkspor = {
  tahunAjaran: "2027/2028", lembaga: "Semua lembaga", gelombang: "Semua gelombang", tanggalCetak: "26 November 2026",
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
  siswaId: "a", nama: "Ahmad", stel: [ok(1, "Set Gamis Merah", "S", 170000), ok(2, "Set Gamis Hijau", "M", 170000)],
});
const fatimah = siswa({
  siswaId: "f", nama: "Fatimah", jenisKelaminKode: "P", stel: [ok(1, "Set Gamis Merah", "S", 170000)],
});
const siti = siswa({
  siswaId: "s", nama: "Siti", jenisKelaminKode: "P", stel: [ok(1, "Set Gamis Merah", "XL", 220000)],
});
const candra = siswa({
  siswaId: "c", nama: "Candra",
  stel: [ok(1, "Set Gamis Merah", "S", 170000), tanpaHarga(2, "Set Gamis Biru", "L"), tanpaUkuran(3, "Set Gamis Ungu")],
});
const dewi = siswa({ siswaId: "d", nama: "Dewi", jenisKelaminKode: "P", stel: [] });
const rahma = siswa({
  siswaId: "r", nama: "Rahma", lembagaId: "dept-sd", lembaga: "SD", jenisKelaminKode: "P",
  stel: [ok(1, "Putih Merah", "L", 150000)],
});
const marvel = siswa({
  siswaId: "m", nama: "Marvel Evano Sitorus", nis: "71925", lembagaId: "dept-sd", lembaga: "SD",
  stel: [ok(1, "Putih Merah", "KUSTOM (XL)", 210000), ok(2, "Putih Merah", "KUSTOM (XL)", 210000)],
});

describe("susunPdfVendor: pengelompokan per lembaga", () => {
  it("memisahkan pesanan per lembaga dan mengurutkannya menurut nama lembaga", () => {
    const model = susunPdfVendor([ahmad, rahma, siti], konteks);
    expect(model.lembaga.map((l) => l.lembaga)).toEqual(["SD", "TK"]);
    for (const l of model.lembaga) {
      expect(l.rekap.every((b) => b.lembaga === l.lembaga)).toBe(true);
    }
  });

  it("menghitung total tiap lembaga, dan total keseluruhan sama dengan rekap Excel", () => {
    const layak = [ahmad, rahma, siti];
    const model = susunPdfVendor(layak, konteks);
    const sd = model.lembaga.find((l) => l.lembaga === "SD")!;
    const tk = model.lembaga.find((l) => l.lembaga === "TK")!;
    expect(sd).toMatchObject({ totalJumlah: 1, totalBayar: 150000 });
    expect(tk).toMatchObject({ totalJumlah: 3, totalBayar: 560000 });
    const rekap = rekapVendor(layak);
    expect(model.totalJumlah).toBe(rekap.totalJumlah);
    expect(model.totalBayar).toBe(rekap.totalBayar);
    expect(model.totalBayar).toBe(sd.totalBayar + tk.totalBayar);
  });

  it("tetap memisahkan ikhwan dan akhwat di dalam satu lembaga, ikhwan lebih dulu", () => {
    const model = susunPdfVendor([fatimah, ahmad], konteks);
    const merahS = model.lembaga[0].rekap.filter((b) => b.namaStel === "Set Gamis Merah" && b.ukuran === "S");
    expect(merahS.map((b) => b.jenisKelaminKode)).toEqual(["L", "P"]);
  });

  it("memuat daftar nama per lembaga, hanya stel yang ikut, urut stel, ukuran, lalu nama", () => {
    const model = susunPdfVendor([fatimah, ahmad, candra, rahma], konteks);
    const tk = model.lembaga.find((l) => l.lembaga === "TK")!;
    expect(tk.nama.map((n) => [n.stel, n.ukuran, n.nama])).toEqual([
      ["Set Gamis Hijau", "M", "Ahmad"],
      ["Set Gamis Merah", "S", "Ahmad"],
      ["Set Gamis Merah", "S", "Candra"],
      ["Set Gamis Merah", "S", "Fatimah"],
    ]);
    expect(tk.nama.find((n) => n.nama === "Fatimah")?.jenisKelamin).toBe("Akhwat");
    expect(model.lembaga.find((l) => l.lembaga === "SD")!.nama).toHaveLength(1);
  });

  it("memuat ukuran kustom sebagai baris tersendiri di rekap dan daftar nama", () => {
    const model = susunPdfVendor([marvel, rahma], konteks);
    const sd = model.lembaga[0];
    expect(sd.rekap.find((b) => b.ukuran === "KUSTOM (XL)")).toMatchObject({ jumlah: 2, subtotal: 420000 });
    expect(sd.nama.filter((n) => n.nama === "Marvel Evano Sitorus")).toHaveLength(2);
  });

  it("menghitung peringatan belum lengkap persis seperti berkas Excel vendor", () => {
    const layak = [ahmad, candra, dewi, rahma];
    expect(susunPdfVendor(layak, konteks).belumIkut).toEqual(susunBerkasVendor(layak, konteks).belumIkut);
    expect(susunPdfVendor(layak, konteks).belumIkut).toEqual({ stel: 2, siswaBelumLengkap: 1 });
  });

  it("memakai nama berkas yang sama dengan berkas Excel vendor", () => {
    expect(susunPdfVendor([ahmad], konteks).filename).toBe(susunBerkasVendor([ahmad], konteks).filename);
  });

  it("menghasilkan model kosong bila tidak ada stel yang ikut", () => {
    const model = susunPdfVendor([dewi], konteks);
    expect(model.lembaga).toEqual([]);
    expect(model).toMatchObject({ totalJumlah: 0, totalBayar: 0 });
  });
});

describe("buatPdfVendor: PDF sungguhan", () => {
  it("membuat PDF yang sah, tiap lembaga di halaman sendiri, dengan nomor halaman", async () => {
    const doc = await buatPdfVendor(susunPdfVendor([ahmad, rahma, siti], konteks), { kompres: false });
    const isi = doc.output();
    expect(isi.startsWith("%PDF-")).toBe(true);
    expect(doc.getNumberOfPages()).toBe(2);
    expect(isi).toContain("Halaman 1 dari 2");
    expect(isi).toContain("Halaman 2 dari 2");
    expect(isi).toContain("Ahmad");
    expect(isi).toContain("Rahma");
  });

  it("memuat ukuran kustom, jenis kelamin, dan total lembaga di PDF", async () => {
    const doc = await buatPdfVendor(susunPdfVendor([marvel, siti], konteks), { kompres: false });
    const isi = doc.output();
    expect(isi).toContain("Marvel Evano Sitorus");
    expect(isi).toContain("KUSTOM \\(XL\\)");
    expect(isi).toContain("Akhwat");
    expect(isi).toContain("Ikhwan");
    expect(isi).toContain("420.000"); // total SD: 2 x 210.000
  });

  it("menyambung ke halaman berikutnya bila daftar panjang, tanpa baris yang hilang", async () => {
    const banyak = Array.from({ length: 120 }, (_, i) => siswa({
      siswaId: `x${i}`, nama: `Siswa ${String(i + 1).padStart(3, "0")}`,
      stel: [ok(1, "Set Gamis Merah", "S", 170000)],
    }));
    const doc = await buatPdfVendor(susunPdfVendor(banyak, konteks), { kompres: false });
    const isi = doc.output();
    expect(doc.getNumberOfPages()).toBeGreaterThan(2);
    expect(isi).toContain("Siswa 001");
    expect(isi).toContain("Siswa 120");
    expect(isi).toContain("TK: Daftar Nama \\(lanjutan\\)"); // tanda kurung di-escape oleh jsPDF
  });

  it("tetap menghasilkan satu halaman berisi keterangan bila tidak ada pesanan yang ikut", async () => {
    const doc = await buatPdfVendor(susunPdfVendor([dewi], konteks), { kompres: false });
    expect(doc.getNumberOfPages()).toBe(1);
    expect(doc.output()).toContain("Tidak ada pesanan yang lengkap");
  });
});

describe("amanPdf: karakter di luar Latin-1", () => {
  it("membuang diakritik, menyederhanakan tanda kutip dan strip, dan mengganti huruf non-Latin dengan ?", () => {
    expect(amanPdf("Nūr ‘Aini’ – “Putri”")).toBe("Nur 'Aini' - \"Putri\"");
    expect(amanPdf("محمد")).toBe("????");
    expect(amanPdf("José Ñandú")).toBe("José Ñandú");
  });

  it("memakai teks yang sudah dibersihkan di PDF", async () => {
    const aneh = siswa({ siswaId: "n", nama: "Nūr ‘Aini’", stel: [ok(1, "Set Gamis Merah", "S", 170000)] });
    const doc = await buatPdfVendor(susunPdfVendor([aneh], konteks), { kompres: false });
    expect(doc.output()).toContain("Nur 'Aini'");
  });
});
