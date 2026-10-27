import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { isAkunKas } from "@/lib/posIsak35";

// ============================================================
// TIPE FILTER PERIODE — bisa per tahun atau rentang tanggal
// ============================================================
export type PeriodeFilter =
  | { type: "tahun"; tahun: number }
  | { type: "range"; tglAwal: string; tglAkhir: string };

/** Ambil tahun dari filter (digunakan untuk lookup saldo_awal_isak35) */
function filterTahunSaldoAwal(filter: PeriodeFilter): number {
  return filter.type === "tahun" ? filter.tahun : parseInt(filter.tglAwal.substring(0, 4));
}

/** Label periode untuk judul laporan */
export function periodeLabel(filter: PeriodeFilter): string {
  if (filter.type === "tahun") return `Untuk Tahun yang Berakhir pada 31 Desember ${filter.tahun}`;
  return `Untuk Periode ${filter.tglAwal} s.d. ${filter.tglAkhir}`;
}

/** Label singkat posisi keuangan ("Per 31 Des 2025" atau "Per {tglAkhir}") */
export function posisiLabel(filter: PeriodeFilter): string {
  if (filter.type === "tahun") return `Per 31 Desember ${filter.tahun}`;
  return `Per ${filter.tglAkhir}`;
}

// Kategori departemen yang termasuk Unit Usaha & Dana — harus sama dengan
// pengelompokan tutup buku (TutupBuku.tsx) dan checkPeriodeLocked.
// Departemen tanpa kategori dianggap Unit Pendidikan (default ketat).
export const KATEGORI_USAHA_DANA = ["unit_usaha", "unit_dana_terikat", "unit_yayasan"];

export function useDepartemenGroups() {
  return useQuery({
    queryKey: ["departemen_groups"],
    queryFn: async () => {
      const { data } = await supabase
        .from("departemen")
        .select("id, kode, nama, kategori")
        .eq("aktif", true);
      const rows = (data as any[]) || [];
      const pendidikanDepts: { id: string; kode: string; nama: string }[] = rows
        .filter(d => !KATEGORI_USAHA_DANA.includes(d.kategori))
        .sort((a, b) => (a.nama || "").localeCompare(b.nama || ""));
      const usahaDepts: { id: string; kode: string; nama: string }[] = rows
        .filter(d => KATEGORI_USAHA_DANA.includes(d.kategori))
        .sort((a, b) => (a.nama || "").localeCompare(b.nama || ""));
      const pendidikanIds = pendidikanDepts.map(d => d.id);
      const usahaIds = usahaDepts.map(d => d.id);
      return { pendidikanIds, pendidikanDepts, usahaIds, usahaDepts };
    },
    staleTime: Infinity,
  });
}

interface SaldoAkun {
  akun_id: string;
  kode: string;
  nama: string;
  pos_isak35: string;
  saldo_normal: string;
  urutan_isak35: number;
  saldo: number;
}

