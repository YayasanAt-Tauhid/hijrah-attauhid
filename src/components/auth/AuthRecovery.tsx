import { Button } from "@/components/ui/button";

interface Props { message: string; onRetry: () => void; }
export default function AuthRecovery({ message, onRetry }: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-lg font-semibold">Belum berhasil membuka akun</h1>
        <p role="alert" className="text-sm text-muted-foreground">{message}</p>
        <Button onClick={onRetry} className="w-full">Coba lagi</Button>
        <Button variant="outline" onClick={() => window.location.reload()} className="w-full">Muat ulang halaman</Button>
      </div>
    </div>
  );
}
