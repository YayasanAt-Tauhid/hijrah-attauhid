import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatRupiah, terbilang, namaBulanTahun } from "@/hooks/useKeuangan";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

interface PrintKuitansiProps {
  payment: {
    id?: string;
    jumlah: number;
    bulan: number;
    tanggal_bayar: string;
    keterangan?: string;
    jenisNama: string;
    periodeLabel?: string;
    siswa: { nama: string; nis?: string };
  };
  kelasNama: string;
  lembagaNama: string;
}

export function PrintKuitansi({ payment, kelasNama, lembagaNama }: PrintKuitansiProps) {
  const { data: sekolah } = useQuery({
    queryKey: ["sekolah_info"],
    queryFn: async () => {
      const { data } = await supabase.from("sekolah").select("*").limit(1).maybeSingle();
      return data;
    },
  });

  return (
    <div id="kuitansi-print" className="hidden print:!block bg-white text-black p-6 max-w-[210mm] mx-auto text-[11pt]">
      {/* Kop Sekolah */}
      <div className="flex items-center gap-4 border-b-2 border-black pb-3 mb-4">
        {sekolah?.logo_url && (
          <img src={sekolah.logo_url} alt="Logo" className="h-16 w-16 object-contain" />
        )}
        <div className="flex-1 text-center">
          <h1 className="text-lg font-bold uppercase">{sekolah?.nama || lembagaNama}</h1>
          <p className="text-sm">{sekolah?.alamat || ""}</p>
          {sekolah?.telepon && <p className="text-xs">Telp: {sekolah.telepon} | Email: {sekolah?.email || ""}</p>}
        </div>
      </div>

      {/* Judul */}
      <h2 className="text-center font-bold text-base mb-4 underline">KUITANSI PEMBAYARAN</h2>

      {/* Detail */}
      <table className="w-full mb-4 text-sm">
        <tbody>
          <tr><td className="py-1 w-36">No. Kuitansi</td><td className="py-1">: {payment.id?.slice(0, 8).toUpperCase() || "-"}</td></tr>
          <tr><td className="py-1">Tanggal</td><td className="py-1">: {format(new Date(payment.tanggal_bayar), "dd MMMM yyyy", { locale: idLocale })}</td></tr>
          <tr><td className="py-1">Nama Siswa</td><td className="py-1">: {payment.siswa.nama}</td></tr>
          <tr><td className="py-1">NIS</td><td className="py-1">: {payment.siswa.nis || "-"}</td></tr>
          <tr><td className="py-1">Kelas</td><td className="py-1">: {kelasNama}</td></tr>
          <tr><td className="py-1">Lembaga</td><td className="py-1">: {lembagaNama}</td></tr>
          <tr><td className="py-1">Jenis Pembayaran</td><td className="py-1">: {payment.jenisNama}</td></tr>
          {payment.bulan ? (
            <tr><td className="py-1">Bulan</td><td className="py-1">: {payment.periodeLabel || namaBulanTahun(payment.bulan, { tanggalTransaksi: payment.tanggal_bayar })}</td></tr>
          ) : null}
          <tr><td className="py-1 font-bold">Jumlah</td><td className="py-1 font-bold">: {formatRupiah(payment.jumlah)}</td></tr>
          <tr><td className="py-1 italic">Terbilang</td><td className="py-1 italic">: {terbilang(payment.jumlah)}</td></tr>
          {payment.keterangan && (
            <tr><td className="py-1">Keterangan</td><td className="py-1">: {payment.keterangan}</td></tr>
          )}
        </tbody>
      </table>

      {/* Tanda tangan */}
      <div className="flex justify-between mt-12 text-sm">
        <div className="text-center">
          <p>Penerima,</p>
          <div className="h-16" />
          <p className="border-t border-black pt-1">Orang Tua / Wali</p>
        </div>
        <div className="text-center">
          <p>{sekolah?.alamat ? format(new Date(payment.tanggal_bayar), "dd MMMM yyyy", { locale: idLocale }) : ""}</p>
          <p>Petugas,</p>
          <div className="h-16" />
          <p className="border-t border-black pt-1">(_____________________)</p>
        </div>
      </div>
    </div>
  );
}