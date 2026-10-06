import { Badge } from "@/components/ui/badge";

type RevenueAccount = { kode: string; nama: string };

export default function SppCategoryAccounts({ accounts, fallbackAccount, loading = false, error = false }: {
  accounts?: RevenueAccount[];
  fallbackAccount?: RevenueAccount | null;
  loading?: boolean;
  error?: boolean;
}) {
  const categoryAccount = (code: string) => {
    if (loading) return <span className="text-muted-foreground">Memuat akun…</span>;
    if (error) return <span className="text-destructive">{code} — Gagal memuat akun</span>;
    const matches = accounts?.filter(account => account.kode === code) || [];
    if (matches.length !== 1) {
      return <span className="text-amber-700">{code} — {matches.length ? "Periksa akun aktif ganda" : "Akun aktif belum tersedia"}</span>;
    }
    return <span>{code} — {matches[0].nama}</span>;
  };

  return (
    <div className="min-w-56 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant="secondary">Asrama</Badge>{categoryAccount("4102")}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant="outline">Non Asrama</Badge>{categoryAccount("4103")}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        <Badge variant="outline">Belum terverifikasi</Badge>
        <span>{fallbackAccount ? `${fallbackAccount.kode} — ${fallbackAccount.nama}` : "Akun cadangan belum diset"}</span>
      </div>
    </div>
  );
}
