/**
 * Jurnal penutup tutup buku.
 *
 * Saldo pendapatan dan beban dihitung menurut sisi alami JENIS-nya (pendapatan = kredit,
 * beban = debit), bukan sisi normal akunnya. Akun kontra (mis. potongan 4600-4602: jenis
 * pendapatan, saldo normal debit) lalu bernilai negatif: ia ditutup di sisi KREDIT dan
 * mengurangi surplus. Menjumlahkan saldo menurut sisi akun malah menambahkannya ke
 * pendapatan dan men-debit-nya lagi, sehingga saldo potongan dobel dan surplus lebih besar.
 */
import { hitungSaldoMenurutSisi } from "./saldoIsak35";

export interface AkunPenutup {
  id: string;
  nama: string;
  jenis: string;
  saldo_normal: string;
  saldo_awal: number;
  totalDebit: number;
  totalKredit: number;
}

export interface BarisPenutup {
  akun_id: string;
  keterangan: string;
  debit: number;
  kredit: number;
}

export interface OpsiJurnalPenutup {
  akunEkuitasId: string;
  /** Nama unit, mis. "Unit Pendidikan". */
  label: string;
  /** Nama tahun buku, mis. "Tahun 2026". */
  namaTahun: string;
}

const sen = (n: number) => Math.round(n * 100) / 100;

function saldoAlami(a: AkunPenutup): number {
  const jenis = a.jenis?.toLowerCase();
  return sen(
    hitungSaldoMenurutSisi({
      sisi: jenis === "pendapatan" ? "K" : "D",
      saldoNormal: a.saldo_normal,
      saldoAwal: Number(a.saldo_awal || 0),
      debit: a.totalDebit,
      kredit: a.totalKredit,
    }),
  );
}

const pendapatanDanBeban = (akun: AkunPenutup[]) => ({
  pendapatan: akun.filter((a) => a.jenis?.toLowerCase() === "pendapatan"),
  beban: akun.filter((a) => a.jenis?.toLowerCase() === "beban"),
});

/** Pendapatan neto (setelah potongan), beban, dan surplus/defisit. */
export function ringkasLabaRugi(akun: AkunPenutup[]) {
  const { pendapatan, beban } = pendapatanDanBeban(akun);
  const totalPendapatan = sen(pendapatan.reduce((s, a) => s + saldoAlami(a), 0));
  const totalBeban = sen(beban.reduce((s, a) => s + saldoAlami(a), 0));
  return { totalPendapatan, totalBeban, labaRugi: sen(totalPendapatan - totalBeban) };
}

export function susunJurnalPenutup(akun: AkunPenutup[], { akunEkuitasId, label, namaTahun }: OpsiJurnalPenutup) {
  const { pendapatan, beban } = pendapatanDanBeban(akun);
  const { labaRugi } = ringkasLabaRugi(akun);
  const baris: BarisPenutup[] = [];

  for (const a of pendapatan) {
    const s = saldoAlami(a);
    if (s === 0) continue;
    baris.push({ akun_id: a.id, keterangan: `Penutup ${a.nama}`, debit: s > 0 ? s : 0, kredit: s < 0 ? -s : 0 });
  }
  for (const a of beban) {
    const s = saldoAlami(a);
    if (s === 0) continue;
    baris.push({ akun_id: a.id, keterangan: `Penutup ${a.nama}`, debit: s < 0 ? -s : 0, kredit: s > 0 ? s : 0 });
  }
  if (labaRugi > 0) {
    baris.push({ akun_id: akunEkuitasId, keterangan: `Surplus ${label} — ${namaTahun}`, debit: 0, kredit: labaRugi });
  } else if (labaRugi < 0) {
    baris.push({ akun_id: akunEkuitasId, keterangan: `Defisit ${label} — ${namaTahun}`, debit: -labaRugi, kredit: 0 });
  }

  return {
    labaRugi,
    baris,
    totalDebit: sen(baris.reduce((s, b) => s + b.debit, 0)),
    totalKredit: sen(baris.reduce((s, b) => s + b.kredit, 0)),
  };
}
