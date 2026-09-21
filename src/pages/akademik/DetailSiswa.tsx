import { useParams, useNavigate } from "@/lib/router-compat";
import { useSiswaDetail, useSiswaDetailOrangtua } from "@/hooks/useSiswa";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SiswaSpmbDetail } from "@/components/akademik/SiswaSpmbDetail";
import { ArrowLeft, Pencil, Printer, User, BookOpen, CalendarDays, Wallet, ClipboardList } from "lucide-react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export default function DetailSiswa() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: siswa, isLoading } = useSiswaDetail(id || "");
  const { data: detailRaw } = useSiswaDetailOrangtua(id || "");
  const detail = detailRaw as Record<string, any> | null | undefined;

  const { data: nilaiList = [] } = useQuery({
    queryKey: ["penilaian", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("penilaian")
        .select("*, mapel:mapel_id(nama), semester:semester_id(nama)")
        .eq("siswa_id", id!)
        .order("jenis_ujian");
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: presensiList = [] } = useQuery({
    queryKey: ["presensi_siswa", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("presensi_siswa")
        .select("*")
        .eq("siswa_id", id!)
        .order("tanggal", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: identityAudit = [] } = useQuery({
    queryKey: ["siswa_identitas_audit", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("siswa_identitas_audit")
        .select("id, field_name, old_value, new_value, changed_at")
        .eq("siswa_id", id!)
        .order("changed_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!id,
  });

  const { data: pembayaranList = [] } = useQuery({
    queryKey: ["pembayaran", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pembayaran")
        .select("*, jenis:jenis_id(nama)")
        .eq("siswa_id", id!)
        .order("tanggal_bayar", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!siswa) {
    return <div className="text-center py-12 text-muted-foreground">Siswa tidak ditemukan</div>;
  }

  const activeKelas = siswa.kelas_siswa?.find((ks) => ks.aktif);
  const formatDate = (d: string | null) => d ? format(new Date(d), "dd MMMM yyyy", { locale: localeId }) : "-";

  const InfoRow = ({ label, value }: { label: string; value: string | React.ReactNode }) => (
    <div className="grid grid-cols-3 gap-2 py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm col-span-2">{value || "-"}</span>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/akademik/siswa")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{siswa.nama}</h1>
            <p className="text-sm text-muted-foreground">NIS: {siswa.nis || "-"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
          <Button size="sm" onClick={() => navigate(`/akademik/siswa/${id}/edit`)}>
            <Pencil className="h-4 w-4 mr-2" /> Edit Data Lengkap
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col sm:flex-row items-start gap-6 pt-6">
          <Avatar className="h-24 w-24">
            <AvatarImage src={siswa.foto_url || ""} />
            <AvatarFallback className="text-2xl">{siswa.nama.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 grid gap-2 sm:grid-cols-3">
            <div><p className="text-xs text-muted-foreground">Kelas</p><p className="font-medium">{activeKelas?.kelas?.nama || "-"}</p></div>
            <div><p className="text-xs text-muted-foreground">Tingkat</p><p className="font-medium">{activeKelas?.kelas?.tingkat?.nama || "-"}</p></div>
            <div><p className="text-xs text-muted-foreground">Departemen</p><p className="font-medium">{activeKelas?.kelas?.departemen?.nama || "-"}</p></div>
            <div><p className="text-xs text-muted-foreground">Angkatan</p><p className="font-medium">{siswa.angkatan?.nama || "-"}</p></div>
            <div><p className="text-xs text-muted-foreground">Status</p><StatusBadge status={siswa.status || "aktif"} type="siswa" /></div>
            {detail?.status_asrama && (
              <div><p className="text-xs text-muted-foreground">Asrama</p><p className="font-medium">{detail.status_asrama === "asrama" ? "Asrama" : "Non Asrama"}</p></div>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="profil">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="profil"><User className="h-3.5 w-3.5 mr-1.5" />Profil</TabsTrigger>
          <TabsTrigger value="spmb"><ClipboardList className="h-3.5 w-3.5 mr-1.5" />Data SPMB</TabsTrigger>
          <TabsTrigger value="kelas"><BookOpen className="h-3.5 w-3.5 mr-1.5" />Riwayat Kelas</TabsTrigger>
          <TabsTrigger value="nilai"><BookOpen className="h-3.5 w-3.5 mr-1.5" />Nilai</TabsTrigger>
          <TabsTrigger value="presensi"><CalendarDays className="h-3.5 w-3.5 mr-1.5" />Presensi</TabsTrigger>
          <TabsTrigger value="pembayaran"><Wallet className="h-3.5 w-3.5 mr-1.5" />Pembayaran</TabsTrigger>
        </TabsList>

        <TabsContent value="profil" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Data Pribadi</CardTitle></CardHeader>
            <CardContent>
              <InfoRow label="Nama Lengkap" value={siswa.nama} />
              <InfoRow label="NIS" value={siswa.nis || "-"} />
              <InfoRow label="NISN" value={siswa.nisn || "-"} />
              <InfoRow label="NIK Hijrah" value={detail?.nik || "-"} />
              <InfoRow label="NIK Dapodik" value={detail?.nik_dapodik || "-"} />
              <InfoRow label="Jenis Kelamin" value={siswa.jenis_kelamin === "L" ? "Laki-laki" : siswa.jenis_kelamin === "P" ? "Perempuan" : "-"} />
              <InfoRow label="Tempat, Tanggal Lahir" value={`${siswa.tempat_lahir || "-"}, ${formatDate(siswa.tanggal_lahir)}`} />
              <InfoRow label="Agama" value={siswa.agama || "-"} />
              <InfoRow label="Alamat" value={siswa.alamat || "-"} />
              <InfoRow label="Telepon" value={siswa.telepon || "-"} />
              <InfoRow label="Email" value={siswa.email || "-"} />
            </CardContent>
          </Card>

          {identityAudit.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Riwayat Perubahan Identitas</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Waktu</TableHead><TableHead>Field</TableHead><TableHead>Sebelum</TableHead><TableHead>Sesudah</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {identityAudit.map((row: any) => {
                      const labels: Record<string, string> = { nis: "NIS", nisn: "NISN", nik: "NIK Hijrah", nik_dapodik: "NIK Dapodik" };
                      return (
                        <TableRow key={row.id}>
                          <TableCell>{row.changed_at ? format(new Date(row.changed_at), "dd MMM yyyy HH:mm", { locale: localeId }) : "-"}</TableCell>
                          <TableCell>{labels[row.field_name] || row.field_name}</TableCell>
                          <TableCell>{row.old_value || "-"}</TableCell>
                          <TableCell>{row.new_value || "-"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {detail && (
            <Card>
              <CardHeader><CardTitle className="text-base">Ringkasan Orang Tua</CardTitle></CardHeader>
              <CardContent>
                <InfoRow label="Nama Ayah" value={detail.nama_ayah || "-"} />
                <InfoRow label="Nama Ibu" value={detail.nama_ibu || "-"} />
                <InfoRow label="No. HP Ayah" value={detail.telepon_ayah || detail.telepon_ortu || "-"} />
                <InfoRow label="No. HP Ibu" value={detail.telepon_ibu || "-"} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="spmb" className="mt-4">
          <SiswaSpmbDetail detail={detail} />
        </TabsContent>

        <TabsContent value="kelas" className="mt-4">
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow><TableHead>Tahun Ajaran</TableHead><TableHead>Kelas</TableHead><TableHead>Tingkat</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {(siswa.kelas_siswa || []).map((ks) => (
                  <TableRow key={ks.id}>
                    <TableCell>{ks.tahun_ajaran?.nama || "-"}</TableCell>
                    <TableCell>{ks.kelas?.nama || "-"}</TableCell>
                    <TableCell>{ks.kelas?.tingkat?.nama || "-"}</TableCell>
                    <TableCell><StatusBadge status={ks.aktif ? "aktif" : "alumni"} type="siswa" /></TableCell>
                  </TableRow>
                ))}
                {(!siswa.kelas_siswa || siswa.kelas_siswa.length === 0) && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Belum ada data riwayat kelas</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="nilai" className="mt-4">
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow><TableHead>Mata Pelajaran</TableHead><TableHead>Jenis Ujian</TableHead><TableHead>Nilai</TableHead><TableHead>Semester</TableHead></TableRow></TableHeader>
              <TableBody>
                {nilaiList.map((n: any) => <TableRow key={n.id}><TableCell>{n.mapel?.nama || "-"}</TableCell><TableCell>{n.jenis_ujian || "-"}</TableCell><TableCell className="font-medium">{n.nilai ?? "-"}</TableCell><TableCell>{n.semester?.nama || "-"}</TableCell></TableRow>)}
                {nilaiList.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Belum ada data nilai</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="presensi" className="mt-4">
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>Status</TableHead><TableHead>Keterangan</TableHead></TableRow></TableHeader>
              <TableBody>
                {presensiList.map((p: any) => <TableRow key={p.id}><TableCell>{formatDate(p.tanggal)}</TableCell><TableCell><StatusBadge status={p.status || ""} type="presensi" /></TableCell><TableCell>{p.keterangan || "-"}</TableCell></TableRow>)}
                {presensiList.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Belum ada data presensi</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="pembayaran" className="mt-4">
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>Jenis</TableHead><TableHead>Jumlah</TableHead><TableHead>Keterangan</TableHead></TableRow></TableHeader>
              <TableBody>
                {pembayaranList.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell>{formatDate(p.tanggal_bayar)}</TableCell>
                    <TableCell>{p.jenis?.nama || "-"}</TableCell>
                    <TableCell className="font-medium">{p.jumlah ? `Rp ${Number(p.jumlah).toLocaleString("id-ID")}` : "-"}</TableCell>
                    <TableCell>{p.keterangan || "-"}</TableCell>
                  </TableRow>
                ))}
                {pembayaranList.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Belum ada data pembayaran</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
