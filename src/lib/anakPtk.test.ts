import { describe, expect, it } from "vitest";
import { buildAnakPtkReport, type AnakPtkSource } from "./anakPtk";
const a = "1".repeat(16), b = "2".repeat(16);
const source = (): AnakPtkSource => ({
  siswa: [{ id: "s", nama: "Fixture Siswa", nis: "fixture", status: "aktif", departemen_id: "d", angkatan_id: "angkatan" }],
  detail: [{ siswa_id: "s", nik_ayah: a, nik_ibu: b }],
  pegawai: [{ id: "p", nama: "Fixture Ayah", status: "aktif" }, { id: "q", nama: "Fixture Ibu", status: "aktif" }],
  nikPegawai: [{ pegawai_id: "p", nik: a }, { pegawai_id: "q", nik: b }],
  kelas: [{ id: "k", nama: "TK A1" }, { id: "old", nama: "TK Lama" }],
  penempatan: [{ siswa_id: "s", kelas_id: "k", tahun_ajaran_id: "ta", aktif: true }],
  tarif: [],
});
const report = (data = source()) => buildAnakPtkReport(data, { tahunAjaranId: "ta", tahunBukuId: "tb", jenisId: "jenis" });

describe("daftar kandidat anak PTK", () => {
  it("dua orang tua cocok menghasilkan satu siswa, tanpa mengirim NIK", () => {
    const result = report();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].orangTua.map(p => p.hubungan)).toEqual(["ayah", "ibu"]);
    expect(JSON.stringify(result)).not.toContain(a);
    expect(JSON.stringify(result)).not.toContain(b);
    expect(result.items[0].verifikasi).toBe("perlu_verifikasi");
  });
  it("siswa nonaktif tidak masuk daftar", () => {
    const data = source(); data.siswa[0].status = "alumni";
    expect(report(data).items).toHaveLength(0);
  });
  it("pegawai nonaktif tetap terlihat untuk ditinjau, bukan dianggap penerima diskon", () => {
    const data = source(); data.pegawai.forEach(p => { p.status = "nonaktif"; });
    expect(report(data).items[0].peringatan).toContain("pegawai_nonaktif");
  });
  it("data orang tua kosong tidak diberi kesimpulan bukan anak PTK", () => {
    const data = source(); data.detail = [];
    expect(report(data).coverage.siswaTanpaNikOrangtuaValid).toBe(1);
    expect(report(data).items).toHaveLength(0);
  });
  it("mengabaikan NIK orang tua tidak valid dan normalisasi spasi/titik", () => {
    const data = source(); data.detail[0].nik_ayah = "1111.1111 1111.1111"; data.detail[0].nik_ibu = "123";
    expect(report(data).items[0].orangTua).toHaveLength(1);
  });
  it("memakai kelas pada TA pilihan, bukan penempatan lama", () => {
    const data = source(); data.penempatan.push({ siswa_id: "s", kelas_id: "old", tahun_ajaran_id: "old-ta", aktif: true });
    expect(report(data).items[0].kelas).toBe("TK A1");
  });
  it("penempatan ganda atau belum ada harus ditinjau", () => {
    const data = source(); data.penempatan.push({ siswa_id: "s", kelas_id: "old", tahun_ajaran_id: "ta", aktif: true });
    expect(report(data).items[0].peringatan).toContain("kelas_ganda");
    data.penempatan = [];
    expect(report(data).items[0].peringatan).toContain("kelas_belum_ada");
  });
});

describe("kesiapan tarif anak PTK per Tahun Buku", () => {
  it("tarif siswa tanpa tahun dan tahun lain tidak dianggap tarif khusus tahun pilihan", () => {
    const data = source(); data.tarif = [
      { id: "1", jenis_id: "jenis", siswa_id: "s", kelas_id: null, tahun_ajaran_id: null, angkatan_id: null, aktif: true, nominal: 100 },
      { id: "2", jenis_id: "jenis", siswa_id: "s", kelas_id: null, tahun_ajaran_id: "tb-lain", angkatan_id: null, aktif: true, nominal: 200 },
    ];
    const item = report(data).items[0];
    expect(item.tarifStatus).toBe("belum_diisi");
    expect(item.tarifUmumTersedia).toBe(true);
  });
  it("tarif siswa+kelas+tahun mendahului siswa+tahun; jenis lain dan nonaktif diabaikan", () => {
    const data = source(); data.tarif = [
      { id: "1", jenis_id: "jenis", siswa_id: "s", kelas_id: null, tahun_ajaran_id: "tb", angkatan_id: null, aktif: true, nominal: 100 },
      { id: "2", jenis_id: "jenis", siswa_id: "s", kelas_id: "k", tahun_ajaran_id: "tb", angkatan_id: null, aktif: true, nominal: 200 },
      { id: "3", jenis_id: "lain", siswa_id: "s", kelas_id: "k", tahun_ajaran_id: "tb", angkatan_id: null, aktif: true, nominal: 999 },
    ];
    expect(report(data).items[0]).toMatchObject({ tarifStatus: "sudah_diisi", nominalTarif: 200 });
    data.tarif[1].aktif = false;
    expect(report(data).items[0].nominalTarif).toBe(100);
  });
  it("tarif kelas umum tidak menyembunyikan kebutuhan tarif khusus siswa", () => {
    const data = source(); data.tarif = [{ id: "1", jenis_id: "jenis", siswa_id: null, kelas_id: "k", tahun_ajaran_id: "tb", angkatan_id: null, aktif: true, nominal: 1900000 }];
    expect(report(data).items[0]).toMatchObject({ tarifStatus: "belum_diisi", tarifUmumTersedia: true });
  });
  it("tarif nol serta konflik nominal perlu tinjauan", () => {
    const data = source(); data.tarif = [{ id: "1", jenis_id: "jenis", siswa_id: "s", kelas_id: null, tahun_ajaran_id: "tb", angkatan_id: null, aktif: true, nominal: 0 }];
    expect(report(data).items[0].tarifStatus).toBe("perlu_tinjauan");
    data.tarif.push({ ...data.tarif[0], id: "2", nominal: 100 });
    expect(report(data).items[0].nominalTarif).toBeNull();
  });
});
