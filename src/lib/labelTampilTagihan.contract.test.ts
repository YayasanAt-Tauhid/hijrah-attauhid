import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const migrasiKolom = read("supabase/migrations/20261112040000_label_tagihan_saldo_piutang_lama.sql");
const migrasiView = read("supabase/migrations/20261112050000_v_tagihan_belum_bayar_nama_tampil.sql");
const inputPembayaran = read("src/pages/keuangan/InputPembayaran.tsx");
const printTagihan = read("src/components/shared/PrintTagihan.tsx");
const paymentLink = read("src/server/paymentLink.ts");
const bayarLink = read("src/pages/portal/BayarLink.tsx");
const portalTagihan = read("src/pages/portal/PortalTagihan.tsx");
const portalCheckout = read("src/pages/portal/PortalCheckout.tsx");

describe("label tampil tagihan (Saldo Piutang Lama) — database", () => {
  it("menambah kolom nullable dan hanya mengisi tagihan saldo aktif yang masih kosong", () => {
    expect(migrasiKolom).toContain("ADD COLUMN IF NOT EXISTS label_tampil text");
    expect(migrasiKolom).toContain("migration.legacy_tagihan_snapshot");
    expect(migrasiKolom).toContain("jp.nama ILIKE 'SALDO PIUTANG LAMA%'");
    expect(migrasiKolom).toContain("t.status <> 'dibatalkan'");
    expect(migrasiKolom).toContain("t.label_tampil IS NULL");
  });

  it("migrasi kolom tidak menyentuh nominal, status, jurnal, atau pembayaran", () => {
    const setClause = migrasiKolom.slice(migrasiKolom.indexOf("UPDATE public.tagihan"));
    expect(setClause).toContain("SET label_tampil =");
    for (const kolom of ["nominal =", "status =", "jurnal_piutang_id =", "pembayaran_id ="]) {
      expect(setClause).not.toContain(kolom);
    }
  });

  it("view portal hanya menambah nama_tampil di ujung dan mempertahankan security_invoker", () => {
    expect(migrasiView).toContain("WITH (security_invoker = true)");
    expect(migrasiView).toContain("t.label_tampil AS nama_tampil\n   FROM tagihan t");
    expect(migrasiView).toContain("jp.nama AS jenis_nama");
  });
});

describe("label tampil tagihan — daftar Tagihan Siswa, Cetak Tagihan, Link Pembayaran (kasir)", () => {
  it("membaca label_tampil dan memakainya hanya untuk teks tampilan", () => {
    expect(inputPembayaran).toContain("label_tampil: string | null;");
    expect(inputPembayaran).toContain("nominal_diskon, status, jatuh_tempo, label_tampil, jenis_pembayaran:jenis_id(");
    expect(inputPembayaran).toContain('<td className="px-3 py-3 font-medium">{bill.label_tampil ?? bill.jenis_pembayaran?.nama ?? "-"}</td>');
    expect(inputPembayaran).toContain('"Pilih tagihan " + (bill.label_tampil ?? bill.jenis_pembayaran?.nama ?? "")');
    expect(inputPembayaran).toContain('"Jumlah bayar " + (bill.label_tampil ?? bill.jenis_pembayaran?.nama ?? "")');
  });

  it("Cetak Tagihan memakai label sebagai nama yang dicetak", () => {
    expect(inputPembayaran).toContain("jenisNama: bill.label_tampil ?? bill.jenis_pembayaran.nama,");
    expect(printTagihan).toContain("{item.jenisNama}");
  });

  it("dialog Link Pembayaran memakai label, tetapi aturan cicilan tetap memakai nama jenis", () => {
    expect(inputPembayaran).toContain(
      'label: [bill.label_tampil ?? bill.jenis_pembayaran?.nama ?? "Tagihan", billPeriodLabel(bill)]',
    );
    expect(inputPembayaran).toContain('jenis_nama: bill.jenis_pembayaran?.nama ?? "",');
  });

  it("logika pembayaran kasir tetap memakai nama jenis, bukan label", () => {
    expect(inputPembayaran).toContain("isSppPaymentName(bill.jenis_pembayaran.nama)");
    expect(inputPembayaran).toContain("jenisNama: bill.jenis_pembayaran.nama,\n      jenisTipe: bill.jenis_pembayaran.tipe,");
    expect(inputPembayaran).not.toMatch(/isSppPaymentName\([^)]*label_tampil/);
  });
});

describe("label tampil tagihan — halaman Link Pembayaran untuk orang tua", () => {
  it("server mengirim nama_tampil, sementara jenis_nama dan boleh_cicil tetap dari nama jenis", () => {
    expect(paymentLink).toContain("nama_tampil: string | null;");
    expect(paymentLink).toContain('"id, siswa_id, jenis_id, bulan, nominal, status, jatuh_tempo, tahun_ajaran_id, label_tampil, "');
    expect(paymentLink).toContain("nama_tampil: row.label_tampil ?? null,");
    expect(paymentLink).toContain('jenis_nama: row.jenis?.nama ?? "Tagihan",');
    expect(paymentLink).toContain('isLinkInstallmentAllowed({ bulan: row.bulan ?? null, status: row.status, jenis_nama: row.jenis?.nama ?? "" })');
    expect(paymentLink).toContain('"id" | "jenis_nama" | "nama_tampil" | "periode"');
    expect(paymentLink).toContain("id, jenis_nama, nama_tampil, periode, bulan, jatuh_tempo, due, sisa_tagihan, cicilan");
  });

  it("halaman link menampilkan nama_tampil dengan cadangan nama jenis", () => {
    expect(bayarLink).toContain("{bill.nama_tampil ?? bill.jenis_nama}");
  });
});

describe("label tampil tagihan — portal orang tua", () => {
  it("memetakan nama_tampil dari view dan hanya memakainya untuk teks", () => {
    expect(portalTagihan).toContain("nama_tampil: string | null;");
    expect(portalTagihan).toContain("? (t.nama_tampil ?? t.jenis_nama)");
    expect(portalTagihan).toContain(": (t.nama_tampil ?? t.jenis_nama)}");
    expect(portalTagihan).toContain("typeItems.length === 1 ? (typeFirst.nama_tampil ?? typeFirst.jenis_nama) : typeFirst.jenis_nama");
    expect(portalTagihan).toContain("nama_tampil: t.nama_tampil,");
  });

  it("logika portal tetap memakai jenis_nama", () => {
    expect(portalTagihan).toContain("isSppPaymentName(t.jenis_nama)");
    expect(portalTagihan).toContain("isUangPangkalPaymentName(t.jenis_nama)");
    expect(portalTagihan).toContain("Selesaikan {t.jenis_nama} {prerequisiteLabel(t, prerequisite)} terlebih dahulu");
    expect(portalTagihan).not.toMatch(/is(Spp|UangPangkal)PaymentName\([^)]*nama_tampil/);
  });

  it("keranjang checkout menampilkan nama_tampil dengan cadangan nama jenis", () => {
    expect(portalCheckout).toContain("nama_tampil?: string | null;");
    expect(portalCheckout).toContain("<TableCell>{item.nama_tampil ?? item.jenis_nama}</TableCell>");
  });
});
