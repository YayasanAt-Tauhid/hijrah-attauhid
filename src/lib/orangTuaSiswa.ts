/**
 * Ringkasan orang tua untuk membedakan siswa bernama sama di loket pembayaran.
 * Hanya nama ayah, nama ibu, dan satu nomor HP yang diteruskan ke kasir; kolom
 * pribadi lain (NIK, alamat, penghasilan, dll.) sengaja tidak ikut.
 */

export interface OrangTuaRingkas {
  ayah: string | null;
  ibu: string | null;
  telepon: string | null;
}

export interface OrangTuaDetailInput {
  nama_ayah?: string | null;
  nama_ibu?: string | null;
  telepon_ortu?: string | null;
  telepon_ayah?: string | null;
  telepon_ibu?: string | null;
}

const MIN_DIGIT_TELEPON = 6;

function bersihkanNama(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || /^[-–—.]+$/.test(text)) return null;
  return text;
}

function bersihkanTelepon(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.replace(/\D/g, "").length < MIN_DIGIT_TELEPON) return null;
  return text;
}

/** Urutan: HP ortu, HP ayah, HP ibu, lalu HP siswa. Isian kosong/tak bermakna dilewati. */
export function pilihTeleponOrangTua(
  detail: OrangTuaDetailInput | null | undefined,
  teleponSiswa: string | null | undefined,
): string | null {
  const kandidat = [detail?.telepon_ortu, detail?.telepon_ayah, detail?.telepon_ibu, teleponSiswa];
  for (const item of kandidat) {
    const telepon = bersihkanTelepon(item);
    if (telepon) return telepon;
  }
  return null;
}

export function ringkasOrangTua(
  detail: OrangTuaDetailInput | null | undefined,
  teleponSiswa: string | null | undefined,
): OrangTuaRingkas {
  return {
    ayah: bersihkanNama(detail?.nama_ayah),
    ibu: bersihkanNama(detail?.nama_ibu),
    telepon: pilihTeleponOrangTua(detail, teleponSiswa),
  };
}

export function formatOrangTua(orangTua: OrangTuaRingkas | null | undefined): string {
  const nama: string[] = [];
  if (orangTua?.ayah) nama.push(`Ayah: ${orangTua.ayah}`);
  if (orangTua?.ibu) nama.push(`Ibu: ${orangTua.ibu}`);
  const bagianNama = nama.length ? nama : ["Orang tua belum diisi"];
  const bagianTelepon = orangTua?.telepon ? `HP: ${orangTua.telepon}` : "HP belum diisi";
  return [...bagianNama, bagianTelepon].join(" · ");
}
