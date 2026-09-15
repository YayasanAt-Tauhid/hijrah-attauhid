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
