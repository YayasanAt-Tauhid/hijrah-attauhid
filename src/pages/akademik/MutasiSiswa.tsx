import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSiswaList } from "@/hooks/useSiswa";
import { useKelas, useTahunAjaran } from "@/hooks/useAkademikData";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowRightLeft, GraduationCap, LogOut, ArrowDown, Building2 } from "lucide-react";

export default function MutasiSiswa() {
  const qc = useQueryClient();
  const { role } = useAuth();
  const { data: siswaList = [] } = useSiswaList();
  const { data: kelasList = [] } = useKelas();
  const { data: taList = [] } = useTahunAjaran();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterKelas, setFilterKelas] = useState("");
  const [targetKelas, setTargetKelas] = useState("");
  const [targetTA, setTargetTA] = useState("");
  const [targetDepartemenInternal, setTargetDepartemenInternal] = useState("");
  const [targetAngkatanInternal, setTargetAngkatanInternal] = useState("");
  const [targetKelasInternal, setTargetKelasInternal] = useState("");
  const [targetTAInternal, setTargetTAInternal] = useState("");
  const [targetAsramaInternal, setTargetAsramaInternal] = useState("");
  const [alasanInternal, setAlasanInternal] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const canInternalTransfer = role === "admin" || role === "admin_tu";
  const {
    data: transferRef = { departemen: [], angkatan: [], kelas: [], tahun_ajaran: [] } as any,
    isLoading: transferRefLoading,
    error: transferRefError,
  } = useQuery({
    queryKey: ["akademik_internal_transfer_reference"],
    enabled: canInternalTransfer,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("akademik_internal_transfer_reference");
      if (error) throw error;
      return data || { departemen: [], angkatan: [], kelas: [], tahun_ajaran: [] };
    },
  });

  const activeSiswa = siswaList.filter((s) => s.status === "aktif");
  // Filter kelas asal — wajib dipakai agar "pilih semua" tidak menyeret seluruh sekolah
  const shownSiswa = filterKelas
    ? activeSiswa.filter((s) => s.kelas_siswa?.find((ks) => ks.aktif)?.kelas?.id === filterKelas)
    : activeSiswa;

  const selectedInternalStudent = selected.size === 1
    ? activeSiswa.find((s) => selected.has(s.id))
    : undefined;
  const targetInternalDept = (transferRef.departemen || []).find((d: any) => d.id === targetDepartemenInternal);
  const targetInternalCode = String(targetInternalDept?.kode || "").trim().toUpperCase();
  const targetInternalNeedsAsrama = ["SMP", "SMA", "MTA"].includes(targetInternalCode)
    || /(^|\s)(SMP|SMA|MTA)(\s|$)/.test(String(targetInternalDept?.nama || "").toUpperCase());
  const targetInternalAngkatan = (transferRef.angkatan || []).filter(
    (a: any) => a.departemen_id === targetDepartemenInternal,
  );
  const targetInternalKelas = (transferRef.kelas || []).filter(
    (k: any) => k.departemen_id === targetDepartemenInternal,
  );

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const handleKenaikan = async () => {
    if (!targetKelas || !targetTA || selected.size === 0) {
      toast.error("Pilih siswa, kelas tujuan, dan tahun ajaran");
      return;
    }
    setIsProcessing(true);
    try {
      const { error } = await (supabase as any).rpc("akademik_mutasi", {
        p_ids: Array.from(selected), p_action: "kelas", p_kelas_id: targetKelas, p_tahun_ajaran_id: targetTA,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["siswa"] });
      qc.invalidateQueries({ queryKey: ["statistik_siswa"] });
      toast.success(`${selected.size} siswa berhasil dipindahkan`);
      setSelected(new Set());
    } catch (e: any) {
      toast.error("Gagal: " + e.message);
    }
    setIsProcessing(false);
  };

  const handleBulkStatus = async (status: string) => {
    if (selected.size === 0) { toast.error("Pilih siswa terlebih dahulu"); return; }
    setIsProcessing(true);
    try {
      const { error } = await (supabase as any).rpc("akademik_mutasi", {
        p_ids: Array.from(selected), p_action: status,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["siswa"] });
      qc.invalidateQueries({ queryKey: ["statistik_siswa"] });
      toast.success(`${selected.size} siswa diubah statusnya menjadi "${status}"`);
      setSelected(new Set());
    } catch (e: any) {
      toast.error("Gagal: " + e.message);
    }
    setIsProcessing(false);
  };

  const resetInternalTransfer = () => {
    setTargetDepartemenInternal("");
    setTargetAngkatanInternal("");
    setTargetKelasInternal("");
    setTargetTAInternal("");
    setTargetAsramaInternal("");
    setAlasanInternal("");
  };

  const handleInternalTransfer = async () => {
    if (selected.size !== 1 || !selectedInternalStudent) {
      toast.error("Pilih tepat 1 siswa untuk mutasi antar lembaga");
      return;
    }
    if (!targetDepartemenInternal || !targetAngkatanInternal || !targetKelasInternal || !targetTAInternal) {
      toast.error("Lengkapi lembaga, angkatan, kelas, dan tahun ajaran tujuan");
      return;
    }
    if (targetInternalNeedsAsrama && !targetAsramaInternal) {
      toast.error("Pilih status Asrama / Non Asrama pada lembaga tujuan");
      return;
    }
    if (alasanInternal.trim().length < 5) {
      toast.error("Alasan perpindahan wajib diisi minimal 5 karakter");
      return;
    }

    const currentClass = selectedInternalStudent.kelas_siswa?.find((ks) => ks.aktif)?.kelas;
    const sourceName = currentClass?.departemen?.nama || "lembaga asal";
    const targetName = targetInternalDept?.nama || "lembaga tujuan";
    const confirmed = window.confirm(
      `Pindahkan ${selectedInternalStudent.nama} dari ${sourceName} ke ${targetName}?\n\nKelas lama akan tetap menjadi riwayat dan NIS baru akan dibuat untuk lembaga tujuan.`,
    );
    if (!confirmed) return;

    setIsProcessing(true);
    try {
      const { data, error } = await (supabase as any).rpc("akademik_mutasi_antar_lembaga", {
        p_siswa_id: selectedInternalStudent.id,
        p_departemen_tujuan_id: targetDepartemenInternal,
        p_angkatan_tujuan_id: targetAngkatanInternal,
        p_kelas_tujuan_id: targetKelasInternal,
        p_tahun_ajaran_id: targetTAInternal,
        p_alasan: alasanInternal.trim(),
        p_status_asrama: targetInternalNeedsAsrama ? targetAsramaInternal : null,
      });
      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["siswa"] }),
        qc.invalidateQueries({ queryKey: ["siswa_detail"] }),
        qc.invalidateQueries({ queryKey: ["statistik_siswa"] }),
        qc.invalidateQueries({ queryKey: ["kelas_siswa"] }),
      ]);

      toast.success(`${selectedInternalStudent.nama} berhasil dipindahkan ke ${targetName}`, {
        description: result?.nis_baru
          ? `NIS lama: ${result.nis_lama || "-"} · NIS baru: ${result.nis_baru}. Riwayat lembaga/kelas lama tetap tersimpan.`
          : "Riwayat lembaga dan kelas lama tetap tersimpan.",
        duration: 10000,
      });
      setSelected(new Set());
      resetInternalTransfer();
    } catch (e: any) {
      toast.error("Mutasi antar lembaga gagal", {
        description: e?.message || "Terjadi kesalahan teknis",
        duration: 10000,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const SiswaTable = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Select value={filterKelas || "__all__"} onValueChange={(v) => { setFilterKelas(v === "__all__" ? "" : v); setSelected(new Set()); }}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Filter kelas asal" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Semua Kelas</SelectItem>
            {kelasList.map((k) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">{shownSiswa.length} siswa aktif{filterKelas ? " di kelas ini" : ""}</p>
      </div>
      <div className="rounded-lg border overflow-x-auto max-h-[400px] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={selected.size === shownSiswa.length && shownSiswa.length > 0}
                onCheckedChange={(c) => {
                  setSelected(c ? new Set(shownSiswa.map((s) => s.id)) : new Set());
                }}
              />
            </TableHead>
            <TableHead>NIS</TableHead>
            <TableHead>Nama</TableHead>
            <TableHead>Kelas Saat Ini</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shownSiswa.map((s) => {
            const kelas = s.kelas_siswa?.find((ks) => ks.aktif)?.kelas;
            return (
              <TableRow key={s.id}>
                <TableCell><Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} /></TableCell>
                <TableCell>{s.nis || "-"}</TableCell>
                <TableCell>{s.nama}</TableCell>
                <TableCell>{kelas?.nama || "-"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Mutasi Siswa</h1>
        <p className="text-sm text-muted-foreground">Kenaikan kelas, kelulusan, dan mutasi siswa</p>
      </div>

      <Tabs defaultValue="kenaikan">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="kenaikan"><ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />Kenaikan Kelas</TabsTrigger>
          <TabsTrigger value="kelulusan"><GraduationCap className="h-3.5 w-3.5 mr-1.5" />Kelulusan</TabsTrigger>
          {canInternalTransfer && <TabsTrigger value="internal"><Building2 className="h-3.5 w-3.5 mr-1.5" />Antar Lembaga</TabsTrigger>}
          <TabsTrigger value="pindah"><LogOut className="h-3.5 w-3.5 mr-1.5" />Pindah Keluar</TabsTrigger>
          <TabsTrigger value="tinggal"><ArrowDown className="h-3.5 w-3.5 mr-1.5" />Tidak Naik</TabsTrigger>
        </TabsList>

        <TabsContent value="kenaikan" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Pilih Kelas Tujuan</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Select value={targetKelas} onValueChange={setTargetKelas}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="Kelas tujuan" /></SelectTrigger>
                <SelectContent>{kelasList.map((k) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={targetTA} onValueChange={setTargetTA}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="Tahun ajaran" /></SelectTrigger>
                <SelectContent>{taList.map((t) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}</SelectContent>
              </Select>
              <Button onClick={handleKenaikan} disabled={isProcessing}>
                Proses Kenaikan ({selected.size} siswa)
              </Button>
            </CardContent>
          </Card>
          <SiswaTable />
        </TabsContent>

        <TabsContent value="kelulusan" className="mt-4 space-y-4">
          <Card>
            <CardContent className="pt-6 flex items-center gap-3">
              <Button onClick={() => handleBulkStatus("alumni")} disabled={isProcessing}>
                <GraduationCap className="h-4 w-4 mr-2" />
                Luluskan {selected.size} Siswa
              </Button>
              <p className="text-sm text-muted-foreground">Siswa terpilih akan diubah statusnya menjadi Alumni</p>
            </CardContent>
          </Card>
          <SiswaTable />
        </TabsContent>

        {canInternalTransfer && (
          <TabsContent value="internal" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pindah Antar Lembaga Internal</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Untuk siswa yang sudah aktif lalu pindah ke unit lain di yayasan, misalnya SMA → MTA.
                  Riwayat SPMB, kelas, pembayaran lama, dan NIS lama tidak dihapus.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {transferRefError && (
                  <p className="text-sm text-destructive">
                    Referensi lembaga tujuan gagal dimuat: {transferRefError instanceof Error ? transferRefError.message : "Terjadi kesalahan."}
                  </p>
                )}

                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  {selected.size === 0 && <p className="text-muted-foreground">Pilih tepat 1 siswa pada tabel di bawah.</p>}
                  {selected.size > 1 && <p className="text-warning">Mutasi antar lembaga hanya dapat memproses 1 siswa sekaligus. Saat ini terpilih {selected.size} siswa.</p>}
                  {selectedInternalStudent && (
                    <>
                      <p className="font-medium">{selectedInternalStudent.nama}</p>
                      <p className="mt-1 text-muted-foreground">
                        NIS {selectedInternalStudent.nis || "-"} · {
                          selectedInternalStudent.kelas_siswa?.find((ks) => ks.aktif)?.kelas?.departemen?.nama || "Lembaga asal"
                        } · {
                          selectedInternalStudent.kelas_siswa?.find((ks) => ks.aktif)?.kelas?.nama || "Tanpa kelas aktif"
                        }
                      </p>
                    </>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Lembaga Tujuan *</label>
                    <Select
                      value={targetDepartemenInternal}
                      onValueChange={(value) => {
                        setTargetDepartemenInternal(value);
                        setTargetAngkatanInternal("");
                        setTargetKelasInternal("");
                        setTargetAsramaInternal("");
                      }}
                      disabled={transferRefLoading || isProcessing}
                    >
                      <SelectTrigger><SelectValue placeholder={transferRefLoading ? "Memuat..." : "Pilih lembaga tujuan"} /></SelectTrigger>
                      <SelectContent>
                        {(transferRef.departemen || [])
                          .filter((d: any) => d.id !== selectedInternalStudent?.departemen_id)
                          .map((d: any) => <SelectItem key={d.id} value={d.id}>{d.kode || d.nama} — {d.nama}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Angkatan Tujuan *</label>
                    <Select value={targetAngkatanInternal} onValueChange={setTargetAngkatanInternal} disabled={!targetDepartemenInternal || isProcessing}>
                      <SelectTrigger><SelectValue placeholder="Pilih angkatan" /></SelectTrigger>
                      <SelectContent>
                        {targetInternalAngkatan.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.nama}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Kelas Tujuan *</label>
                    <Select value={targetKelasInternal} onValueChange={setTargetKelasInternal} disabled={!targetDepartemenInternal || isProcessing}>
                      <SelectTrigger><SelectValue placeholder="Pilih kelas" /></SelectTrigger>
                      <SelectContent>
                        {targetInternalKelas.map((k: any) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Tahun Ajaran Tujuan *</label>
                    <Select value={targetTAInternal} onValueChange={setTargetTAInternal} disabled={isProcessing}>
                      <SelectTrigger><SelectValue placeholder="Pilih tahun ajaran" /></SelectTrigger>
                      <SelectContent>
                        {(transferRef.tahun_ajaran || []).map((ta: any) => <SelectItem key={ta.id} value={ta.id}>{ta.nama}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {targetInternalNeedsAsrama && (
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-sm font-medium">Status Asrama di Lembaga Tujuan *</label>
                      <Select value={targetAsramaInternal} onValueChange={setTargetAsramaInternal} disabled={isProcessing}>
                        <SelectTrigger><SelectValue placeholder="Pilih status asrama" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="asrama">Asrama</SelectItem>
                          <SelectItem value="non_asrama">Non Asrama — murid lama/internal</SelectItem>
                        </SelectContent>
                      </Select>
                      {targetInternalCode === "MTA" && (
                        <p className="text-xs text-muted-foreground">
                          MTA wajib Asrama untuk pendaftar baru. Siswa yang sudah aktif di yayasan termasuk murid lama/internal sehingga pengecualian Non Asrama dapat dipilih bila memang disetujui.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-sm font-medium">Alasan Perpindahan *</label>
                    <Textarea
                      value={alasanInternal}
                      onChange={(event) => setAlasanInternal(event.target.value)}
                      placeholder="Contoh: Permintaan orang tua untuk pindah dari SMA ke MTA."
                      disabled={isProcessing}
                    />
                  </div>
                </div>

                <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
                  Proses dilakukan atomik: kelas aktif lama dinonaktifkan sebagai riwayat, kelas tujuan diaktifkan,
                  lembaga/angkatan siswa diperbarui, NIS tujuan dibuat otomatis, dan audit perpindahan disimpan.
                  Tagihan dan histori SPMB lama tidak dihapus.
                </div>

                <Button
                  onClick={handleInternalTransfer}
                  disabled={
                    isProcessing
                    || transferRefLoading
                    || selected.size !== 1
                    || !targetDepartemenInternal
                    || !targetAngkatanInternal
                    || !targetKelasInternal
                    || !targetTAInternal
                    || (targetInternalNeedsAsrama && !targetAsramaInternal)
                    || alasanInternal.trim().length < 5
                  }
                >
                  <Building2 className="mr-2 h-4 w-4" />
                  {isProcessing ? "Memproses..." : "Proses Pindah Antar Lembaga"}
                </Button>
              </CardContent>
            </Card>
            <SiswaTable />
          </TabsContent>
        )}

        <TabsContent value="pindah" className="mt-4 space-y-4">
          <Card>
            <CardContent className="pt-6 flex items-center gap-3">
              <Button variant="outline" onClick={() => handleBulkStatus("pindah")} disabled={isProcessing}>
                <LogOut className="h-4 w-4 mr-2" />
                Tandai Pindah Keluar ({selected.size} siswa)
              </Button>
            </CardContent>
          </Card>
          <SiswaTable />
        </TabsContent>

        <TabsContent value="tinggal" className="mt-4 space-y-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-3">Siswa yang tidak naik kelas akan tetap di kelas saat ini di tahun ajaran baru.</p>
              <div className="flex items-center gap-3">
                <Select value={targetTA} onValueChange={setTargetTA}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="Tahun ajaran baru" /></SelectTrigger>
                  <SelectContent>{taList.map((t) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="outline" onClick={async () => {
                  if (!targetTA || selected.size === 0) { toast.error("Pilih siswa dan tahun ajaran"); return; }
                  setIsProcessing(true);
                  try {
                    const { error } = await (supabase as any).rpc("akademik_mutasi", {
                      p_ids: Array.from(selected), p_action: "tinggal", p_tahun_ajaran_id: targetTA,
                    });
                    if (error) throw error;
                    qc.invalidateQueries({ queryKey: ["siswa"] });
      qc.invalidateQueries({ queryKey: ["statistik_siswa"] });
                    toast.success(`${selected.size} siswa tinggal kelas`);
                    setSelected(new Set());
                  } catch (e: any) { toast.error(e.message); }
                  setIsProcessing(false);
                }} disabled={isProcessing}>
                  Proses Tinggal Kelas ({selected.size})
                </Button>
              </div>
            </CardContent>
          </Card>
          <SiswaTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}
