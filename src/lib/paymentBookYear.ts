interface ResolvePaymentBookYearInput {
  requestedBookYearId?: string | null;
  paymentDateBookYearId?: string | null;
}

/**
 * Kolom tahun_ajaran_id pada tabel keuangan adalah FK ke tahun_buku.
 * Tahun yang memuat tanggal transaksi menjadi sumber kebenaran di server;
 * nilai dari klien hanya dipertahankan di input untuk kompatibilitas API.
 */
export function resolvePaymentBookYear({
  requestedBookYearId: _requestedBookYearId,
  paymentDateBookYearId,
}: ResolvePaymentBookYearInput): string {
  const bookYearId = paymentDateBookYearId?.trim();
  if (!bookYearId) {
    throw new Error("Tahun buku untuk tanggal bayar belum dikonfigurasi");
  }
  return bookYearId;
}
