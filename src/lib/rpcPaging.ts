// Paginasi hasil RPC (`RETURNS TABLE`) yang tahan terhadap server yang mengabaikan `.range()`.
//
// PostgREST (Supabase) menghormati range dan membatasi 1000 baris per respons. Rustbase TIDAK
// menerapkan limit/offset pada RPC: setiap panggilan mengembalikan SEMUA baris. Loop lama
// ("lanjut selama halaman berisi 1000 baris") lalu tidak pernah berhenti pada hasil besar
// (halaman Arus Kas ISAK 35: 29.481 baris -> loading tanpa akhir). Fungsi ini mengenali kedua
// perilaku tersebut dan tidak bergantung pada Supabase supaya mudah dites.

export interface RpcPage<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export interface RpcPagingOptions {
  pageSize?: number;
  /** Pagar pengaman terhadap loop tak berujung; melewatinya adalah error, bukan pemotongan data. */
  maxPages?: number;
}

// Sidik jari halaman: panjang + baris pertama + baris terakhir. Hasil RPC diurutkan tetap,
// jadi halaman berbeda hampir pasti punya sidik jari berbeda; halaman yang sama berarti server
// mengabaikan range dan mengulang hasil yang sudah diterima.
function sidikJari(rows: unknown[]): string {
  return `${rows.length}|${JSON.stringify(rows[0])}|${JSON.stringify(rows[rows.length - 1])}`;
}

export async function fetchRpcAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<RpcPage<T>>,
  { pageSize = 1000, maxPages = 1000 }: RpcPagingOptions = {},
): Promise<T[]> {
  const all: T[] = [];
  let sebelumnya: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    if (rows.length === 0) return all;
    const sekarang = sidikJari(rows);
    // Server mengabaikan range dan mengulang halaman yang sama (hasil tepat satu halaman penuh).
    if (sekarang === sebelumnya) return all;
    all.push(...rows);
    // Kurang dari satu halaman: habis. Lebih dari satu halaman: server mengabaikan range dan
    // sudah mengirim seluruh hasil sekaligus.
    if (rows.length !== pageSize) return all;
    sebelumnya = sekarang;
  }
  throw new Error(`Paginasi RPC melebihi batas ${maxPages} halaman`);
}
