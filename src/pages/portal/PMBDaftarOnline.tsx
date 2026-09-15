import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router-compat";
import { pmbDaftar, pmbOptions } from "@/server/pmb";
import { pmbCreatePayment, type PmbPaymentResult } from "@/server/pmbPayment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormSection } from "@/components/shared/FormSection";
import { CheckCircle2, CreditCard, UserPlus } from "lucide-react";
import { toast } from "sonner";

interface Departemen { id: string; nama: string; kode: string | null }
interface Angkatan { id: string; nama: string; departemen_id: string | null }
const PEKERJAAN_OPTIONS = ["PNS", "TNI/Polri", "Wiraswasta", "Karyawan Swasta", "Petani", "Nelayan", "Buruh", "Guru/Dosen", "Dokter", "Lainnya"];
const initialForm = {
  nama: "", jenis_kelamin: "L", tempat_lahir: "", tanggal_lahir: "", alamat: "", telepon: "",
  departemen_id: "", angkatan_id: "", jenis_pendaftaran: "baru", asal_sekolah: "", kelas_terakhir: "", alasan_pindah: "",
  nama_ayah: "", nama_ibu: "", pekerjaan_ayah: "", pekerjaan_ibu: "", telepon_ortu: "", alamat_ortu: "",
};

export default function PMBDaftarOnline() {
  const [departemenList, setDepartemenList] = useState<Departemen[]>([]);
  const [allAngkatan, setAllAngkatan] = useState<Angkatan[]>([]);
  const [form, setForm] = useState({ ...initialForm });
  const [loading, setLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [registration, setRegistration] = useState<{ siswa_id: string; payment_token: string } | null>(null);
  const [payment, setPayment] = useState<PmbPaymentResult | null>(null);

  useEffect(() => {
    pmbOptions().then((d) => { setDepartemenList(d.departemen || []); setAllAngkatan(d.angkatan || []); }).catch(() => undefined);
  }, []);
  const angkatanList = useMemo(() => allAngkatan.filter((a) => !form.departemen_id || a.departemen_id === form.departemen_id), [allAngkatan, form.departemen_id]);
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nama.trim() || !form.departemen_id) { toast.error("Nama dan lembaga wajib diisi"); return; }
    setLoading(true);
    try {
      const r = await pmbDaftar({ data: form });
      setRegistration({ siswa_id: r.siswa_id, payment_token: r.payment_token });
    } catch (err: any) { toast.error(err?.message || "Gagal mendaftar"); }
    finally { setLoading(false); }
  }

  async function mulaiBayar() {
    if (!registration) return;
    setCheckoutLoading(true);
    try {
      const r = await pmbCreatePayment({ data: registration });
      setPayment(r);
      window.location.assign(r.redirect_url);
    } catch (err: any) { toast.error(err?.message || "Gagal membuat pembayaran"); }
    finally { setCheckoutLoading(false); }
  }

  if (registration) return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 p-4">
      <Card className="w-full max-w-md border-emerald-200 shadow-lg">
        <CardContent className="pt-8 pb-8 space-y-5 text-center">
          <CheckCircle2 className="h-16 w-16 text-emerald-600 mx-auto" />
          <div><h2 className="text-xl font-bold text-emerald-800">Pendaftaran Berhasil</h2><p className="mt-2 text-sm text-muted-foreground">Data calon siswa <strong>{form.nama}</strong> sudah tersimpan. Selesaikan uang pendaftaran untuk melanjutkan proses PMB.</p></div>
          {payment && <div className="rounded-lg bg-muted p-3 text-sm">{payment.jenis_nama}: <strong>Rp {payment.total_amount.toLocaleString("id-ID")}</strong></div>}
          <Button onClick={mulaiBayar} disabled={checkoutLoading} className="w-full bg-emerald-600 hover:bg-emerald-700">
            <CreditCard className="h-4 w-4 mr-2" />{checkoutLoading ? "Menyiapkan pembayaran..." : "Bayar Uang Pendaftaran"}
          </Button>
          <p className="text-xs text-muted-foreground">Pembayaran diproses melalui Midtrans. Setelah pembayaran terkonfirmasi, penerimaan tercatat otomatis pada pembayaran siswa dan jurnal keuangan.</p>
          <Button variant="outline" className="w-full" onClick={() => { setRegistration(null); setPayment(null); setForm({ ...initialForm }); }}>Daftarkan Siswa Lain</Button>
          <Link to="/portal/login"><Button variant="link" className="w-full text-emerald-700">Login Portal Orang Tua</Button></Link>
        </CardContent>
      </Card>
    </div>
  );

  const showAsal = form.jenis_pendaftaran !== "baru";
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 p-4 py-8"><div className="mx-auto max-w-2xl">
      <div className="mb-6 text-center"><div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 font-bold text-white text-xl shadow-lg">J</div><h1 className="text-2xl font-bold text-emerald-800">Pendaftaran Siswa Baru</h1><p className="mt-1 text-sm text-emerald-600/80">Hijrah At-Tauhid — Sistem Manajemen Sekolah Islam</p></div>
      <Card className="shadow-lg border-emerald-200"><CardHeader className="pb-2"><p className="text-sm text-muted-foreground">Lengkapi data calon siswa. Setelah pendaftaran berhasil, uang pendaftaran dapat dibayar online.</p></CardHeader><CardContent>
        <form onSubmit={submit} className="space-y-6">
          <FormSection title="Jenis Pendaftaran" description="Pilih jenis pendaftaran siswa">
            <div><Label>Jenis Pendaftaran *</Label><Select value={form.jenis_pendaftaran} onValueChange={(v) => setForm((f) => ({ ...f, jenis_pendaftaran: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="baru">Siswa Baru</SelectItem><SelectItem value="pindahan">Siswa Pindahan</SelectItem><SelectItem value="alumni_internal">Alumni Internal (Naik Jenjang)</SelectItem></SelectContent></Select></div>
            {showAsal && <><div><Label>Asal Sekolah / Jenjang</Label><Input value={form.asal_sekolah} onChange={set("asal_sekolah")} /></div><div><Label>Kelas Terakhir</Label><Input value={form.kelas_terakhir} onChange={set("kelas_terakhir")} /></div>{form.jenis_pendaftaran === "pindahan" && <div><Label>Alasan Pindah</Label><Textarea value={form.alasan_pindah} onChange={set("alasan_pindah")} /></div>}</>}
          </FormSection>
          <FormSection title="Data Calon Siswa" description="Informasi identitas calon siswa">
            <div><Label>Nama Lengkap *</Label><Input required value={form.nama} onChange={set("nama")} /></div>
            <div className="grid grid-cols-2 gap-4"><div><Label>Jenis Kelamin</Label><Select value={form.jenis_kelamin} onValueChange={(v) => setForm((f) => ({ ...f, jenis_kelamin: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="L">Laki-laki</SelectItem><SelectItem value="P">Perempuan</SelectItem></SelectContent></Select></div><div><Label>Lembaga/Sekolah *</Label><Select value={form.departemen_id} onValueChange={(v) => setForm((f) => ({ ...f, departemen_id: v, angkatan_id: "" }))}><SelectTrigger><SelectValue placeholder="Pilih lembaga" /></SelectTrigger><SelectContent>{departemenList.map((d) => <SelectItem key={d.id} value={d.id}>{d.nama}</SelectItem>)}</SelectContent></Select></div></div>
            <div><Label>Angkatan</Label><Select disabled={!form.departemen_id} value={form.angkatan_id} onValueChange={(v) => setForm((f) => ({ ...f, angkatan_id: v }))}><SelectTrigger><SelectValue placeholder="Pilih angkatan" /></SelectTrigger><SelectContent>{angkatanList.map((a) => <SelectItem key={a.id} value={a.id}>{a.nama}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-4"><div><Label>Tempat Lahir</Label><Input value={form.tempat_lahir} onChange={set("tempat_lahir")} /></div><div><Label>Tanggal Lahir</Label><Input type="date" value={form.tanggal_lahir} onChange={set("tanggal_lahir")} /></div></div>
            <div><Label>Telepon</Label><Input value={form.telepon} onChange={set("telepon")} placeholder="08xxxxxxxxxx" /></div><div><Label>Alamat</Label><Textarea value={form.alamat} onChange={set("alamat")} /></div>
          </FormSection>
          <FormSection title="Data Orang Tua / Wali" description="Informasi orang tua atau wali siswa">
            <div className="grid grid-cols-2 gap-4"><div><Label>Nama Ayah</Label><Input value={form.nama_ayah} onChange={set("nama_ayah")} /></div><div><Label>Nama Ibu</Label><Input value={form.nama_ibu} onChange={set("nama_ibu")} /></div></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Pekerjaan Ayah</Label><Select value={form.pekerjaan_ayah} onValueChange={(v) => setForm((f) => ({ ...f, pekerjaan_ayah: v }))}><SelectTrigger><SelectValue placeholder="Pilih pekerjaan" /></SelectTrigger><SelectContent>{PEKERJAAN_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Pekerjaan Ibu</Label><Select value={form.pekerjaan_ibu} onValueChange={(v) => setForm((f) => ({ ...f, pekerjaan_ibu: v }))}><SelectTrigger><SelectValue placeholder="Pilih pekerjaan" /></SelectTrigger><SelectContent>{PEKERJAAN_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div><Label>Telepon Orang Tua</Label><Input value={form.telepon_ortu} onChange={set("telepon_ortu")} placeholder="08xxxxxxxxxx" /></div><div><Label>Alamat Orang Tua</Label><Textarea value={form.alamat_ortu} onChange={set("alamat_ortu")} /></div>
          </FormSection>
          <Button type="submit" disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-700"><UserPlus className="h-4 w-4 mr-2" />{loading ? "Mendaftarkan..." : "Daftarkan Calon Siswa"}</Button>
        </form>
      </CardContent></Card>
      <p className="mt-4 text-center text-xs text-muted-foreground">Sudah terdaftar? <Link to="/portal/login" className="text-emerald-700 underline font-medium">Login Portal Orang Tua</Link></p>
    </div></div>
  );
}
