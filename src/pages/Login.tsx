import { useEffect, useState } from "react";
import { Link, useNavigate } from "@/lib/router-compat";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { LogIn, Eye, EyeOff, UsersRound } from "lucide-react";
import { GoogleIcon } from "@/components/shared/GoogleIcon";
import { toast } from "sonner";

const loginSchema = z.object({
  email: z.string().email("Format email tidak valid"),
  password: z.string().min(6, "Password minimal 6 karakter"),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function Login() {
  const { signIn, signInWithGoogle, user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (user) {
      navigate("/", { replace: true });
    }
  }, [user, navigate]);

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onGoogleSignIn = async () => {
    setGoogleLoading(true);
    const redirectTo = `${window.location.origin}/oauth-callback`;
    const { error: oauthError } = await signInWithGoogle(redirectTo);
    if (oauthError) {
      toast.error(oauthError);
      setGoogleLoading(false);
    }
  };

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    setError(null);
    const { error } = await signIn(data.email, data.password);
    if (error) {
      setError(error);
      setLoading(false);
    } else {
      navigate("/", { replace: true });
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary font-bold text-primary-foreground text-2xl shadow-lg">
            H
          </div>
          <h1 className="text-2xl font-bold text-foreground">Hijrah At-Tauhid</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sistem Manajemen Sekolah Islam At-Tauhid
          </p>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="pb-4 text-center">
            <h2 className="text-lg font-semibold text-foreground">Login Pegawai / Guru / Admin</h2>
            <p className="text-xs text-muted-foreground">
              Gunakan akun internal sekolah yang sudah didaftarkan administrator
            </p>
          </CardHeader>
          <CardContent>
            <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
              <div className="flex items-start gap-2">
                <UsersRound className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                    Orang Tua / Wali Siswa?
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-emerald-700/90 dark:text-emerald-300/90">
                    Jangan masuk melalui halaman pegawai. Gunakan Portal Orang Tua untuk
                    mendaftar atau masuk ke akun Anda.
                  </p>
                  <Button asChild variant="link" className="mt-1 h-auto p-0 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    <Link to="/portal/login">Masuk Portal Orang Tua →</Link>
                  </Button>
                </div>
              </div>
            </div>

            {error && (
              <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
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
                        <Input placeholder="nama@sekolah.sch.id" type="email" {...field} />
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
                      <div className="relative">
                        <FormControl>
                          <Input
                            placeholder="Masukkan password"
                            type={showPassword ? "text" : "password"}
                            {...field}
                          />
                        </FormControl>
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
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  ) : (
                    <>
                      <LogIn className="h-4 w-4" />
                      Masuk
                    </>
                  )}
                </Button>
              </form>
            </Form>

            <div className="relative py-4">
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
                  Masuk dengan Google (akun pegawai)
                </>
              )}
            </Button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Google hanya untuk akun pegawai yang sudah didaftarkan admin.
            </p>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          © 2026 Hijrah At-Tauhid — Sistem Manajemen Sekolah
        </p>
      </div>
    </div>
  );
}