async function hitungSaldoAkun(filter: PeriodeFilter, departemenIds?: string[], includeDraf = false): Promise<SaldoAkun[]> {
  const { data: akunList, error: akunErr } = await supabase
    .from("akun_rekening")
    .select("id, kode, nama, pos_isak35, saldo_normal, urutan_isak35, saldo_awal")
    .not("pos_isak35", "is", null)
    .eq("aktif", true)
    .order("urutan_isak35");
  if (akunErr) throw akunErr;

  // ── Hitung mutasi sesuai mode filter ─────────────────────────
  let mutasiRows: any[];
  if (filter.type === "tahun") {
    const rpcName = includeDraf ? "hitung_mutasi_akun_incl_draft" : "hitung_mutasi_akun";
    const rpcParams: any = { p_tahun: filter.tahun };
    if (departemenIds && departemenIds.length > 0) rpcParams.p_departemen_ids = departemenIds;
    const { data, error } = await (supabase as any).rpc(rpcName, rpcParams);
    if (error) throw error;
    mutasiRows = data || [];
  } else {
    const rpcName = includeDraf ? "hitung_mutasi_akun_range_incl_draft" : "hitung_mutasi_akun_range";
    const rpcParams: any = { p_tgl_awal: filter.tglAwal, p_tgl_akhir: filter.tglAkhir };
    if (departemenIds && departemenIds.length > 0) rpcParams.p_departemen_ids = departemenIds;
    const { data, error } = await (supabase as any).rpc(rpcName, rpcParams);
    if (error) throw error;
    mutasiRows = data || [];
  }

  const mutasi: Record<string, { debit: number; kredit: number }> = {};
  for (const d of mutasiRows) {
    mutasi[d.akun_id] = {
      debit:  Number(d.total_debit  || 0),
      kredit: Number(d.total_kredit || 0),
    };
  }

  // ── Saldo awal — selalu diambil berdasarkan tahun awal periode ─
  // (Untuk range, gunakan tahun dari tglAwal)
  const tahunSaldoAwal = filterTahunSaldoAwal(filter);
  let saldoAwalQuery = supabase
    .from("saldo_awal_isak35" as any)
    .select("akun_id, saldo")
    .eq("tahun", tahunSaldoAwal);
  if (departemenIds && departemenIds.length > 0)
    saldoAwalQuery = (saldoAwalQuery as any).in("departemen_id", departemenIds);
  const { data: saldoAwalData } = await saldoAwalQuery;
  const saldoAwalMap: Record<string, number> = {};
  for (const s of (saldoAwalData as any[]) || [])
    saldoAwalMap[s.akun_id] = (saldoAwalMap[s.akun_id] ?? 0) + Number(s.saldo || 0);

  // Jika saldo_awal_isak35 kosong untuk tahun ini, gunakan 0 — bukan akun.saldo_awal.
  return (akunList || []).map((akun: any) => {
    const m = mutasi[akun.id] || { debit: 0, kredit: 0 };
    const saldoAwal = saldoAwalMap[akun.id] ?? 0;
    const saldo = akun.saldo_normal === "D"
      ? saldoAwal + m.debit - m.kredit
      : saldoAwal + m.kredit - m.debit;
    return {
      akun_id: akun.id, kode: akun.kode, nama: akun.nama,
      pos_isak35: akun.pos_isak35, saldo_normal: akun.saldo_normal,
      urutan_isak35: akun.urutan_isak35, saldo,
    };
  });
}

// ============================================================
// Rekonsiliasi rekening antar lembaga/bagian (1900, 1901, 1902)
// Akun ini harus bersaldo NOL per tanggal laporan eksternal —
// saldo tersisa berarti ada transfer yang belum dicatat lawannya.
// ============================================================
export const KODE_REKENING_ANTAR = ["1900", "1901", "1902"];

export interface RekonAntarRow {
  departemen_id: string | null;
  akun_id: string;
  departemen: string;
  kode: string;
  nama: string;
  saldo: number;
}

