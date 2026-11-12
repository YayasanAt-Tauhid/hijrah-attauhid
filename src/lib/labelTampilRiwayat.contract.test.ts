import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const inputPembayaran = read("src/pages/keuangan/InputPembayaran.tsx");
const portalRiwayat = read("src/pages/portal/PortalRiwayat.tsx");

describe("label tampil tagihan — riwayat pembayaran kasir", () => {
  it("memuat label tagihan lewat tagihan_id dan menampilkannya di kolom Jenis", () => {
    expect(inputPembayaran).toContain(
      '.select("*, jenis_pembayaran:jenis_id(id, nama, tipe), petugas:petugas_id(nama), jurnal:jurnal_id(nomor), tagihan:tagihan_id(label_tampil)")',
    );
    expect(inputPembayaran).toContain("tagihan?: { label_tampil?: string | null } | null;");
    expect(inputPembayaran).toContain(
      '{ key: "jenis_pembayaran", label: "Jenis", render: (_, r) => r.tagihan?.label_tampil ?? r.jenis_pembayaran?.nama ?? "-" }',
    );
  });

  it("pencarian riwayat ikut mencocokkan teks label yang terlihat", () => {
    expect(inputPembayaran).toContain("row.tagihan?.label_tampil,\n        row.jenis_pembayaran?.nama,");
  });

  it("dialog pembatalan menampilkan label, tetapi keterangan yang disimpan tetap nama jenis", () => {
    expect(inputPembayaran).toContain(
      '{batalTarget.tagihan?.label_tampil ?? batalTarget.jenis_pembayaran?.nama ?? "-"}',
    );
    expect(inputPembayaran).toContain('keterangan: `${batalTarget.jenis_pembayaran?.nama ?? ""}');
  });

  it("kwitansi cetak dan teks pengajuan pembatalan tetap memakai nama jenis (dokumen/data yang disimpan)", () => {
    expect(inputPembayaran).toContain('jenisNama: riwayatPrintTarget.jenis_pembayaran?.nama || "Pembayaran",');
    expect(inputPembayaran).toContain('label: `${r.jenis_pembayaran?.nama ?? "Pembayaran"}');
    expect(inputPembayaran).not.toMatch(/riwayatPrintTarget\.tagihan/);
  });
});

describe("label tampil tagihan — riwayat pembayaran portal orang tua", () => {
  it("memuat label dari tagihan pembayaran kasir dan memakainya sebagai nama item di daftar", () => {
    expect(portalRiwayat).toContain("keterangan, tagihan:tagihan_id(id, label_tampil, nominal");
    expect(portalRiwayat).toContain(
      'nama_item: p.tagihan?.label_tampil || p.keterangan || p.jenis_pembayaran?.nama || "Pembayaran"',
    );
  });

  it("bukti/kwitansi dari portal tetap memakai nama jenis dan keterangan asli", () => {
    expect(portalRiwayat).toContain('jenisNama: p.jenis_pembayaran?.nama || "Pembayaran"');
    expect(portalRiwayat).toContain("keterangan: p.keterangan || undefined,");
  });
});
