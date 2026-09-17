interface ResolvePaymentAcademicYearInput {
  requestedYearId: string;
  spmbRegistrationYearId?: string | null;
  isSpmbPayment: boolean;
}

export function resolvePaymentAcademicYear({
  requestedYearId,
  spmbRegistrationYearId,
  isSpmbPayment,
}: ResolvePaymentAcademicYearInput): string {
  if (isSpmbPayment) {
    const registrationYear = spmbRegistrationYearId?.trim();
    if (!registrationYear) {
      throw new Error("Tahun ajaran pendaftaran SPMB belum dikonfigurasi");
    }
    return registrationYear;
  }

  const requestedYear = requestedYearId.trim();
  if (!requestedYear) throw new Error("Tahun ajaran pembayaran belum dikonfigurasi");
  return requestedYear;
}
