import { useState, useEffect, useMemo } from "react";
import { Link } from "@/lib/router-compat";
import { pmbOptions, pmbDaftar } from "@/server/pmb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormSection } from "@/components/shared/FormSection";
import { UserPlus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface Departemen { id: string; nama: string; kode: string | null; }
interface Angkatan { id: string; nama: string; departemen_id: string | null; }

const JENIS_OPTIONS = [
  { value: "baru", label: "Siswa Baru" },
  { value: "pindahan", label: "Siswa Pindahan" },
  { value: "alumni_internal", label: "Alumni Internal (Naik Jenjang)" },
];

const PEKERJAAN_OPTIONS = ["PNS", "TNI/Polri", "Wiraswasta", "Karyawan Swasta", "Petani", "Nelayan", "Buruh", "Guru/Dosen", "Dokter", "Lainnya"];

const initialForm = {
  nama: "", jenis_kelamin: "L", tempat_lahir: "", tanggal_lahir: "",
  alamat: "", telepon: "", departemen_id: "", angkatan_id: "",
  jenis_pendaftaran: "baru",
  asal_sekolah: "", kelas_terakhir: "", alasan_pindah: "",
  nama_ayah: "", nama_ibu: "", pekerjaan_ayah: "", pekerjaan_ibu: "",
  telepon_ortu: "", alamat_ortu: "",
};

export default function PMBDaftar() {
  const [departemenList, setDepartemenList] = useState<Departemen[]>([]);
  const [allAngkatan, setAllAngkatan] = useState<Angkatan[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({ ...initialForm });

  useEffect(() => {
    pmbOptions()
      .then((data) => {
        if (data?.departemen) setDepartemenList(data.departemen);
        if (data?.angkatan) setAllAngkatan(data.angkatan);
      })
      .catch(() => {
        /* form tetap tampil; opsi kosong bila gagal */
      });
  }, []);

  const angkatanList = useMemo(
    () => allAngkatan.filter(a => !form.departemen_id || a.departemen_id === form.departemen_id),
    [allAngkatan, form.departemen_id]
  );

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const handleDeptChange = (v: string) => {
    setForm(f => ({ ...f, departemen_id: v, angkatan_id: "" }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nama.trim()) { toast.error("Nama lengkap wajib diisi"); return; }
    if (!form.departemen_id) { toast.error("Lembaga/departemen wajib dipilih"); return; }

    setLoading(true);
    try {
      await pmbDaftar({ data: form });
      setSuccess(true);
    } catch (err: any) {
      toast.error(err?.message || "Gagal mendaftar. Coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 p-4">
        <Card className="w-full max-w-md shadow-lg border-emerald-200 text-center">
          <CardContent className="pt-8 pb-8 space-y-4">
            <CheckCircle2 className="h-16 w-16 text-emerald-600 mx-auto" />
            <h2 className="text-xl font-bold text-emerald-800">Pendaftaran Berhasil!</h2>
            <p className="text-sm text-muted-foreground">
              Data calon siswa <strong>{form.nama}</strong> telah berhasil didaftarkan.
              Silakan tunggu informasi selanjutnya dari pihak sekolah.
            </p>
            <div className="pt-4 space-y-2">
              <Button onClick={() => { setSuccess(false); setForm({ ...initialForm }); }} variant="outline" className="w-full">
                Daftarkan Siswa Lain
              </Button>
              <Link to="/portal/login">
                <Button variant="link" className="w-full text-emerald-700">Ke Halaman Login Portal</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const showPindahanFields = form.jenis_pendaftaran === "pindahan" || form.jenis_pendaftaran === "alumni_internal";

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 p-4 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 font-bold text-white text-xl shadow-lg">
            J
          </div>
          <h1 className="text-2xl font-bold text-emerald-800">Pendaftaran Siswa Baru</h1>
          <p className="mt-1 text-sm text-emerald-600/80">
            Hijrah At-Tauhid — Sistem Manajemen Sekolah Islam
          </p>
        </div>

        <Card className="shadow-lg border-emerald-200">
          <CardHeader className="pb-2">
            <p className="text-sm text-muted-foreground">
              Lengkapi data berikut untuk mendaftarkan calon siswa baru.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <FormSection title="Jenis Pendaftaran" description="Pilih jenis pendaftaran siswa">
                <div>
                  <Label>Jenis Pendaftaran *</Label>
                  <Select value={form.jenis_pendaftaran} onValueChange={v => setForm(f => ({ ...f, jenis_pendaftaran: v, asal_sekolah: "", kelas_terakhir: "", alasan_pindah: "" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {JENIS_OPTIONS.map(o => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.jenis_pendaftaran === "alumni_internal" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Untuk siswa alumni dari jenjang lain di yayasan yang sama (misal: SD → SMP).
                    </p>
                  )}
                </div>

                {showPindahanFields && (
                  <>
                    <div>
                      <Label>{form.jenis_pendaftaran === "alumni_internal" ? "Asal Sekolah / Jenjang" : "Asal Sekolah"}</Label>
                      <Input value={form.asal_sekolah} onChange={set("asal_sekolah")}
                        placeholder={form.jenis_pendaftaran === "alumni_internal" ? "Contoh: SDITA At-Tauhid" : "Nama sekolah asal"} />
                    </div>
                    <div>
                      <Label>Kelas Terakhir</Label>
                      <Input value={form.kelas_terakhir} onChange={set("kelas_terakhir")} placeholder="Contoh: 6A" />
                    </div>
                    {form.jenis_pendaftaran === "pindahan" && (
                      <div>
                        <Label>Alasan Pindah</Label>
                        <Textarea value={form.alasan_pindah} onChange={set("alasan_pindah")} placeholder="Alasan kepindahan siswa" />
                      </div>
                    )}
                  </>
                )}
              </FormSection>

              <FormSection title="Data Calon Siswa" description="Informasi identitas calon siswa">
                <div>
                  <Label>Nama Lengkap *</Label>
                  <Input value={form.nama} onChange={set("nama")} placeholder="Nama lengkap siswa" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Jenis Kelamin</Label>
                    <Select value={form.jenis_kelamin} onValueChange={v => setForm(f => ({ ...f, jenis_kelamin: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="L">Laki-laki</SelectItem>
                        <SelectItem value="P">Perempuan</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Lembaga/Sekolah *</Label>
                    <Select value={form.departemen_id} onValueChange={handleDeptChange}>
                      <SelectTrigger><SelectValue placeholder="Pilih lembaga" /></SelectTrigger>
                      <SelectContent>
                        {departemenList.map(d => (
                          <SelectItem key={d.id} value={d.id}>{d.nama}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Angkatan</Label>
                  <Select value={form.angkatan_id} onValueChange={v => setForm(f => ({ ...f, angkatan_id: v }))} disabled={!form.departemen_id}>
                    <SelectTrigger>
                      <SelectValue placeholder={form.departemen_id ? "Pilih angkatan" : "Pilih lembaga dulu"} />
                    </SelectTrigger>
                    <SelectContent>
                      {angkatanList.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.nama}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Tempat Lahir</Label>
                    <Input value={form.tempat_lahir} onChange={set("tempat_lahir")} placeholder="Kota kelahiran" />
                  </div>
                  <div>
                    <Label>Tanggal Lahir</Label>
                    <Input type="date" value={form.tanggal_lahir} onChange={set("tanggal_lahir")} />
                  </div>
                </div>
                <div>
                  <Label>Telepon</Label>
                  <Input value={form.telepon} onChange={set("telepon")} placeholder="08xxxxxxxxxx" />
                </div>
                <div>
                  <Label>Alamat</Label>
                  <Textarea value={form.alamat} onChange={set("alamat")} placeholder="Alamat lengkap siswa" />
                </div>
              </FormSection>

              <FormSection title="Data Orang Tua / Wali" description="Informasi orang tua atau wali siswa">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Nama Ayah</Label>
                    <Input value={form.nama_ayah} onChange={set("nama_ayah")} />
                  </div>
                  <div>
                    <Label>Nama Ibu</Label>
                    <Input value={form.nama_ibu} onChange={set("nama_ibu")} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Pekerjaan Ayah</Label>
                    <Select value={form.pekerjaan_ayah} onValueChange={v => setForm(f => ({ ...f, pekerjaan_ayah: v }))}>
                      <SelectTrigger><SelectValue placeholder="Pilih pekerjaan" /></SelectTrigger>
                      <SelectContent>
                        {PEKERJAAN_OPTIONS.map(pekerjaan => (
                          <SelectItem key={pekerjaan} value={pekerjaan}>{pekerjaan}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Pekerjaan Ibu</Label>
                    <Select value={form.pekerjaan_ibu} onValueChange={v => setForm(f => ({ ...f, pekerjaan_ibu: v }))}>
                      <SelectTrigger><SelectValue placeholder="Pilih pekerjaan" /></SelectTrigger>
                      <SelectContent>
                        {PEKERJAAN_OPTIONS.map(pekerjaan => (
                          <SelectItem key={pekerjaan} value={pekerjaan}>{pekerjaan}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Telepon Orang Tua</Label>
                  <Input value={form.telepon_ortu} onChange={set("telepon_ortu")} placeholder="08xxxxxxxxxx" />
                </div>
                <div>
                  <Label>Alamat Orang Tua</Label>
                  <Textarea value={form.alamat_ortu} onChange={set("alamat_ortu")} placeholder="Alamat lengkap orang tua" />
                </div>
              </FormSection>

              <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={loading}>
                {loading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Daftarkan Calon Siswa
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Sudah terdaftar?{" "}
          <Link to="/portal/login" className="text-emerald-700 underline font-medium">
            Login Portal Orang Tua
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          © 2025 Hijrah At-Tauhid — Pendaftaran Siswa Baru
        </p>
      </div>
    </div>
  );
}
