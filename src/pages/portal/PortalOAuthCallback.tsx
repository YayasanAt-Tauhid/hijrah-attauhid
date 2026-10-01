import { useEffect, useState } from "react";
import { useNavigate, Link } from "@/lib/router-compat";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { portalOrtuCompleteGoogleSignup } from "@/server/portalOrtu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { CheckCircle2, UserPlus } from "lucide-react";
import { toast } from "sonner";

const lengkapiSchema = z.object({
  hubungan: z.enum(["ayah", "ibu", "wali"]),
  nis: z.string().min(1, "NIS anak wajib diisi"),
  nama_siswa: z.string().min(1, "Nama lengkap anak wajib diisi"),
  tanggal_lahir_siswa: z.string().min(1, "Tanggal lahir anak wajib diisi"),
});

type LengkapiForm = z.infer<typeof lengkapiSchema>;

type Status = "memeriksa" | "lengkapi" | "sukses" | "gagal";

export default function PortalOAuthCallback() {
  const navigate = useNavigate();
  const { user, isLoading, signOut } = useAuth();
  const [status, setStatus] = useState<Status>("memeriksa");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<LengkapiForm>({
    resolver: zodResolver(lengkapiSchema),
    defaultValues: { hubungan: "wali", nis: "", nama_siswa: "", tanggal_lahir_siswa: "" },
  });

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      setStatus("gagal");
      setError("Gagal masuk dengan Google. Silakan coba lagi.");
      return;
    }

    (async () => {
      const { data: profile } = await supabase
        .from("users_profile")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profile?.role === "ortu") {
        navigate("/portal", { replace: true });
        return;
      }

      if (profile?.role && profile.role !== "siswa") {
        await signOut();
        setStatus("gagal");
        setError(
          "Akun Google ini sudah terhubung ke akun staff lain, bukan akun orang tua. Gunakan akun Google lain atau login admin."
        );
        return;
      }

      // role null = akun baru yang belum diklasifikasikan. Role "siswa"
      // tetap diterima sementara untuk kompatibilitas akun legacy yang dulu
      // otomatis diberi role siswa saat OAuth pertama kali.
      // Keduanya perlu lengkapi data anak untuk verifikasi.
      setStatus("lengkapi");
    })();
  }, [user, isLoading, navigate, signOut]);

  const onSubmit = async (data: LengkapiForm) => {
    setSubmitting(true);
    setError(null);
    try {
      await portalOrtuCompleteGoogleSignup({ data });
      setStatus("sukses");
      toast.success("Pendaftaran berhasil!");
      setTimeout(() => navigate("/portal", { replace: true }), 1200);
    } catch (err: any) {
      setError(err?.message || "Gagal melengkapi pendaftaran. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 p-4">
      <div className="w-full max-w-md">
        <Card className="shadow-lg border-emerald-200">
          <CardHeader className="text-center">
            <h1 className="text-lg font-semibold text-emerald-800">Masuk dengan Google</h1>
          </CardHeader>
          <CardContent className="space-y-4">
            {status === "memeriksa" && (
              <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted-foreground">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                Memeriksa akun Anda...
              </div>
            )}

            {status === "gagal" && (
              <div className="space-y-4">
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
                <Link to="/portal/login">
                  <Button variant="outline" className="w-full">Kembali ke Login</Button>
                </Link>
              </div>
            )}

            {status === "sukses" && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-600" />
                <p className="text-sm text-muted-foreground">
                  Akun orang tua berhasil dibuat dan terhubung. Mengarahkan ke portal...
                </p>
                <p className="text-xs text-muted-foreground">
                  Punya anak lain? Hubungkan lewat menu Profil setelah masuk ke portal.
                </p>
              </div>
            )}

            {status === "lengkapi" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Akun Google Anda belum terhubung ke data anak. Lengkapi data berikut untuk verifikasi
                  sebagai orang tua.
                </p>
                {error && (
                  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
                )}
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="hubungan"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Anda sebagai</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="ayah">Ayah</SelectItem>
                              <SelectItem value="ibu">Ibu</SelectItem>
                              <SelectItem value="wali">Wali</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="nis"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>NIS Anak</FormLabel>
                          <FormControl><Input placeholder="Nomor Induk Siswa" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="nama_siswa"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nama Lengkap Anak</FormLabel>
                          <FormControl><Input placeholder="Sesuai data sekolah" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="tanggal_lahir_siswa"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tanggal Lahir Anak</FormLabel>
                          <FormControl><Input type="date" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={submitting}>
                      {submitting ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4" />
                          Selesaikan Pendaftaran
                        </>
                      )}
                    </Button>
                  </form>
                </Form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
