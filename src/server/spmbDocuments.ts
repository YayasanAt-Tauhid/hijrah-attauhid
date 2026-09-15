import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, requireContext, requireRole } from "./auth";
import { createAdminClient } from "./supabase";

const PMB_DOCUMENT_BUCKET = "pmb-dokumen";
const DOCUMENT_PATH_PATTERN = /^(kk|akta|rapor|ijazah)\/[0-9a-f-]+\.(pdf|jpg|jpeg|png)$/i;

interface SpmbDocumentUrlInput {
  path: string;
}

export interface SpmbDocumentUrlResult {
  url: string;
}

/**
 * Membuat URL baca sementara untuk dokumen SPMB yang tersimpan di bucket privat.
 * Hanya peran akademik yang berwenang yang dapat meminta URL ini.
 */
export const spmbGetDocumentUrl = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: SpmbDocumentUrlInput) => d)
  .handler(async ({ data, context }): Promise<SpmbDocumentUrlResult> => {
    const path = (data.path || "").trim();
    if (!DOCUMENT_PATH_PATTERN.test(path)) {
      throw new Error("Path dokumen SPMB tidak valid");
    }

    const admin = createAdminClient();
    await requireRole(admin, requireContext(context).userId, [
      "admin",
      "kepala_sekolah",
      "sekretaris_yayasan",
    ]);

    const { data: signed, error } = await admin.storage
      .from(PMB_DOCUMENT_BUCKET)
      .createSignedUrl(path, 120);

    if (error || !signed?.signedUrl) {
      throw new Error(error?.message || "Gagal membuka dokumen SPMB");
    }

    return { url: signed.signedUrl };
  });

/** Admin uploads are private and use unique paths, so replacing a document
 * never overwrites the previous file before the student record is saved. */
export const spmbCreateAdminDocumentUpload = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: { kind: string; fileName: string; size: number; mime: string }) => d)
  .handler(async ({ data, context }) => {
    const admin = createAdminClient();
    await requireRole(admin, requireContext(context).userId, ["admin"]);
    const extension = data.fileName.split(".").pop()?.toLowerCase();
    const mimeByExt: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
    if (!["kk", "akta", "rapor", "ijazah"].includes(data.kind) || !extension || mimeByExt[extension] !== data.mime) {
      throw new Error("Gunakan file PDF, JPG, atau PNG yang sesuai");
    }
    if (!Number.isFinite(data.size) || data.size <= 0 || data.size > 10 * 1024 * 1024) throw new Error("Ukuran dokumen maksimal 10 MB");
    const path = `${data.kind}/${crypto.randomUUID()}.${extension}`;
    const { data: signed, error } = await admin.storage.from(PMB_DOCUMENT_BUCKET).createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message || "Gagal menyiapkan upload");
    return { path, token: signed.token };
  });