export function useRekonRekeningAntar(filter: PeriodeFilter) {
  // Saldo kumulatif s.d. akhir periode (sama seperti neraca)
  const tglAkhir = filter.type === "tahun" ? `${filter.tahun}-12-31` : filter.tglAkhir;
  const tahun = parseInt(tglAkhir.substring(0, 4));

  return useQuery({
    queryKey: ["rekon_rekening_antar", tglAkhir],
    queryFn: async () => {
      const { data: akunList, error: akunErr } = await supabase
        .from("akun_rekening")
        .select("id, kode, nama, saldo_normal")
        .in("kode", KODE_REKENING_ANTAR);
      if (akunErr) throw akunErr;
      const akunIds = (akunList || []).map((a: any) => a.id);
      if (akunIds.length === 0) return { rows: [] as RekonAntarRow[], total: 0 };

      const akunById: Record<string, any> = {};
      for (const a of (akunList as any[]) || []) akunById[a.id] = a;

      const { data: depts } = await supabase
        .from("departemen")
        .select("id, nama");
      const deptById: Record<string, string> = {};
      for (const d of (depts as any[]) || []) deptById[d.id] = d.nama;

      // saldo per (departemen, akun) = saldo awal tahun berjalan + mutasi tahun berjalan
      const saldoMap: Record<string, number> = {};
      const keyOf = (dept: string | null, akun: string) => `${dept ?? "-"}|${akun}`;

      const { data: saldoAwal } = await (supabase
        .from("saldo_awal_isak35" as any)
        .select("departemen_id, akun_id, saldo")
        .eq("tahun", tahun)
        .in("akun_id", akunIds) as any);
      for (const s of (saldoAwal as any[]) || [])
        saldoMap[keyOf(s.departemen_id, s.akun_id)] =
          (saldoMap[keyOf(s.departemen_id, s.akun_id)] ?? 0) + Number(s.saldo || 0);

      // mutasi tahun berjalan, paginasi (PostgREST max 1000 baris)
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data: rows, error } = await supabase
          .from("jurnal_detail")
          .select("akun_id, debit, kredit, jurnal!inner(departemen_id, tanggal, status, tipe)")
          .in("akun_id", akunIds)
          .eq("jurnal.status", "posted")
          .gte("jurnal.tanggal", `${tahun}-01-01`)
          .lte("jurnal.tanggal", tglAkhir)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        for (const r of (rows as any[]) || []) {
          if ((r.jurnal?.tipe ?? "") === "penutup") continue;
          const a = akunById[r.akun_id];
          const arah = a?.saldo_normal === "K" ? -1 : 1;
          const k = keyOf(r.jurnal?.departemen_id ?? null, r.akun_id);
          saldoMap[k] = (saldoMap[k] ?? 0) + arah * (Number(r.debit || 0) - Number(r.kredit || 0));
        }
        if (((rows as any[]) || []).length < pageSize) break;
      }

      const result: RekonAntarRow[] = [];
      let total = 0;
      for (const [k, saldo] of Object.entries(saldoMap)) {
        if (Math.abs(saldo) < 0.005) continue;
        const [deptId, akunId] = k.split("|");
        const a = akunById[akunId];
        result.push({
          departemen_id: deptId === "-" ? null : deptId,
          akun_id: akunId,
          departemen: deptId === "-" ? "(Tanpa Departemen)" : (deptById[deptId] ?? deptId),
          kode: a?.kode ?? "?",
          nama: a?.nama ?? "?",
          saldo,
        });
        total += saldo;
      }
      result.sort((x, y) => x.kode.localeCompare(y.kode) || x.departemen.localeCompare(y.departemen));
      return { rows: result, total };
    },
  });
}

export interface RekonAntarDetailRow {
  tanggal: string;
  nomor: string;
  keterangan: string;
  tipe: string;
  debit: number;
  kredit: number;
  saldoRunning: number;
}

/** Rincian transaksi satu rekening antar lembaga/bagian pada satu unit,
 *  untuk menelusuri transfer mana yang belum berpasangan. Dimuat lazy
 *  (saat baris rekonsiliasi di-expand). */
