import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDepartemen } from "@/hooks/useAkademikData";
import { useJenisPembayaran, formatRupiah } from "@/hooks/useKeuangan";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export default function KonfigurasiPMB() {
  const qc = useQueryClient();
  const { data: departemenList = [] } = useDepartemen();
  const [departemenId, setDepartemenId] = useState("");
  const [jenisId, setJenisId] = useState("");
  const [onlineAktif, setOnlineAktif] = useState(true);
  const [groupUrl, setGroupUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const pendidikanList = useMemo(
    () => departemenList.filter((d: any) => d.kategori === "unit_pendidikan" || !d.kategori),
    [departemenList],
  );

  const { data: jenisList = [] } = useJenisPembayaran(departemenId || undefined);

  const { data: config, isLoading } = useQuery({
    queryKey: ["konfigurasi_pmb", departemenId],
    enabled: !!departemenId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("konfigurasi_pmb")
        .select("departemen_id, jenis_pembayaran_id, pembayaran_online_aktif, group_calon_siswa_url")
        .eq("departemen_id", departemenId)
        .maybeSingle();
      if (error) throw error;
      return data as {
        departemen_id: string;
        jenis_pembayaran_id: string;
        pembayaran_online_aktif: boolean;
        group_calon_siswa_url: string | null;
      } | null;
    },
  });

  useEffect(() => {
    setJenisId(config?.jenis_pembayaran_id || "");
    setOnlineAktif(config?.pembayaran_online_aktif ?? true);
    setGroupUrl(config?.group_calon_siswa_url || "");
  }, [config]);

  const selectedJenis = jenisList.find((j: any) => j.id === jenisId) as any;

  const handleSave = async () => {
    if (!departemenId || !jenisId) {
      toast.error("Pilih lembaga dan jenis pembayaran pendaftaran");
      return;
    }
    if (!selectedJenis?.akun_pendapatan_id) {
      toast.error("Jenis pembayaran ini belum memiliki akun pendapatan");
      return;
    }
    const cleanGroupUrl = groupUrl.trim();
    if (cleanGroupUrl) {
      try {
        const parsed = new URL(cleanGroupUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
      } catch {
        toast.error("Link grup calon siswa harus berupa URL http/https yang valid");
        return;
      }
    }

    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from("konfigurasi_pmb")
        .upsert({
          departemen_id: departemenId,
          jenis_pembayaran_id: jenisId,
          pembayaran_online_aktif: onlineAktif,
          group_calon_siswa_url: cleanGroupUrl || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "departemen_id" });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["konfigurasi_pmb", departemenId] });
      toast.success("Konfigurasi SPMB berhasil disimpan");
    } catch (e: any) {
      toast.error(e.message || "Gagal menyimpan konfigurasi SPMB");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Konfigurasi SPMB</h1>
        <p className="text-sm text-muted-foreground">
          Tentukan jenis pembayaran pendaftaran yang digunakan untuk setiap lembaga dan checkout mandiri di /spmb.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Pembayaran Pendaftaran SPMB</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Lembaga</Label>
            <Select
              value={departemenId}
              onValueChange={(v) => {
                setDepartemenId(v);
                setJenisId("");
              }}
            >
              <SelectTrigger><SelectValue placeholder="Pilih lembaga" /></SelectTrigger>
              <SelectContent>
                {pendidikanList.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.kode ? `${d.kode} — ` : ""}{d.nama}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Jenis Pembayaran Pendaftaran</Label>
            <Select value={jenisId} onValueChange={setJenisId} disabled={!departemenId || isLoading}>
              <SelectTrigger><SelectValue placeholder="Pilih jenis pembayaran" /></SelectTrigger>
              <SelectContent>
                {jenisList.map((j: any) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.nama}{j.nominal ? ` — ${formatRupiah(Number(j.nominal))}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Jenis ini menjadi satu-satunya pilihan di Pembayaran SPMB manual dan dipakai otomatis oleh pembayaran online /spmb.
            </p>
          </div>

          {selectedJenis && (
            <div className="rounded-lg border p-3 text-sm space-y-1">
              <div><span className="text-muted-foreground">Nominal:</span> {formatRupiah(Number(selectedJenis.nominal || 0))}</div>
              <div>
                <span className="text-muted-foreground">Akun pendapatan:</span>{" "}
                {selectedJenis.akun_pendapatan_id ? "Sudah dikonfigurasi" : "Belum dikonfigurasi"}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Link Grup Calon Siswa</Label>
            <Input
              type="url"
              value={groupUrl}
              onChange={(event) => setGroupUrl(event.target.value)}
              placeholder="https://chat.whatsapp.com/..."
              disabled={!departemenId || isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Isi link grup khusus lembaga yang dipilih. Setelah pendaftaran berhasil, orang tua/wali akan melihat tombol untuk bergabung ke grup ini.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>Pembayaran online aktif</Label>
              <p className="text-xs text-muted-foreground">Izinkan orang tua melanjutkan pembayaran Midtrans dari halaman /spmb.</p>
            </div>
            <Switch checked={onlineAktif} onCheckedChange={setOnlineAktif} />
          </div>

          <Button onClick={handleSave} disabled={!departemenId || !jenisId || saving}>
            {saving ? "Menyimpan..." : "Simpan Konfigurasi"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
