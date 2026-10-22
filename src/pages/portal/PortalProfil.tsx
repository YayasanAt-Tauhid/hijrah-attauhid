import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-compat";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { toast } from "sonner";
import { Save, Eye, EyeOff, UserPlus } from "lucide-react";
import { getNamaOrtuDariAnak } from "@/lib/ortu";
import { portalOrtuTambahAnak } from "@/server/portalOrtu";

const tambahAnakSchema = z.object({
  hubungan: z.enum(["ayah", "ibu", "wali"]),
  jenis_identitas: z.enum(["nis", "nisn"]).default("nis"),
  nis: z.string().min(1, "NIS/NISN anak wajib diisi"),
  nama_siswa: z.string().min(1, "Nama lengkap anak wajib diisi"),
  tanggal_lahir_siswa: z.string().min(1, "Tanggal lahir anak wajib diisi"),
});

type TambahAnakForm = z.infer<typeof tambahAnakSchema>;

const passwordSchema = z
  .object({
    password_lama: z.string().min(1, "Password lama wajib diisi"),
    password_baru: z.string().min(8, "Password minimal 8 karakter"),
    konfirmasi: z.string(),
  })
  .refine((data) => data.password_baru === data.konfirmasi, {
    message: "Konfirmasi password tidak cocok",
    path: ["konfirmasi"],
  });

type PasswordForm = z.infer<typeof passwordSchema>;

