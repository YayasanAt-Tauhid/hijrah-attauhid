import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatRupiah, terbilang, namaBulanTahun } from "@/hooks/useKeuangan";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

interface CombinedPaymentItem {
  id?: string;
  jumlah: number;
  bulan: number;
  jenisNama: string;
  periodeLabel?: string;
}

interface PrintKuitansiGabunganProps {
  items: CombinedPaymentItem[];
  tanggalBayar: string;
  keterangan?: string;
  siswa: { nama: string; nis?: string };
  kelasNama: string;
  lembagaNama: string;
}

export function PrintKuitansiGabungan({
  items,
  tanggalBayar,
  keterangan,
  siswa,
  kelasNama,
  lembagaNama,
}: PrintKuitansiGabunganProps) {
  const { data: sekolah } = useQuery({
    queryKey: ["sekolah_info"],
    queryFn: async () => {
      const { data } = await supabase.from("sekolah").select("*").limit(1).maybeSingle();
      return data;
    },
  });

  const total = items.reduce((sum, item) => sum + item.jumlah, 0);

  return (
    <div id="kuitansi-print" className="hidden print:!block bg-white text-black p-6 max-w-[210mm] mx-auto text-[11pt]">
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

      <h2 className="text-center font-bold text-base mb-4 underline">BUKTI PEMBAYARAN GABUNGAN</h2>

      <table className="w-full mb-4 text-sm">
        <tbody>
          <tr><td className="py-1 w-36">Tanggal</td><td className="py-1">: {format(new Date(tanggalBayar), "dd MMMM yyyy", { locale: idLocale })}</td></tr>
          <tr><td className="py-1">Nama Siswa</td><td className="py-1">: {siswa.nama}</td></tr>
          <tr><td className="py-1">NIS</td><td className="py-1">: {siswa.nis || "-"}</td></tr>
          <tr><td className="py-1">Kelas</td><td className="py-1">: {kelasNama}</td></tr>
          <tr><td className="py-1">Lembaga</td><td className="py-1">: {lembagaNama}</td></tr>
        </tbody>
      </table>

      <table className="w-full border-collapse mb-4 text-sm">
        <thead>
          <tr className="border-y border-black">
            <th className="py-1.5 text-left">Jenis Pembayaran</th>
            <th className="py-1.5 text-left">Periode</th>
            <th className="py-1.5 text-left">Ref.</th>
            <th className="py-1.5 text-right">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id ?? index} className="border-b border-gray-300">
              <td className="py-1.5 pr-2">{item.jenisNama}</td>
              <td className="py-1.5 pr-2">
                {item.periodeLabel || (item.bulan ? namaBulanTahun(item.bulan, { tanggalTransaksi: tanggalBayar }) : "Sekali Bayar")}
              </td>
              <td className="py-1.5 pr-2 font-mono text-[9pt]">{item.id?.slice(0, 8).toUpperCase() || "-"}</td>
              <td className="py-1.5 text-right">{formatRupiah(item.jumlah)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-bold">
            <td className="py-2" colSpan={3}>TOTAL</td>
            <td className="py-2 text-right">{formatRupiah(total)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="text-sm italic mb-2">Terbilang: {terbilang(total)}</p>
      {keterangan && <p className="text-sm">Keterangan: {keterangan}</p>}

      <div className="flex justify-between mt-12 text-sm">
        <div className="text-center">
          <p>Penerima,</p>
          <div className="h-16" />
          <p className="border-t border-black pt-1">Orang Tua / Wali</p>
        </div>
        <div className="text-center">
          <p>{sekolah?.alamat ? format(new Date(tanggalBayar), "dd MMMM yyyy", { locale: idLocale }) : ""}</p>
          <p>Petugas,</p>
          <div className="h-16" />
          <p className="border-t border-black pt-1">(_____________________)</p>
        </div>
      </div>
    </div>
  );
}