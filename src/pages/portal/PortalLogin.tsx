import { useEffect, useState } from "react";
import { useNavigate, Link } from "@/lib/router-compat";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { portalOrtuSignUp } from "@/server/portalOrtu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { LogIn, Eye, EyeOff, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { GoogleIcon } from "@/components/shared/GoogleIcon";
import { BrandLogo } from "@/components/shared/BrandLogo";

const loginSchema = z.object({
  email: z.string().email("Format email tidak valid"),
  password: z.string().min(6, "Password minimal 6 karakter"),
});

type LoginForm = z.infer<typeof loginSchema>;

const signUpSchema = z
  .object({
    email: z.string().email("Format email tidak valid"),
    password: z.string().min(8, "Password minimal 8 karakter"),
    konfirmasi: z.string(),
    hubungan: z.enum(["ayah", "ibu", "wali"]),
    nis: z.string().min(1, "NIS anak wajib diisi"),
    nama_siswa: z.string().min(1, "Nama lengkap anak wajib diisi"),
    tanggal_lahir_siswa: z.string().min(1, "Tanggal lahir anak wajib diisi"),
  })
  .refine((data) => data.password === data.konfirmasi, {
    message: "Konfirmasi password tidak cocok",
    path: ["konfirmasi"],
  });

type SignUpForm = z.infer<typeof signUpSchema>;

export default function PortalLogin() {
  const navigate = useNavigate();
  const { signIn, signInWithGoogle, signOut, user, role } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signUpError, setSignUpError] = useState<string | null>(null);
  const [signingUp, setSigningUp] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (user && role === "ortu") {
      navigate("/portal", { replace: true });
    }
  }, [user, role, navigate]);

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const signUpForm = useForm<SignUpForm>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      email: "", password: "", konfirmasi: "", hubungan: "wali",
      nis: "", nama_siswa: "", tanggal_lahir_siswa: "",
    },
  });

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    setError(null);

    const { error: signInError } = await signIn(data.email, data.password);

    if (signInError) {
      setError(signInError);
      setLoading(false);
      return;
    }

    // Check role
    const {
      data: { user: signedInUser },
    } = await supabase.auth.getUser();
    if (!signedInUser) {
      setError("Gagal mendapatkan data user");
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("users_profile")
      .select("role")
      .eq("id", signedInUser.id)
      .single();

    if (profile?.role !== "ortu") {
      await signOut();
      setError(
        "Akun ini bukan akun orang tua. Silakan gunakan halaman login admin."
      );
      setLoading(false);
      return;
    }

    navigate("/portal", { replace: true });
  };

  const onSignUp = async (data: SignUpForm) => {
    setSigningUp(true);
    setSignUpError(null);
    try {
      await portalOrtuSignUp({
        data: {
          email: data.email,
          password: data.password,
          hubungan: data.hubungan,
          nis: data.nis,
          nama_siswa: data.nama_siswa,
          tanggal_lahir_siswa: data.tanggal_lahir_siswa,
        },
      });
      toast.success("Akun berhasil dibuat. Silakan masuk.");
      const { error: signInError } = await signIn(data.email, data.password);
      if (signInError) {
        setSignUpError("Akun dibuat, tapi gagal masuk otomatis: " + signInError);
        setSigningUp(false);
        return;
      }
      navigate("/portal", { replace: true });
    } catch (err: any) {
      setSignUpError(err?.message || "Gagal mendaftar. Coba lagi.");
    } finally {
      setSigningUp(false);
    }
  };

  const onGoogleSignIn = async () => {
    setGoogleLoading(true);
    const redirectTo = `${window.location.origin}/portal/oauth-callback`;
    const { error: oauthError } = await signInWithGoogle(redirectTo);
    if (oauthError) {
      toast.error(oauthError);
      setGoogleLoading(false);
    }
    // Kalau sukses, browser akan redirect ke Google lalu kembali ke
    // /portal/oauth-callback -- tidak perlu apa-apa lagi di sini.
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <BrandLogo className="mx-auto mb-4 h-20 w-20 rounded-2xl shadow-lg" />
          <h1 className="text-2xl font-bold text-emerald-800">
            Portal Orang Tua
          </h1>
          <p className="mt-1 text-sm text-emerald-600/80">
            Hijrah At-Tauhid — Sistem Manajemen Sekolah Islam
          </p>
        </div>

        <Card className="shadow-lg border-emerald-200">
          <CardHeader className="pb-4 text-center">
            <h2 className="text-lg font-semibold text-foreground">
              Portal Orang Tua
            </h2>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="masuk">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="masuk">Masuk</TabsTrigger>
                <TabsTrigger value="daftar">Daftar Akun</TabsTrigger>
              </TabsList>

              {/* ── TAB MASUK ── */}
              <TabsContent value="masuk" className="space-y-4 mt-4">
                {error && (
                  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                  </div>
                )}
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input placeholder="email@contoh.com" type="email" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                placeholder="Masukkan password"
                                type={showPassword ? "text" : "password"}
                                {...field}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                                onClick={() => setShowPassword(!showPassword)}
                              >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </Button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={loading}>
                      {loading ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        <>
                          <LogIn className="h-4 w-4" />
                          Masuk
                        </>
                      )}
                    </Button>
                  </form>
                </Form>

                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">atau</span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={googleLoading}
                  onClick={onGoogleSignIn}
                >
                  {googleLoading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <>
                      <GoogleIcon />
                      Masuk dengan Google
                    </>
                  )}
                </Button>
              </TabsContent>

              {/* ── TAB DAFTAR ── */}
              <TabsContent value="daftar" className="space-y-4 mt-4">
                {signUpError && (
                  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    {signUpError}
                  </div>
                )}

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={googleLoading}
                  onClick={onGoogleSignIn}
                >
                  {googleLoading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <>
                      <GoogleIcon />
                      Daftar dengan Google
                    </>
                  )}
                </Button>
                <p className="text-xs text-center text-muted-foreground">
                  Cara tercepat &amp; teraman — tanpa perlu buat password baru.
                </p>

                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">atau daftar dengan email</span>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Untuk verifikasi, isi data anak sesuai data yang tercatat di sekolah.
                </p>
                <Form {...signUpForm}>
                  <form onSubmit={signUpForm.handleSubmit(onSignUp)} className="space-y-4">
                    <FormField
                      control={signUpForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl><Input type="email" placeholder="email@contoh.com" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={signUpForm.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Password</FormLabel>
                            <FormControl><Input type="password" placeholder="Min. 8 karakter" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={signUpForm.control}
                        name="konfirmasi"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Konfirmasi</FormLabel>
                            <FormControl><Input type="password" placeholder="Ulangi password" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={signUpForm.control}
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

                    <div className="border-t pt-3 space-y-3">
                      <p className="text-xs font-medium text-muted-foreground">Data Anak (untuk verifikasi)</p>
                      <FormField
                        control={signUpForm.control}
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
                        control={signUpForm.control}
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
                        control={signUpForm.control}
                        name="tanggal_lahir_siswa"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tanggal Lahir Anak</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={signingUp}>
                      {signingUp ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4" />
                          Daftar & Masuk
                        </>
                      )}
                    </Button>
                  </form>
                </Form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Anak belum terdaftar sebagai siswa?{" "}
          <Link to="/pmb" className="text-emerald-700 underline font-medium">
            Daftarkan anak Anda
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Untuk login admin,{" "}
          <Link to="/login" className="text-emerald-700 underline font-medium">
            klik di sini
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          © 2025 Hijrah At-Tauhid — Portal Orang Tua
        </p>
      </div>
    </div>
  );
}