export function useRekonRekeningAntarDetail(
  filter: PeriodeFilter,
  akunId: string,
  departemenId: string | null,
  enabled: boolean,
) {
  const tglAkhir = filter.type === "tahun" ? `${filter.tahun}-12-31` : filter.tglAkhir;
  const tahun = parseInt(tglAkhir.substring(0, 4));

  return useQuery({
    enabled,
    queryKey: ["rekon_antar_detail", tglAkhir, akunId, departemenId ?? "-"],
    queryFn: async () => {
      const { data: akun } = await supabase
        .from("akun_rekening")
        .select("saldo_normal")
        .eq("id", akunId)
        .maybeSingle();
      const arah = (akun as any)?.saldo_normal === "K" ? -1 : 1;

      // saldo awal tahun berjalan (carry dari tahun sebelumnya)
      let saldoAwalQ = supabase
        .from("saldo_awal_isak35" as any)
        .select("saldo")
        .eq("tahun", tahun)
        .eq("akun_id", akunId);
      saldoAwalQ = departemenId
        ? (saldoAwalQ as any).eq("departemen_id", departemenId)
        : (saldoAwalQ as any).is("departemen_id", null);
      const { data: saldoAwalRows } = await (saldoAwalQ as any);
      const saldoAwal = ((saldoAwalRows as any[]) || []).reduce(
        (s, r) => s + Number(r.saldo || 0), 0,
      );

      // mutasi tahun berjalan, paginasi (PostgREST max 1000 baris)
      const pageSize = 1000;
      const raw: any[] = [];
      for (let from = 0; ; from += pageSize) {
        let q = supabase
          .from("jurnal_detail")
          .select("debit, kredit, jurnal!inner(nomor, keterangan, tanggal, status, tipe, departemen_id)")
          .eq("akun_id", akunId)
          .eq("jurnal.status", "posted")
          .gte("jurnal.tanggal", `${tahun}-01-01`)
          .lte("jurnal.tanggal", tglAkhir);
        q = departemenId
          ? (q as any).eq("jurnal.departemen_id", departemenId)
          : (q as any).is("jurnal.departemen_id", null);
        const { data: rows, error } = await (q as any).range(from, from + pageSize - 1);
        if (error) throw error;
        for (const r of (rows as any[]) || []) {
          if ((r.jurnal?.tipe ?? "") === "penutup") continue;
          raw.push(r);
        }
        if (((rows as any[]) || []).length < pageSize) break;
      }

      raw.sort((a, b) =>
        String(a.jurnal?.tanggal).localeCompare(String(b.jurnal?.tanggal)) ||
        String(a.jurnal?.nomor ?? "").localeCompare(String(b.jurnal?.nomor ?? "")));

      let running = saldoAwal;
      const rows: RekonAntarDetailRow[] = raw.map((r) => {
        const debit = Number(r.debit || 0);
        const kredit = Number(r.kredit || 0);
        running += arah * (debit - kredit);
        return {
          tanggal: r.jurnal?.tanggal,
          nomor: r.jurnal?.nomor ?? "-",
          keterangan: r.jurnal?.keterangan ?? "",
          tipe: r.jurnal?.tipe ?? "",
          debit,
          kredit,
          saldoRunning: running,
        };
      });

      return { saldoAwal, rows, saldoAkhir: running };
    },
  });
}

function depresiasiSatuAset(harga: number, umurBulan: number, tglPerolehan: string, tahun: number) {
  const bpb = harga / umurBulan;
  const tgl = new Date(tglPerolehan);
  const mulai = tgl.getFullYear() * 12 + tgl.getMonth();
  let bebanTahunIni = 0, akumulasi = 0;
  for (let i = 0; i < umurBulan; i++) {
    const bulanKe = mulai + i;
    const thn = Math.floor(bulanKe / 12);
    if (thn <= tahun) akumulasi += bpb;
    if (thn === tahun) bebanTahunIni += bpb;
  }
  return { bebanTahunIni, akumulasi, nilaiBuku: harga - akumulasi };
}

async function totalDepresiasi(tahun: number, departemenIds?: string[]) {
  let q = supabase.from("aset_tetap" as any).select("*").eq("aktif", true);
  if (departemenIds && departemenIds.length > 0) q = (q as any).in("departemen_id", departemenIds);
  const { data, error } = await q;
  if (error) throw error;
  let totalHP = 0, totalBeban = 0, totalAkum = 0, totalNB = 0;
  for (const a of (data as any[]) || []) {
    totalHP += Number(a.harga_perolehan);
    const r = depresiasiSatuAset(Number(a.harga_perolehan), a.umur_ekonomis_bulan, a.tanggal_perolehan, tahun);
    totalBeban += r.bebanTahunIni; totalAkum += r.akumulasi; totalNB += r.nilaiBuku;
  }
  return { totalHP, totalBeban, totalAkum, totalNB };
}

// ============================================================
// Akun yang di-EXCLUDE dari laporan ISAK 35
// ============================================================
const EXCLUDE_BEBAN_TRANSFER: string[] = [];
// Akun rekening antar lembaga/bagian (1901, 1902) TIDAK dikecualikan:
// saldonya tidak saling menghilangkan antar unit (sisi lawan transfer
// dicatat sebagai kas di unit penerima), sehingga membuangnya membuat
// neraca tidak seimbang.
const EXCLUDE_ASET_INTERNAL: string[] = [];

