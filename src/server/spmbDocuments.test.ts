import { beforeEach, describe, expect, it, vi } from "vitest";

// Dokumen SPMB (termasuk bukti pengunduran diri dari orang tua) tersimpan di
// bucket privat; baca/unggah hanya lewat URL bertanda tangan dari server.
const state = vi.hoisted(() => ({
  ownerByColumn: {} as Record<string, Record<string, unknown> | null>,
  eqCalls: [] as Array<[string, string]>,
  role: vi.fn(),
  access: vi.fn(),
  createSignedUrl: vi.fn(),
  createSignedUploadUrl: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (input: unknown) => input;
    const q = {
      middleware: () => q,
      inputValidator: (fn: typeof validate) => { validate = fn; return q; },
      handler: (fn: (args: unknown) => unknown) => (args: { data: unknown }) => fn({ ...args, data: validate(args.data) }),
    };
    return q;
  },
}));
vi.mock("./supabase", () => ({
  createAdminClient: () => ({
    from: () => {
      let column = "";
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (col: string, value: string) => { column = col; state.eqCalls.push([col, value]); return q; },
        maybeSingle: async () => ({ data: state.ownerByColumn[column] ?? null, error: null }),
      };
      return q;
    },
    storage: {
      from: () => ({
        createSignedUrl: state.createSignedUrl,
        createSignedUploadUrl: state.createSignedUploadUrl,
      }),
    },
  }),
}));
vi.mock("./auth", () => ({
  authMiddleware: {},
  requireContext: () => ({ userId: "staff" }),
  requireRole: (...args: unknown[]) => state.role(...args),
  requireAcademicDepartment: (...args: unknown[]) => state.access(...args),
}));

import { spmbCreateAdminDocumentUpload, spmbGetDocumentUrl } from "./spmbDocuments";

const BUKTI_PATH = "mundur/44444444-4444-4444-8444-444444444444.pdf";
const DEPT_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  state.ownerByColumn = {};
  state.eqCalls = [];
  state.role.mockResolvedValue("admin");
  state.access.mockResolvedValue({ role: "admin_tu", departemen_id: DEPT_ID });
  state.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://storage.test/signed" }, error: null });
  state.createSignedUploadUrl.mockResolvedValue({ data: { token: "tok" }, error: null });
});

describe("spmbGetDocumentUrl untuk bukti pengunduran diri", () => {
  it("admin boleh membuka bukti di folder mundur/ lewat URL sementara", async () => {
    const result = await spmbGetDocumentUrl({ data: { path: BUKTI_PATH } });
    expect(result).toEqual({ url: "https://storage.test/signed" });
    expect(state.createSignedUrl).toHaveBeenCalledWith(BUKTI_PATH, 120);
  });

  it("Admin TU hanya boleh membuka bukti milik lembaganya (kepemilikan dicari lewat kolom bukti)", async () => {
    state.role.mockResolvedValue("admin_tu");
    state.ownerByColumn.spmb_mundur_bukti_path = {
      spmb_departemen_tujuan_id: DEPT_ID,
      siswa: { departemen_id: "dept-asal" },
    };
    await spmbGetDocumentUrl({ data: { path: BUKTI_PATH } });
    expect(state.eqCalls).toContainEqual(["spmb_mundur_bukti_path", BUKTI_PATH]);
    expect(state.access).toHaveBeenCalledWith(expect.anything(), "staff", DEPT_ID, ["admin_tu"]);
  });

  it("menolak Admin TU bila lembaga pemilik bukti di luar kewenangannya", async () => {
    state.role.mockResolvedValue("admin_tu");
    state.ownerByColumn.spmb_mundur_bukti_path = { spmb_departemen_tujuan_id: DEPT_ID, siswa: null };
    state.access.mockRejectedValue(new Error("Forbidden: lembaga di luar kewenangan Admin TU"));
    await expect(spmbGetDocumentUrl({ data: { path: BUKTI_PATH } })).rejects.toThrow("Forbidden");
    expect(state.createSignedUrl).not.toHaveBeenCalled();
  });

  it("menolak path yang bukan milik pendaftar mana pun untuk Admin TU", async () => {
    state.role.mockResolvedValue("admin_tu");
    await expect(spmbGetDocumentUrl({ data: { path: BUKTI_PATH } })).rejects.toThrow("tidak ditemukan atau akses ditolak");
    expect(state.createSignedUrl).not.toHaveBeenCalled();
  });

  it("tetap menolak path di luar pola (traversal, folder lain, ekstensi asing)", async () => {
    for (const path of ["mundur/../kk/x.pdf", "lain/44444444-4444-4444-8444-444444444444.pdf", "mundur/x.exe"]) {
      await expect(spmbGetDocumentUrl({ data: { path } })).rejects.toThrow("tidak valid");
    }
  });
});

describe("spmbCreateAdminDocumentUpload untuk bukti pengunduran diri", () => {
  it("menerbitkan upload bertanda tangan dengan path mundur/<uuid>.<ext>", async () => {
    const result = await spmbCreateAdminDocumentUpload({
      data: { kind: "mundur", fileName: "surat-orang-tua.PDF", size: 1024, mime: "application/pdf" },
    });
    expect(result.path).toMatch(/^mundur\/[0-9a-f-]{36}\.pdf$/);
    expect(result.token).toBe("tok");
  });

  it("tetap membatasi jenis, tipe file, dan ukuran maksimal 10 MB", async () => {
    await expect(spmbCreateAdminDocumentUpload({
      data: { kind: "lain", fileName: "a.pdf", size: 1024, mime: "application/pdf" },
    })).rejects.toThrow("PDF, JPG, atau PNG");
    await expect(spmbCreateAdminDocumentUpload({
      data: { kind: "mundur", fileName: "a.exe", size: 1024, mime: "application/octet-stream" },
    })).rejects.toThrow("PDF, JPG, atau PNG");
    await expect(spmbCreateAdminDocumentUpload({
      data: { kind: "mundur", fileName: "a.pdf", size: 11 * 1024 * 1024, mime: "application/pdf" },
    })).rejects.toThrow("10 MB");
  });
});