export default function PortalProfil() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);

  // Fetch profile
  const { data: profile } = useQuery({
    queryKey: ["portal-profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("users_profile")
        .select("*")
        .eq("id", user!.id)
        .single();
      return data;
    },
    enabled: !!user,
  });

  // Fetch anak
  const { data: anakList = [] } = useQuery({
    queryKey: ["portal-anak-profil", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("ortu_siswa")
        .select(
          `
          hubungan,
          siswa:siswa_id (
            nama, nis,
            siswa_detail (nama_ayah, nama_ibu),
            kelas_siswa (
              aktif,
              kelas:kelas_id (
                nama,
                departemen:departemen_id (nama)
              )
            )
          )
        `
        )
        .eq("user_id", user!.id);
      return data || [];
    },
    enabled: !!user,
  });

  // Nama orang tua tidak tersimpan di akun login — turunkan dari data anak
  // (lihat komentar di src/lib/ortu.ts)
  const namaOrtu = getNamaOrtuDariAnak(anakList as any[]);

  // Tambah anak form
  const tambahAnakForm = useForm<TambahAnakForm>({
    resolver: zodResolver(tambahAnakSchema),
    defaultValues: { hubungan: "wali", jenis_identitas: "nis", nis: "", nama_siswa: "", tanggal_lahir_siswa: "" },
  });
  const [tambahAnakError, setTambahAnakError] = useState<string | null>(null);

  const tambahAnakMutation = useMutation({
    mutationFn: (data: TambahAnakForm) => portalOrtuTambahAnak({ data: {
        nis: data.nis || "", jenis_identitas: data.jenis_identitas,
        nama_siswa: data.nama_siswa || "", tanggal_lahir_siswa: data.tanggal_lahir_siswa || "",
        hubungan: data.hubungan || "wali",
      } }),
    onSuccess: (res) => {
      toast.success(`${res.nama} berhasil dihubungkan ke akun Anda`);
      tambahAnakForm.reset({ hubungan: "wali", jenis_identitas: "nis", nis: "", nama_siswa: "", tanggal_lahir_siswa: "" });
      setTambahAnakError(null);
      queryClient.invalidateQueries({ queryKey: ["portal-anak-profil", user?.id] });
    },
    onError: (err: any) => {
      setTambahAnakError(err?.message || "Gagal menghubungkan anak. Coba lagi.");
    },
  });

  // Password form
  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password_lama: "", password_baru: "", konfirmasi: "" },
  });

  const [changingPassword, setChangingPassword] = useState(false);

  const onChangePassword = async (data: PasswordForm) => {
    setChangingPassword(true);
    try {
      // Verify old password
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user!.email!,
        password: data.password_lama,
      });

      if (signInError) {
        toast.error("Password lama salah");
        setChangingPassword(false);
        return;
      }

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: data.password_baru,
      });

      if (updateError) {
        toast.error("Gagal ganti password: " + updateError.message);
        setChangingPassword(false);
        return;
      }

      toast.success("Password berhasil diubah. Silakan login ulang.");
      await signOut();
      navigate("/portal/login");
    } catch (err: any) {
      toast.error(err.message);
      setChangingPassword(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground">Profil Saya</h1>

      <Tabs defaultValue="profil">
        <TabsList>
          <TabsTrigger value="profil">Profil</TabsTrigger>
          <TabsTrigger value="keamanan">Keamanan</TabsTrigger>
        </TabsList>

        <TabsContent value="profil" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Informasi Akun</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Nama
                </label>
                <p className="text-sm mt-1">
                  {namaOrtu || (
                    <span className="text-muted-foreground italic">
                      Belum ada data nama — lengkapi data orang tua/wali di formulir siswa
                    </span>
                  )}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Email
                </label>
                <p className="text-sm mt-1">{profile?.email || user?.email}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Role
                </label>
                <p className="text-sm mt-1 capitalize">{profile?.role}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Anak yang Terhubung</CardTitle>
            </CardHeader>
            <CardContent>
              {anakList.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Belum ada anak yang terhubung
                </p>
              ) : (
                <div className="space-y-2">
                  {anakList.map((item: any, idx: number) => {
                    const siswa = item.siswa;
                    const ak = siswa?.kelas_siswa?.find(
                      (ks: any) => ks.aktif
                    );
                    return (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <div>
                          <p className="font-medium text-sm">{siswa?.nama}</p>
                          <p className="text-xs text-muted-foreground">
                            NIS: {siswa?.nis || "-"} •{" "}
                            {ak?.kelas?.departemen?.nama || "-"} —{" "}
                            {ak?.kelas?.nama || "-"}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground capitalize">
                          {item.hubungan}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Hubungkan Anak Lain</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Untuk verifikasi, isi data anak sesuai data yang tercatat di sekolah.
              </p>
              {tambahAnakError && (
                <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {tambahAnakError}
                </div>
              )}
              <Form {...tambahAnakForm}>
                <form
                  onSubmit={tambahAnakForm.handleSubmit((data) => {
                    setTambahAnakError(null);
                    tambahAnakMutation.mutate(data);
                  })}
                  className="space-y-4"
                >
                  <FormField
                    control={tambahAnakForm.control}
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
                  <FormField control={tambahAnakForm.control} name="jenis_identitas" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Gunakan Identitas Anak</FormLabel>
                          <Select value={field.value} onValueChange={value => {
                            field.onChange(value);
                            tambahAnakForm.setValue("nis", "");
                          }}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="nis">NIS</SelectItem>
                              <SelectItem value="nisn">NISN</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField
                    control={tambahAnakForm.control}
                    name="nis"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tambahAnakForm.watch("jenis_identitas") === "nisn" ? "NISN Anak" : "NIS Anak"}</FormLabel>
                        <FormControl><Input placeholder={tambahAnakForm.watch("jenis_identitas") === "nisn" ? "NISN 10 digit" : "Nomor Induk Siswa"} inputMode="numeric" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={tambahAnakForm.control}
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
                    control={tambahAnakForm.control}
                    name="tanggal_lahir_siswa"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tanggal Lahir Anak</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" disabled={tambahAnakMutation.isPending}>
                    {tambahAnakMutation.isPending ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : (
                      <>
                        <UserPlus className="h-4 w-4 mr-2" />
                        Hubungkan Anak
                      </>
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="keamanan" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Ganti Password</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...passwordForm}>
                <form
                  onSubmit={passwordForm.handleSubmit(onChangePassword)}
                  className="space-y-4"
                >
                  <FormField
                    control={passwordForm.control}
                    name="password_lama"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password Lama</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showOld ? "text" : "password"}
                              placeholder="Masukkan password lama"
                              {...field}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                              onClick={() => setShowOld(!showOld)}
                            >
                              {showOld ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={passwordForm.control}
                    name="password_baru"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password Baru</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showNew ? "text" : "password"}
                              placeholder="Minimal 8 karakter"
                              {...field}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                              onClick={() => setShowNew(!showNew)}
                            >
                              {showNew ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={passwordForm.control}
                    name="konfirmasi"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Konfirmasi Password Baru</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="Ketik ulang password baru"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    className="bg-emerald-600 hover:bg-emerald-700"
                    disabled={changingPassword}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {changingPassword ? "Menyimpan..." : "Ganti Password"}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
