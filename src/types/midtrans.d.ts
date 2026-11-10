/** Hasil callback Midtrans Snap; field lain dari gateway tetap tersedia sebagai unknown. */
interface MidtransSnapResult {
  order_id?: string;
  transaction_status?: string;
  status_code?: string;
  status_message?: string;
  [key: string]: unknown;
}

interface Window {
  snap: {
    pay: (
      token: string,
      options: {
        onSuccess?: (result: MidtransSnapResult) => void;
        onPending?: (result: MidtransSnapResult) => void;
        onError?: (result: MidtransSnapResult) => void;
        onClose?: () => void;
      }
    ) => void;
  };
}
