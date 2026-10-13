export const AUTH_TIMEOUT_MS = 15_000;

// Some auth/network operations cannot be aborted. Always settle the caller;
// AuthProvider separately ignores results from superseded operations.
export async function withAuthTimeout<T>(
  operation: PromiseLike<T>,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Pemeriksaan akun terlalu lama. Periksa koneksi internet lalu coba lagi."));
          onTimeout?.();
        }, AUTH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
