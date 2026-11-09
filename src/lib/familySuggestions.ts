const PAGE_SIZE = 500;
// A Cloudflare Worker may only make a limited number of subrequests per invocation,
// so reading pages must always be bounded.
const MAX_PAGES = 20;

/**
 * Read every RPC page so suggestions beyond the API row cap remain searchable.
 *
 * Stops when a page is short, when the server returned more rows than requested
 * (it ignored the range and already sent everything), or when a page adds no new
 * rows (the server repeated a page). Fails loudly instead of looping forever.
 */
export async function fetchAllFamilySuggestions<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  keyOf: (row: T) => string = (row) => JSON.stringify(row),
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  for (let pageNo = 0; pageNo < MAX_PAGES; pageNo += 1) {
    const from = pageNo * PAGE_SIZE;
    const page = await fetchPage(from, from + PAGE_SIZE - 1);
    let added = 0;
    for (const row of page) {
      const key = keyOf(row);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      added += 1;
    }
    if (page.length !== PAGE_SIZE || added === 0) return rows;
  }
  throw new Error("Daftar saran keluarga terlalu banyak halaman untuk dimuat");
}

type SearchableFamily = {
  siswa: Array<{ nama: string; nis: string | null }>;
};

/** Search all loaded groups before paginating, including names with extra spaces. */
export function filterFamilySuggestions<T extends SearchableFamily>(
  groups: T[],
  search: string,
): T[] {
  const terms = search.trim().toLocaleLowerCase("id").split(/\s+/).filter(Boolean);
  if (terms.length === 0) return groups;
  return groups.filter((group) =>
    group.siswa.some((student) => {
      const text = `${student.nama} ${student.nis ?? ""}`.toLocaleLowerCase("id");
      return terms.every((term) => text.includes(term));
    }),
  );
}
