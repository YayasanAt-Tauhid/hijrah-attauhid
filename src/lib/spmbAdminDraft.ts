// Draf formulir "Daftarkan Calon Murid" (admin/TU) di localStorage browser.
// Dipisah per akun admin, kedaluwarsa 24 jam, dan dibersihkan saat logout.
// Berkas dokumen (File) tidak bisa disimpan di sini; admin perlu memilihnya lagi.

export const SPMB_ADMIN_DRAFT_PREFIX = "spmb-admin-draft:v1:";
export const SPMB_ADMIN_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

// Dihitung ulang dari konfigurasi saat dialog dibuka, jadi tidak perlu disimpan.
const DERIVED_KEYS = ["tahun_ajaran_id", "angkatan_id"] as const;

export type SpmbAdminDraft = { savedAt: number; form: Record<string, string> };

export function spmbAdminDraftKey(userId: string) {
  return `${SPMB_ADMIN_DRAFT_PREFIX}${userId}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function withoutDerived<T extends Record<string, unknown>>(form: T) {
  const copy: Record<string, unknown> = { ...form };
  for (const key of DERIVED_KEYS) delete copy[key];
  return copy;
}

export function isSpmbAdminFormDirty(form: Record<string, string>, baseline: Record<string, string>): boolean {
  const current = withoutDerived(form);
  const initial = withoutDerived(baseline);
  return Object.keys(current).some((key) => current[key] !== initial[key]);
}

export function saveSpmbAdminDraft(userId: string | null | undefined, form: Record<string, string>, now = Date.now()): boolean {
  const store = storage();
  if (!userId || !store) return false;
  try {
    const payload: SpmbAdminDraft = { savedAt: now, form: withoutDerived(form) as Record<string, string> };
    store.setItem(spmbAdminDraftKey(userId), JSON.stringify(payload));
    return true;
  } catch {
    return false; // penyimpanan penuh atau diblokir (mode privat)
  }
}

export function loadSpmbAdminDraft(userId: string | null | undefined, now = Date.now()): SpmbAdminDraft | null {
  const store = storage();
  if (!userId || !store) return null;
  try {
    const raw = store.getItem(spmbAdminDraftKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SpmbAdminDraft> | null;
    const valid = parsed
      && typeof parsed.savedAt === "number"
      && parsed.form && typeof parsed.form === "object" && !Array.isArray(parsed.form);
    if (!valid || now - (parsed.savedAt as number) > SPMB_ADMIN_DRAFT_TTL_MS) {
      store.removeItem(spmbAdminDraftKey(userId));
      return null;
    }
    return { savedAt: parsed.savedAt as number, form: parsed.form as Record<string, string> };
  } catch {
    try { store.removeItem(spmbAdminDraftKey(userId)); } catch { /* abaikan */ }
    return null;
  }
}

export function clearSpmbAdminDraft(userId: string | null | undefined) {
  const store = storage();
  if (!userId || !store) return;
  try { store.removeItem(spmbAdminDraftKey(userId)); } catch { /* abaikan */ }
}

export function clearAllSpmbAdminDrafts() {
  const store = storage();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.startsWith(SPMB_ADMIN_DRAFT_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => store.removeItem(key));
  } catch { /* abaikan */ }
}

// Hanya kunci form yang dikenal dan bertipe string yang dipulihkan.
export function restoreSpmbAdminForm<T extends Record<string, string>>(baseline: T, draftForm: Record<string, unknown>): T {
  const restored: Record<string, string> = { ...baseline };
  for (const key of Object.keys(baseline)) {
    if ((DERIVED_KEYS as readonly string[]).includes(key)) continue;
    const value = draftForm[key];
    if (typeof value === "string") restored[key] = value;
  }
  return restored as T;
}
