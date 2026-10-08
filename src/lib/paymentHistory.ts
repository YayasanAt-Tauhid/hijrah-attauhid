export interface HistoryBill {
  id: string;
  nominal: number | string;
  status: string;
  pembayaran?: { jumlah: number | string }[];
}

export interface HistoryBillBalance {
  id: string;
  nominal: number;
  paid: number;
  remaining: number;
  payable: boolean;
}

export function historyBillBalance(bill: HistoryBill | null | undefined): HistoryBillBalance | null {
  if (!bill) return null;
  const nominal = Number(bill.nominal);
  const paid = (bill.pembayaran || []).reduce((sum, payment) => sum + Number(payment.jumlah), 0);
  if (!Number.isFinite(nominal) || !Number.isFinite(paid)) return null;
  return {
    id: bill.id,
    nominal,
    paid,
    remaining: Math.max(nominal - paid, 0),
    payable: ["belum_bayar", "sebagian", "terjadwal"].includes(bill.status),
  };
}

// This is a display warning, never a replacement for the gateway status.
export function isPendingHistoryOutdated(
  status: string,
  items: { jumlah: number; balance?: HistoryBillBalance | null }[],
): boolean {
  if (status !== "pending") return false;
  const bills = new Map<string, { amount: number; balance: HistoryBillBalance }>();
  for (const item of items) {
    if (!item.balance) continue;
    const previous = bills.get(item.balance.id);
    bills.set(item.balance.id, {
      amount: (previous?.amount || 0) + item.jumlah,
      balance: item.balance,
    });
  }
  return [...bills.values()].some(({ amount, balance }) =>
    !balance.payable || amount > balance.remaining
  );
}