function byPos(saldo: SaldoAkun[], ...positions: string[]) {
  return saldo.filter(a => positions.includes(a.pos_isak35));
}

function sumSaldo(items: SaldoAkun[]) {
  return items.reduce((s, a) => s + a.saldo, 0);
}

/** Ambil seluruh baris hasil RPC dengan paginasi — PostgREST membatasi
 *  maksimal 1000 baris per request, sedangkan detail jurnal kas setahun
 *  bisa belasan ribu baris. */
async function rpcAllRows(fn: string, params: Record<string, any>): Promise<any[]> {
  const pageSize = 1000;
  const all: any[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await (supabase as any).rpc(fn, params).range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

interface AkunMeta { id: string; kode: string; nama: string; pos_isak35: string | null; jenis: string }

async function getAkunMeta(): Promise<Record<string, AkunMeta>> {
  const { data } = await supabase
    .from("akun_rekening")
    .select("id, kode, nama, pos_isak35, jenis")
    .eq("aktif", true);
  const map: Record<string, AkunMeta> = {};
  for (const a of (data as any[]) || []) map[a.id] = a;
  return map;
}

export function useLaporanKomprehensif(filter: PeriodeFilter, departemenIds?: string[]) {
  return useQuery({
    queryKey: ["isak35_komprehensif", filter, departemenIds],
    queryFn: async () => {
      const saldo = await hitungSaldoAkun(filter, departemenIds);

      const pendapatan = byPos(saldo, "pendapatan_tidak_terikat");
      const totalPendapatan = sumSaldo(pendapatan);

      const beban = byPos(saldo, "beban_program", "beban_penunjang")
        .filter(a => !EXCLUDE_BEBAN_TRANSFER.includes(a.kode));
      const totalBeban = sumSaldo(beban);

      const surplusDefisit = totalPendapatan - totalBeban;

      const pendapatanTerbatas = byPos(saldo, "pendapatan_terikat_temporer", "pendapatan_terikat_permanen");
      const totalPT = sumSaldo(pendapatanTerbatas);

      const bebanTerbatas = byPos(saldo, "beban_terbatas");
      const totalBT = sumSaldo(bebanTerbatas);

      const surplusTerbatas = totalPT - totalBT;

      const pklItems = byPos(saldo, "pkl");
      const pkl = sumSaldo(pklItems);

      return {
        pendapatan, totalPendapatan,
        beban, totalBeban,
        surplusDefisit,
        pendapatanTerbatas, totalPT,
        bebanTerbatas, totalBT,
        surplusTerbatas,
        pkl,
        totalKomprehensif: surplusDefisit + surplusTerbatas + pkl,
      };
    },
  });
}

export function useJumlahDraftJurnal(filter: PeriodeFilter, departemenIds?: string[]) {
  const tglAwal = filter.type === "tahun" ? `${filter.tahun}-01-01` : filter.tglAwal;
  const tglAkhir = filter.type === "tahun" ? `${filter.tahun}-12-31` : filter.tglAkhir;
  return useQuery({
    queryKey: ["jumlah_draft_jurnal", tglAwal, tglAkhir, departemenIds],
    queryFn: async () => {
      let q = supabase
        .from("jurnal")
        .select("id", { count: "exact", head: true })
        .eq("status", "draft")
        .gte("tanggal", tglAwal)
        .lte("tanggal", tglAkhir);
      if (departemenIds && departemenIds.length > 0)
        q = (q as any).in("departemen_id", departemenIds);
      const { count } = await q;
      return count ?? 0;
    },
    staleTime: 30_000,
  });
}

export function useLaporanPosisiKeuangan(filter: PeriodeFilter, departemenIds?: string[], includeDraf = false) {
  // Untuk mode range: laporan posisi keuangan (neraca) menyajikan saldo KUMULATIF
  // s.d. tglAkhir. Agar hasilnya benar, mutasi dihitung dari 1 Jan tahun tglAkhir
  // hingga tglAkhir (bukan dari tglAwal yang mungkin di tengah tahun).
  const normalizedFilter: PeriodeFilter =
    filter.type === "range"
      ? { type: "range", tglAwal: `${filter.tglAkhir.substring(0, 4)}-01-01`, tglAkhir: filter.tglAkhir }
      : filter;

  return useQuery({
    queryKey: ["isak35_posisi", filter, departemenIds, includeDraf],
    queryFn: async () => {
      const saldo = await hitungSaldoAkun(normalizedFilter, departemenIds, includeDraf);

      const asetLancarItems = byPos(saldo, "aset_lancar");
      const totalAL = sumSaldo(asetLancarItems);

      const asetTidakLancarItems = byPos(saldo, "aset_tidak_lancar")
        .filter(a => !EXCLUDE_ASET_INTERNAL.includes(a.kode));
      const totalATL = sumSaldo(asetTidakLancarItems);

      const totalAset = totalAL + totalATL;

      const liabJPItems = byPos(saldo, "kewajiban_jangka_pendek");
      const totalLJP = sumSaldo(liabJPItems);

      const liabJGItems = byPos(saldo, "kewajiban_jangka_panjang");
      const totalLJG = sumSaldo(liabJGItems);

      const totalLiabilitas = totalLJP + totalLJG;

      const asetNetoItems = byPos(saldo, "aset_neto_tidak_terikat", "aset_neto_terikat_temporer", "aset_neto_terikat_permanen");
      const totalAsetNetoSaldo = sumSaldo(asetNetoItems);

      const pendapatanTT = sumSaldo(byPos(saldo, "pendapatan_tidak_terikat"));
      const bebanTT = sumSaldo(
        byPos(saldo, "beban_program", "beban_penunjang")
          .filter(a => !EXCLUDE_BEBAN_TRANSFER.includes(a.kode))
      );
      const surplusBerjalan = pendapatanTT - bebanTT;

      const pendapatanTerbatas = sumSaldo(byPos(saldo, "pendapatan_terikat_temporer", "pendapatan_terikat_permanen"));
      const bebanTerbatas = sumSaldo(byPos(saldo, "beban_terbatas"));
      const surplusTerbatasBerjalan = pendapatanTerbatas - bebanTerbatas;

      const totalAsetNeto = totalAsetNetoSaldo + surplusBerjalan + surplusTerbatasBerjalan;

      const selisih = totalAset - totalLiabilitas - totalAsetNeto;

      return {
        asetLancarItems, totalAL,
        asetTidakLancarItems, totalATL,
        totalAset,
        liabJPItems, totalLJP,
        liabJGItems, totalLJG,
        totalLiabilitas,
        asetNetoItems, totalAsetNetoSaldo,
        surplusBerjalan, surplusTerbatasBerjalan,
        totalAsetNeto,
        selisih,
      };
    },
  });
}

// ============================================================
// LAPORAN ARUS KAS — METODE LANGSUNG (ISAK 35)
// ============================================================
export function useLaporanArusKas(filter: PeriodeFilter, departemenIds?: string[]) {
  return useQuery({
    queryKey: ["isak35_arus_kas_direct", filter, departemenIds],
    queryFn: async () => {
      const akunMeta = await getAkunMeta();

      const akunKasIds = new Set<string>();
      for (const a of Object.values(akunMeta)) {
        if (a.pos_isak35 === "aset_lancar" && isAkunKas(a.kode, a.nama)) {
          akunKasIds.add(a.id);
        }
      }

      const kasIdsArr = Array.from(akunKasIds);
      const tahunSaldoAwal = filterTahunSaldoAwal(filter);

      // kasAwal dari saldo_awal_isak35 (tahun awal periode)
      const saldoAwalQ = supabase
        .from("saldo_awal_isak35" as any)
        .select("akun_id, saldo")
        .eq("tahun", tahunSaldoAwal)
        .in("akun_id", kasIdsArr.length > 0 ? kasIdsArr : ["00000000-0000-0000-0000-000000000000"]);
      if (departemenIds && departemenIds.length > 0) (saldoAwalQ as any).in("departemen_id", departemenIds);
      const { data: saldoAwalRows } = await saldoAwalQ;
      let kasAwal = 0;
      for (const r of (saldoAwalRows as any[]) || []) kasAwal += Number(r.saldo || 0);

      let allDetails: any[] = [];
      if (kasIdsArr.length > 0) {
        if (filter.type === "tahun") {
          const rpc: any = { p_tahun: filter.tahun, p_akun_kas_ids: kasIdsArr };
          if (departemenIds && departemenIds.length > 0) rpc.p_departemen_ids = departemenIds;
          allDetails = await rpcAllRows("get_detail_jurnal_kas", rpc);
        } else {
          const rpc: any = { p_tgl_awal: filter.tglAwal, p_tgl_akhir: filter.tglAkhir, p_akun_kas_ids: kasIdsArr };
          if (departemenIds && departemenIds.length > 0) rpc.p_departemen_ids = departemenIds;
          allDetails = await rpcAllRows("get_detail_jurnal_kas_range", rpc);
        }
      }

      const perJurnal: Record<string, any[]> = {};
      for (const d of allDetails) {
        if (!perJurnal[d.jurnal_id]) perJurnal[d.jurnal_id] = [];
        perJurnal[d.jurnal_id].push(d);
      }

      const acc = {
        operasiPenerimaan: 0,
        operasiPengeluaran: 0,
        investasiPenerimaan: 0,
        investasiPengeluaran: 0,
        pendanaanPenerimaan: 0,
        pendanaanPengeluaran: 0,
        rincianPenerimaanOperasi: {} as Record<string, number>,
        rincianPengeluaranOperasi: {} as Record<string, number>,
      };

      const klasifikasiByLawan = (lawanPos: string | null | undefined, lawanKode?: string): "operasi" | "investasi" | "pendanaan" => {
        // Rekening antar lembaga/bagian = kas riil keluar/masuk unit → operasi,
        // agar kenaikan bersih kas tetap sama dengan kas akhir - kas awal.
        if (lawanKode && EXCLUDE_ASET_INTERNAL.includes(lawanKode)) return "operasi";
        if (lawanPos === "aset_tidak_lancar") return "investasi";
        if (lawanPos === "kewajiban_jangka_panjang") return "pendanaan";
        if (lawanPos === "aset_neto_tidak_terikat" || lawanPos === "aset_neto_terikat_temporer" || lawanPos === "aset_neto_terikat_permanen") return "pendanaan";
        return "operasi";
      };

      const namaPos = (pos: string | null | undefined, fallbackNama: string): string => {
        switch (pos) {
          case "pendapatan_tidak_terikat": return "Penerimaan Kas dari Donasi/Sumbangan & Jasa Pendidikan";
          case "pendapatan_terikat_temporer": return "Penerimaan Kas dari Sumbangan Terikat Temporer";
          case "pendapatan_terikat_permanen": return "Penerimaan Kas dari Sumbangan Terikat Permanen";
          case "beban_program": return "Pembayaran Kas untuk Beban Program";
          case "beban_penunjang": return "Pembayaran Kas untuk Beban Penunjang";
          case "kewajiban_jangka_pendek": return "Pembayaran/Penerimaan Liabilitas Jangka Pendek";
          default: return fallbackNama;
        }
      };

      let totalNetKasRaw = 0;
      for (const jId of Object.keys(perJurnal)) {
        const rows = perJurnal[jId];
        const sisiKas = rows.filter(r => akunKasIds.has(r.akun_id));
        if (sisiKas.length === 0) continue;
        const sisiLawan = rows.filter(r => !akunKasIds.has(r.akun_id));

        const totalKasDebit  = sisiKas.reduce((s, r) => s + Number(r.debit  || 0), 0);
        const totalKasKredit = sisiKas.reduce((s, r) => s + Number(r.kredit || 0), 0);
        const totalLawanDebit  = sisiLawan.reduce((s, r) => s + Number(r.debit  || 0), 0);
        const totalLawanKredit = sisiLawan.reduce((s, r) => s + Number(r.kredit || 0), 0);

        const netKas = totalKasDebit - totalKasKredit;
        totalNetKasRaw += netKas;
        if (netKas === 0) continue;

        const isPenerimaan = netKas > 0;
        const totalLawanRelevan = isPenerimaan ? totalLawanKredit : totalLawanDebit;
        const absKas = Math.abs(netKas);

        for (const lr of sisiLawan) {
          const meta = akunMeta[lr.akun_id];
          if (meta?.kode && EXCLUDE_BEBAN_TRANSFER.includes(meta.kode)) continue;
          const pos = meta?.pos_isak35 ?? null;
          const nilaiLawan = isPenerimaan ? Number(lr.kredit || 0) : Number(lr.debit || 0);
          if (nilaiLawan === 0) continue;
          const porsi = totalLawanRelevan > 0 ? (nilaiLawan / totalLawanRelevan) * absKas : 0;
          const cat = klasifikasiByLawan(pos, meta?.kode);
          if (isPenerimaan) {
            if (cat === "operasi") acc.operasiPenerimaan += porsi;
            else if (cat === "investasi") acc.investasiPenerimaan += porsi;
            else acc.pendanaanPenerimaan += porsi;
            if (cat === "operasi") {
              const key = namaPos(pos, meta?.nama || "Penerimaan Lain");
              acc.rincianPenerimaanOperasi[key] = (acc.rincianPenerimaanOperasi[key] || 0) + porsi;
            }
          } else {
            if (cat === "operasi") acc.operasiPengeluaran += porsi;
            else if (cat === "investasi") acc.investasiPengeluaran += porsi;
            else acc.pendanaanPengeluaran += porsi;
            if (cat === "operasi") {
              const key = namaPos(pos, meta?.nama || "Pengeluaran Lain");
              acc.rincianPengeluaranOperasi[key] = (acc.rincianPengeluaranOperasi[key] || 0) + porsi;
            }
          }
        }
      }

      const arusOperasi   = acc.operasiPenerimaan   - acc.operasiPengeluaran;
      const arusInvestasi = acc.investasiPenerimaan - acc.investasiPengeluaran;
      const arusPendanaan = acc.pendanaanPenerimaan - acc.pendanaanPengeluaran;
      const kenaikanKas   = arusOperasi + arusInvestasi + arusPendanaan;

      return {
        penerimaanOperasi: acc.operasiPenerimaan,
        pengeluaranOperasi: acc.operasiPengeluaran,
        arusOperasi,
        arusInvestasi,
        arusPendanaan,
        kenaikanKas,
        kasAwal,
        kasAkhir: kasAwal + totalNetKasRaw,
        rincianPenerimaanOperasi: acc.rincianPenerimaanOperasi,
        rincianPengeluaranOperasi: acc.rincianPengeluaranOperasi,
        investasiPenerimaan: acc.investasiPenerimaan,
        investasiPengeluaran: acc.investasiPengeluaran,
        pendanaanPenerimaan: acc.pendanaanPenerimaan,
        pendanaanPengeluaran: acc.pendanaanPengeluaran,
      };
    },
  });
}

export function useAsetTetapList(departemenIds?: string[]) {
  return useQuery({
    queryKey: ["aset_tetap", departemenIds],
    queryFn: async () => {
      let q = supabase.from("aset_tetap" as any).select("*").eq("aktif", true).order("tanggal_perolehan");
      if (departemenIds && departemenIds.length > 0) q = (q as any).in("departemen_id", departemenIds);
      const { data, error } = await q;
      if (error) throw error;
      const tahun = new Date().getFullYear();
      return ((data as any[]) || []).map((a: any) => ({ ...a, ...depresiasiSatuAset(Number(a.harga_perolehan), a.umur_ekonomis_bulan, a.tanggal_perolehan, tahun) }));
    },
  });
}

export function useCreateAsetTetap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { jenis_aset: string; tanggal_perolehan: string; umur_ekonomis_bulan: number; harga_perolehan: number; keterangan?: string; departemen_id?: string }) => {
      const { error } = await supabase.from("aset_tetap" as any).insert(v as any);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["aset_tetap"] }); toast.success("Aset berhasil ditambahkan"); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteAsetTetap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("aset_tetap" as any).update({ aktif: false } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["aset_tetap"] }); toast.success("Aset dihapus"); },
    onError: (e: any) => toast.error(e.message),
  });
}
