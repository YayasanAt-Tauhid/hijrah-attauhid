import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-compat";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { cn } from "@/lib/utils";
import { PortalHero } from "@/components/portal/PortalHero";
import { inisialNama, labelHubungan, labelKelas } from "@/lib/portalAnak";
import { getNamaOrtuDariAnak } from "@/lib/ortu";
import { JENIS_IDENTITAS_ANAK, metaIdentitasAnak } from "@/lib/identitasAnak";
import { portalOrtuTambahAnak } from "@/server/portalOrtu";
import { getErrorMessage } from "@/lib/errorMessage";

const kartu = "overflow-hidden rounded-[1.125rem] border bg-card shadow-sm";

const tambahAnakSchema = z.object({
  hubungan: z.enum(["ayah", "ibu", "wali"]),
  jenis_identitas: z.enum(JENIS_IDENTITAS_ANAK).default("nis"),
  nis: z.string().min(1, "NIS/NISN/ID Santri anak wajib diisi"),
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
  const [tambahAnakOpen, setTambahAnakOpen] = useState(false);

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
      setTambahAnakOpen(false);
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
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
      setChangingPassword(false);
    }
  };

  const emailTampil = profile?.email || user?.email || "";
  const namaTampil = namaOrtu || emailTampil.split("@")[0];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 animate-fade-in">
      <PortalHero
        eyebrow="Profil Saya"
        title={namaTampil}
        subtitle={<span className="break-all">{emailTampil}</span>}
        leading={
          <span
            aria-hidden="true"
            className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-full bg-emerald-400 text-2xl font-extrabold text-emerald-950"
          >
            {inisialNama(namaTampil)}
          </span>
        }
      />

      <Tabs defaultValue="profil">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-2xl bg-emerald-100 p-1">
          <TabsTrigger
            value="profil"
            className="min-h-11 rounded-xl font-semibold text-emerald-900 data-[state=active]:bg-white data-[state=active]:font-bold data-[state=active]:text-emerald-800 data-[state=active]:shadow"
          >
            Profil
          </TabsTrigger>
          <TabsTrigger
            value="keamanan"
            className="min-h-11 rounded-xl font-semibold text-emerald-900 data-[state=active]:bg-white data-[state=active]:font-bold data-[state=active]:text-emerald-800 data-[state=active]:shadow"
          >
            Keamanan
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profil" className="space-y-4 mt-4">
          <section aria-labelledby="profil-hubungkan" className={kartu}>
            <div className="flex items-center gap-3 p-4">
              <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
                <UserPlus className="h-[22px] w-[22px]" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="profil-hubungkan" className="text-[15px] font-bold leading-snug">Hubungkan anak lain</h2>
                <p className="text-xs leading-snug text-muted-foreground">Tambahkan anak yang belum muncul di akun ini.</p>
              </div>
              <button
                type="button"
                aria-expanded={tambahAnakOpen}
                aria-controls="form-tambah-anak"
                onClick={() => setTambahAnakOpen((open) => !open)}
                className="min-h-11 shrink-0 rounded-xl border border-emerald-700 bg-card px-4 text-sm font-bold text-emerald-700 hover:bg-emerald-50"
              >
                {tambahAnakOpen ? "Tutup" : "Tambah"}
              </button>
            </div>
            {tambahAnakOpen && (
              <div id="form-tambah-anak" className="border-t p-4">
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
                              <SelectItem value="id_santri">ID Santri</SelectItem>
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
                        <FormLabel>{metaIdentitasAnak(tambahAnakForm.watch("jenis_identitas")).label}</FormLabel>
                        <FormControl><Input placeholder={metaIdentitasAnak(tambahAnakForm.watch("jenis_identitas")).placeholder} inputMode={metaIdentitasAnak(tambahAnakForm.watch("jenis_identitas")).inputMode} {...field} /></FormControl>
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
              </div>
            )}
          </section>

          <section aria-labelledby="profil-akun" className={kartu}>
            <h2 id="profil-akun" className="px-4 pb-3 pt-3.5 text-base font-extrabold">Informasi akun</h2>
            <dl className="divide-y border-t">
              <div className="px-4 py-3">
                <dt className="text-xs font-semibold text-muted-foreground">Nama</dt>
                <dd className="mt-0.5 text-[15px] font-semibold">
                  {namaOrtu || (
                    <span className="font-normal italic text-muted-foreground">
                      Belum ada data nama — lengkapi data orang tua/wali di formulir siswa
                    </span>
                  )}
                </dd>
              </div>
              <div className="px-4 py-3">
                <dt className="text-xs font-semibold text-muted-foreground">Email</dt>
                <dd className="mt-0.5 break-all text-[15px] font-semibold">{profile?.email || user?.email}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="profil-anak" className={kartu}>
            <h2 id="profil-anak" className="px-4 pb-3 pt-3.5 text-base font-extrabold">Anak yang terhubung</h2>
            {anakList.length === 0 ? (
              <p className="border-t px-4 py-4 text-sm text-muted-foreground">Belum ada anak yang terhubung</p>
            ) : (
              <ul className="divide-y border-t">
                {anakList.map((item: any, idx: number) => {
                  const siswa = item.siswa;
                  const ak = siswa?.kelas_siswa?.find((ks: any) => ks.aktif);
                  const kelas = labelKelas(ak?.kelas?.nama);
                  return (
                    <li key={idx} className="flex items-center gap-3 px-4 py-3">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid h-11 w-11 shrink-0 place-items-center rounded-full text-[15px] font-bold text-white",
                          idx % 2 === 0 ? "bg-emerald-700" : "bg-teal-700",
                        )}
                      >
                        {inisialNama(siswa?.nama || "")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-[15px] font-bold leading-normal">
                          {siswa?.nama}
                          {kelas && (
                            <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-emerald-100 px-2.5 align-[1px] text-xs font-semibold leading-normal text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                              {kelas}
                            </span>
                          )}
                        </p>
                        <p className="text-xs leading-snug text-muted-foreground">
                          {`${ak?.kelas?.departemen?.nama || "-"} · NIS ${siswa?.nis || "-"}`}
                        </p>
                      </div>
                      {item.hubungan && (
                        <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-foreground">
                          {labelHubungan(item.hubungan)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </TabsContent>

        <TabsContent value="keamanan" className="mt-4">
          <section aria-labelledby="profil-password" className={kartu}>
            <h2 id="profil-password" className="px-4 pb-3 pt-3.5 text-base font-extrabold">Ganti Password</h2>
            <div className="border-t p-4">
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
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
