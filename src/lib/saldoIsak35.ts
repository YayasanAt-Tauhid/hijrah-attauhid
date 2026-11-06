/**
 * Saldo akun untuk laporan ISAK 35.
 *
 * Laporan menjumlahkan akun per pos (pendapatan, beban, aset, ...), jadi tiap saldo harus
 * dinyatakan menurut sisi alami POS-nya, bukan sisi normal akunnya sendiri. Akun kontra
 * (mis. potongan/keringanan 4600-4602: berpos pendapatan tetapi bersaldo normal debit)
 * lalu otomatis bernilai negatif dan mengurangi pendapatan. Dengan saldo menurut sisi akun,
 * potongan malah ditambahkan ke pendapatan dan neraca selisih 2 x total potongan.
 */

type Sisi = "D" | "K";

/** Sisi alami (sisi saldo normal) tiap kelompok pos ISAK 35; null bila pos tak dikenal. */
export function sisiAlamiPos(pos: string | null | undefined): Sisi | null {
  if (!pos) return null;
  if (pos.startsWith("aset_neto")) return "K";
  if (pos.startsWith("aset")) return "D";
  if (pos.startsWith("beban")) return "D";
  if (pos.startsWith("kewajiban")) return "K";
  if (pos.startsWith("pendapatan")) return "K";
  if (pos === "pkl") return "K";
  return null;
}

function sisiAkun(saldoNormal: string | null | undefined): Sisi {
  return saldoNormal === "D" || saldoNormal === "debit" ? "D" : "K";
}

export interface InputSaldoPos {
  pos: string | null | undefined;
  /** Saldo normal akun itu sendiri ('D'/'K'); menentukan arti saldo awal. */
  saldoNormal: string | null | undefined;
  /** Saldo awal, dinyatakan menurut sisi normal akun (positif = bersaldo di sisi normalnya). */
  saldoAwal: number;
  debit: number;
  kredit: number;
}

export interface InputSaldoSisi {
  /** Sisi alami kelompok tempat akun dijumlahkan (mis. 'K' untuk pendapatan). */
  sisi: Sisi;
  saldoNormal: string | null | undefined;
  saldoAwal: number;
  debit: number;
  kredit: number;
}

/** Saldo akhir menurut sisi alami KELOMPOK: negatif berarti akun kontra bagi kelompoknya. */
export function hitungSaldoMenurutSisi({ sisi, saldoNormal, saldoAwal, debit, kredit }: InputSaldoSisi): number {
  const awalDebit = sisiAkun(saldoNormal) === "D" ? saldoAwal : -saldoAwal;
  const bersihDebit = awalDebit + debit - kredit;
  return sisi === "D" ? bersihDebit : -bersihDebit;
}

/** Saldo akhir menurut sisi alami pos: negatif berarti akun kontra bagi posnya. */
export function hitungSaldoMenurutPos({ pos, saldoNormal, saldoAwal, debit, kredit }: InputSaldoPos): number {
  return hitungSaldoMenurutSisi({
    sisi: sisiAlamiPos(pos) ?? sisiAkun(saldoNormal),
    saldoNormal, saldoAwal, debit, kredit,
  });
}
