/** Read every RPC page so suggestions beyond the API row cap remain searchable. */
export async function fetchAllFamilySuggestions<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
): Promise<T[]> {
  const pageSize = 500;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
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
