import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ID Santri sudah dibuat oleh trigger database saat baris siswa (status 'calon')
// di-INSERT (migrasi 20261108050000). Test ini memastikan ID itu DIKEMBALIKAN ke
// pendaftar dan DITAMPILKAN di layar sukses /spmb, lengkap dengan keterangan agar
// orang tua menyimpannya untuk Portal Orang Tua.
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const pmb = read("src/server/pmb.ts");
const pmbPayment = read("src/server/pmbPayment.ts");
const halaman = read("src/pages/portal/SPMBDaftarOnlineV2.tsx");

/** Ambil isi kurung kurawal seimbang mulai dari indeks '{' yang diberikan. */
function balancedBlock(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  throw new Error("kurung kurawal tidak seimbang");
}

/** Semua objek `return { ... }` (kurung seimbang) di dalam sebuah teks. */
function returnObjects(source: string): string[] {
  const hasil: string[] = [];
  const re = /return\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    hasil.push(balancedBlock(source, m.index + m[0].length - 1));
  }
  return hasil;
}

describe("server pendaftaran SPMB mengembalikan ID Santri (pmb.ts)", () => {
  it("PmbDaftarResult memuat id_santri", () => {
    const m = pmb.match(/export interface PmbDaftarResult \{([\s\S]*?)\n\}/);
    expect(m, "PmbDaftarResult tidak ditemukan").not.toBeNull();
    expect(m![1]).toMatch(/id_santri\??:\s*string \| null/);
  });

  it("insert siswa baru meminta id_santri_pihak3 (diisi trigger BEFORE INSERT)", () => {
    expect(pmb).toMatch(/\.select\("id,\s*id_santri_pihak3"\)\.single\(\)/);
  });

  it("setiap return pendaftaran yang membawa payment_token juga membawa id_santri", () => {
    const start = pmb.indexOf("async function performPmbRegistration");
    expect(start, "performPmbRegistration tidak ditemukan").toBeGreaterThan(-1);
    const body = balancedBlock(pmb, pmb.indexOf("{", pmb.indexOf(")", start) + 1));
    const hasil = returnObjects(body).filter((obj) => obj.includes("payment_token"));
    // 3 jalur: pendaftaran identik yang diulang, siswa internal/lama, dan siswa baru.
    expect(hasil.length).toBe(3);
    for (const obj of hasil) expect(obj).toContain("id_santri");
  });

  it("jalur siswa lama membaca ID dari database, bukan mengarang", () => {
    expect(pmb).toMatch(/async function fetchIdSantri\(/);
    expect(pmb).toMatch(/from\("siswa"\)[\s\S]{0,80}\.select\("id_santri_pihak3"\)/);
  });
});

describe("pemulihan status lewat token juga membawa ID Santri (pmbPayment.ts)", () => {
  it("PmbRegistrationStatusResult memuat id_santri", () => {
    const m = pmbPayment.match(/export interface PmbRegistrationStatusResult \{([\s\S]*?)\n\}/);
    expect(m, "PmbRegistrationStatusResult tidak ditemukan").not.toBeNull();
    expect(m![1]).toMatch(/id_santri:\s*string \| null/);
  });

  it("pmbGetStatus meminta id_santri_pihak3 dari siswa", () => {
    const start = pmbPayment.indexOf("export const pmbGetStatus");
    const end = pmbPayment.indexOf("export async function createPmbPayment");
    const body = pmbPayment.slice(start, end);
    expect(body).toMatch(/\.select\("id, nama, departemen_id, status, terverifikasi, id_santri_pihak3"\)/);
  });

  it("semua return pmbGetStatus menyertakan id_santri", () => {
    const start = pmbPayment.indexOf("export const pmbGetStatus");
    const end = pmbPayment.indexOf("export async function createPmbPayment");
    const hasil = returnObjects(pmbPayment.slice(start, end)).filter((obj) => obj.includes("success: true"));
    expect(hasil.length).toBe(3);
    for (const obj of hasil) expect(obj).toContain("id_santri");
  });
});

describe("layar sukses /spmb menampilkan ID Santri dan keterangan untuk orang tua", () => {
  it("menyimpan id_santri dari hasil pendaftaran ke state registration", () => {
    expect(halaman).toMatch(/setRegistration\(\{[^}]*id_santri:\s*result\.id_santri/);
  });

  it("memakai ID dari status (jika ada) lalu dari hasil pendaftaran", () => {
    expect(halaman).toMatch(/const idSantri\s*=\s*registrationStatus\?\.id_santri\s*\?\?\s*registration\?\.id_santri/);
  });

  it("menampilkan kotak ID Santri hanya bila ID ada, apa pun status pembayarannya", () => {
    expect(halaman).toMatch(/\{idSantri && \(/);
    expect(halaman).toContain('data-testid="spmb-id-santri"');
    expect(halaman).toContain("{idSantri}");
    // Kotak ada di luar blok bersyarat promoFree / paymentVisible / isPaid.
    const kotak = halaman.indexOf('data-testid="spmb-id-santri"');
    const promo = halaman.indexOf("{promoFree ? (", halaman.indexOf("if (registrationStatus || registration)"));
    expect(kotak).toBeGreaterThan(-1);
    expect(kotak).toBeLessThan(promo);
  });

  it("memuat keterangan: simpan ID Santri untuk Portal Orang Tua bila dinyatakan lulus", () => {
    expect(halaman).toContain("Simpan ID Santri ini baik-baik.");
    expect(halaman).toContain("aplikasi Portal Orang Tua");
    expect(halaman).toContain("dinyatakan lulus");
  });

  it("menyediakan tombol salin ID Santri", () => {
    expect(halaman).toMatch(/navigator\.clipboard\.writeText\(idSantri\)/);
  });
});
