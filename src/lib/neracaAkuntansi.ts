/**
 * Neraca akuntansi (tab Neraca Akuntansi): pengelompokan akun dan surplus berjalan.
 *
 * Saldo dinyatakan menurut sisi alami KELOMPOK, sehingga akun kontra (mis. potongan
 * pendapatan 4600-4602, saldo normal debit) mengurangi pendapatan dan bukan menambah.
 */
import { hitungSaldoMenurutSisi } from "./saldoIsak35";

// Sesuai ISAK 35: gunakan pos_isak35 untuk pengelompokan neraca
const POS_ASET = ["aset_lancar", "aset_tidak_lancar"];
const POS_KEWAJIBAN = ["kewajiban_jangka_pendek", "kewajiban_jangka_panjang"];
const POS_ASET_NETO = ["aset_neto_tidak_terikat", "aset_neto_terikat_temporer", "aset_neto_terikat_permanen"];
const POS_PENDAPATAN = [
  "pendapatan_tidak_terikat",
  "pendapatan_terikat_temporer",
  "pendapatan_terikat_permanen",
  "pendapatan",
  "pendapatan_terbatas",
];
const POS_BEBAN = ["beban_program", "beban_penunjang", "beban", "beban_terbatas"];

export type Kelompok = "aset" | "kewajiban" | "aset_neto" | "pendapatan" | "beban";

export interface AkunNeracaInput {
  id: string;
  kode: string;
  nama: string;
  jenis?: string | null;
  pos_isak35?: string | null;
  saldo_normal?: string | null;
  saldo_awal?: number | string | null;
}

export interface AkunNeraca {
  kode: string;
  nama: string;
  kelompok: "aset" | "kewajiban" | "aset_neto";
  saldo: number;
}

// Fallback: jika pos_isak35 tidak diisi, gunakan kolom jenis (ISAK 35)
export function resolveKelompok(akun: Pick<AkunNeracaInput, "pos_isak35" | "jenis">): Kelompok | null {
  const pos = akun.pos_isak35 ?? null;
  if (pos) {
    if (POS_ASET.includes(pos)) return "aset";
    if (POS_KEWAJIBAN.includes(pos)) return "kewajiban";
    if (POS_ASET_NETO.includes(pos)) return "aset_neto";
    if (POS_PENDAPATAN.includes(pos)) return "pendapatan";
    if (POS_BEBAN.includes(pos)) return "beban";
  }
  const j = akun.jenis ?? null;
  if (j === "aset") return "aset";
  if (j === "kewajiban") return "kewajiban";
  if (j === "aset_neto") return "aset_neto";
  if (j === "pendapatan") return "pendapatan";
  if (j === "beban") return "beban";
  // Alias lama yang mungkin masih ada di data
  if (j === "liabilitas") return "kewajiban";
  if (j === "ekuitas") return "aset_neto";
  return null;
}

const SISI_KELOMPOK: Record<Kelompok, "D" | "K"> = {
  aset: "D", beban: "D", kewajiban: "K", aset_neto: "K", pendapatan: "K",
};

export function susunNeracaAkuntansi(
  akunList: AkunNeracaInput[],
  mutasi: Map<string, { debit: number; kredit: number }>,
) {
  const items: AkunNeraca[] = [];
  let surplusDefisit = 0; // pendapatan - beban (sesuai ISAK 35)

  for (const akun of akunList) {
    const kelompok = resolveKelompok(akun);
    if (!kelompok) continue;
    const m = mutasi.get(akun.id) ?? { debit: 0, kredit: 0 };
    const saldo = hitungSaldoMenurutSisi({
      sisi: SISI_KELOMPOK[kelompok],
      saldoNormal: akun.saldo_normal,
      saldoAwal: Number(akun.saldo_awal || 0),
      debit: m.debit,
      kredit: m.kredit,
    });

    if (kelompok === "aset" || kelompok === "kewajiban" || kelompok === "aset_neto") {
      items.push({ kode: akun.kode, nama: akun.nama, kelompok, saldo });
    } else if (kelompok === "pendapatan") {
      surplusDefisit += saldo;
    } else {
      surplusDefisit -= saldo;
    }
  }

  return { items: items.sort((a, b) => a.kode.localeCompare(b.kode)), surplusDefisit };
}
