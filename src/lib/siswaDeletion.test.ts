import { describe, expect, it } from "vitest";
import {
  SiswaPunyaRiwayatError,
  isForeignKeyViolation,
  labelRiwayat,
  normalisasiHasilHapusSiswa,
  ringkasRiwayat,
} from "./siswaDeletion";

describe("normalisasiHasilHapusSiswa", () => {
  it("mengenali hasil sukses", () => {
    expect(normalisasiHasilHapusSiswa({ ok: true })).toEqual({ ok: true });
  });

  it("mengenali siswa yang punya riwayat, diurutkan dari jumlah terbanyak lalu nama tabel", () => {
    const hasil = normalisasiHasilHapusSiswa({
      ok: false,
      alasan: "punya_riwayat",
      riwayat: [
        { tabel: "pembayaran", jumlah: 2 },
        { tabel: "tagihan", jumlah: 5 },
        { tabel: "kelas_siswa", jumlah: 2 },
      ],
    });
    expect(hasil).toEqual({
      ok: false,
      alasan: "punya_riwayat",
      riwayat: [
        { tabel: "tagihan", jumlah: 5 },
        { tabel: "kelas_siswa", jumlah: 2 },
        { tabel: "pembayaran", jumlah: 2 },
      ],
    });
  });

  it("membuang baris berjumlah nol atau tanpa nama tabel, dan membaca jumlah berupa teks", () => {
    const hasil = normalisasiHasilHapusSiswa({
      ok: false,
      alasan: "punya_riwayat",
      riwayat: [
        { tabel: "tagihan", jumlah: 0 },
        { tabel: "", jumlah: 3 },
        { tabel: "pembayaran", jumlah: "2" },
      ],
    });
    expect(hasil).toEqual({
      ok: false,
      alasan: "punya_riwayat",
      riwayat: [{ tabel: "pembayaran", jumlah: 2 }],
    });
  });

  it("menerjemahkan alasan penolakan lain menjadi galat yang bisa dibaca", () => {
    expect(() => normalisasiHasilHapusSiswa({ ok: false, alasan: "tidak_ditemukan" })).toThrow("Siswa tidak ditemukan");
    expect(() => normalisasiHasilHapusSiswa({ ok: false, alasan: "tidak_berwenang" })).toThrow(
      "Anda tidak berwenang menghapus siswa ini",
    );
  });

  it.each([
    null,
    undefined,
    "ok",
    42,
    {},
    { ok: false },
    { ok: false, alasan: "lain" },
    { ok: false, alasan: "punya_riwayat" },
  ])("menolak respons yang tidak dikenali: %j", (raw) => {
    expect(() => normalisasiHasilHapusSiswa(raw)).toThrow("Respons hapus siswa tidak dikenali");
  });
});

describe("labelRiwayat", () => {
  it("memakai istilah domain untuk tabel yang dikenal", () => {
    expect(labelRiwayat("tagihan")).toBe("Tagihan");
    expect(labelRiwayat("pembayaran")).toBe("Pembayaran");
    expect(labelRiwayat("transaksi_midtrans_item")).toBe("Transaksi pembayaran online");
    expect(labelRiwayat("tabungan_siswa")).toBe("Tabungan");
    expect(labelRiwayat("kelas_siswa")).toBe("Riwayat kelas");
  });

  it("mengubah nama tabel lain menjadi teks yang terbaca dan membuang awalan skema", () => {
    expect(labelRiwayat("write_off_piutang")).toBe("Write off piutang");
    expect(labelRiwayat("migration.legacy_tagihan_snapshot")).toBe("Legacy tagihan snapshot");
  });
});

describe("ringkasRiwayat", () => {
  it("menampilkan jenis riwayat beserta jumlahnya", () => {
    expect(
      ringkasRiwayat([
        { tabel: "tagihan", jumlah: 3 },
        { tabel: "pembayaran", jumlah: 2 },
      ]),
    ).toBe("Tagihan (3), Pembayaran (2)");
  });

  it("meringkas sisanya bila lebih dari tiga jenis", () => {
    expect(
      ringkasRiwayat([
        { tabel: "tagihan", jumlah: 5 },
        { tabel: "pembayaran", jumlah: 4 },
        { tabel: "kelas_siswa", jumlah: 3 },
        { tabel: "tabungan_siswa", jumlah: 2 },
        { tabel: "nilai_kd", jumlah: 1 },
      ]),
    ).toBe("Tagihan (5), Pembayaran (4), Riwayat kelas (3), dan 2 jenis lainnya");
  });

  it("mengembalikan teks kosong bila tidak ada riwayat", () => {
    expect(ringkasRiwayat([])).toBe("");
  });
});

describe("SiswaPunyaRiwayatError", () => {
  it("membawa daftar riwayat dan pesan yang bisa dibaca", () => {
    const err = new SiswaPunyaRiwayatError([{ tabel: "tagihan", jumlah: 3 }]);
    expect(err).toBeInstanceOf(Error);
    expect(err.riwayat).toEqual([{ tabel: "tagihan", jumlah: 3 }]);
    expect(err.message).toBe("Siswa punya riwayat data: Tagihan (3)");
  });
});

describe("isForeignKeyViolation", () => {
  it("mengenali kode Postgres 23503", () => {
    expect(isForeignKeyViolation({ code: "23503", message: "x" })).toBe(true);
  });

  it("mengenali pesan pelanggaran foreign key tanpa kode", () => {
    expect(
      isForeignKeyViolation(new Error('update or delete on table "siswa" violates foreign key constraint "x_fkey"')),
    ).toBe(true);
  });

  it("tidak salah mengenali galat lain", () => {
    expect(isForeignKeyViolation(new Error("boom"))).toBe(false);
    expect(isForeignKeyViolation(null)).toBe(false);
    expect(isForeignKeyViolation("violates foreign key constraint")).toBe(false);
  });
});
