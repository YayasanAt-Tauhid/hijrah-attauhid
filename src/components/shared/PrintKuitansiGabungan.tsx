import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { terbilang, namaBulanTahun } from "@/hooks/useKeuangan";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { YAYASAN_LOGO_URL } from "@/lib/branding";

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
  siswa: { nama: string; nis?: string; nisn?: string };
  kelasNama: string;
  lembagaNama: string;
  petugasNama?: string;
  metode?: string;
}

function formatAngka(value: number) {
  return new Intl.NumberFormat("id-ID").format(value);
}

export function PrintKuitansiGabungan({
  items,
  tanggalBayar,
  keterangan,
  siswa,
  kelasNama,
  lembagaNama,
  petugasNama,
  metode = "Tunai",
}: PrintKuitansiGabunganProps) {
  const { data: sekolah } = useQuery({
    queryKey: ["sekolah_info"],
    queryFn: async () => {
      const { data } = await supabase.from("sekolah").select("*").limit(1).maybeSingle();
      return data;
    },
  });

  const tanggal = new Date(tanggalBayar);
  const total = items.reduce((sum, item) => sum + item.jumlah, 0);
  const refPendek = items[0]?.id?.replace(/-/g, "").slice(0, 10).toUpperCase() || "0000000000";
  const nomorBukti = `HTG-${format(tanggal, "yyyyMMdd")}-${refPendek}`;
  const identitas = [siswa.nis, siswa.nisn].filter(Boolean).join(" / ") || "-";

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      id="kuitansi-print"
      className="hidden print:!block bg-white text-black mx-auto w-full max-w-[213mm] p-5 print:p-0 text-[10.5pt] leading-snug"
    >
      <div className="flex items-start justify-between gap-5 border-b-2 border-black pb-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <img
            src={YAYASAN_LOGO_URL}
            alt="Logo Yayasan At-Tauhid"
            className="h-[58px] w-[58px] shrink-0 object-contain"
          />
          <div className="min-w-0">
            <h1 className="text-[13.5pt] font-extrabold uppercase tracking-tight">
              YAYASAN AT-TAUHID AL ISLAMY BANGKA BELITUNG
            </h1>
            {sekolah?.alamat && <p className="mt-0.5 text-[9.5pt]">{sekolah.alamat}</p>}
            {(sekolah?.telepon || sekolah?.email) && (
              <p className="text-[9pt]">
                {[sekolah?.telepon ? `Telp: ${sekolah.telepon}` : "", sekolah?.email || ""]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0 border-y-2 border-black px-5 py-2 text-center text-[11pt] font-extrabold tracking-wide">
          BUKTI PEMBAYARAN
        </div>
      </div>

      <div className="mt-3 font-bold tracking-wide">{nomorBukti}</div>

      <table className="mt-2 w-full table-fixed text-[10pt]">
        <tbody>
          <tr>
            <td className="w-[105px] py-1 align-top">Nama Siswa</td>
            <td className="py-1 align-top font-semibold">{siswa.nama}</td>
            <td className="w-[90px] py-1 align-top">Tgl. Bayar</td>
            <td className="w-[150px] py-1 align-top">
              {format(tanggal, "dd MMM yyyy", { locale: idLocale })}
            </td>
          </tr>
          <tr>
            <td className="py-1 align-top">NIS / NISN</td>
            <td className="py-1 align-top">{identitas}</td>
            <td className="py-1 align-top">Metode</td>
            <td className="py-1 align-top">{metode}</td>
          </tr>
          <tr>
            <td className="py-1 align-top">Kelas</td>
            <td className="py-1 align-top">{kelasNama || "-"}</td>
            <td className="py-1 align-top">Petugas</td>
            <td className="py-1 align-top">{petugasNama || "-"}</td>
          </tr>
          <tr>
            <td className="py-1 align-top">Lembaga</td>
            <td className="py-1 align-top" colSpan={3}>{lembagaNama || "-"}</td>
          </tr>
        </tbody>
      </table>

      <div className="my-3 border-y border-black py-1.5 text-[10pt] font-bold">
        Dengan rincian pembayaran sebagai berikut:
      </div>

      <table className="w-full text-[10pt]">
        <tbody>
          {items.map((item, index) => {
            const periode =
              item.periodeLabel ||
              (item.bulan
                ? namaBulanTahun(item.bulan, { tanggalTransaksi: tanggalBayar })
                : "");
            const rincian = periode
              ? `${item.jenisNama} ( ${periode.toUpperCase()} )`
              : item.jenisNama;
            return (
              <tr key={item.id ?? index}>
                <td className="w-[28px] py-1.5 align-top">{index + 1}.</td>
                <td className="py-1.5 pr-3 align-top">{rincian}</td>
                <td className="w-[30px] py-1.5 align-top">Rp</td>
                <td className="w-[120px] py-1.5 text-right align-top">{formatAngka(item.jumlah)}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-black font-extrabold">
            <td className="py-2 text-right" colSpan={2}>JUMLAH</td>
            <td className="py-2">Rp</td>
            <td className="py-2 text-right">{formatAngka(total)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-2 text-[9.5pt]">
        <span className="font-semibold">Terbilang:</span>{" "}
        <span className="italic">{terbilang(total)}</span>
      </div>
      {keterangan && (
        <div className="mt-1 text-[9.5pt]">
          <span className="font-semibold">Keterangan:</span> {keterangan}
        </div>
      )}

      <div className="mt-8 grid grid-cols-[1.55fr_0.7fr_1fr] items-end gap-6">
        <div className="text-[8.5pt] leading-snug">
          <p className="italic">
            This is a computer generated message and requires no signature.
          </p>
          <p className="italic">
            Informasi ini merupakan hasil cetakan komputer dan tidak memerlukan tanda tangan petugas.
          </p>
          <p className="mt-3 font-medium">Powered by Hijrah At-Tauhid</p>
        </div>

        <div className="mx-auto flex h-[68px] w-[68px] flex-col items-center justify-center border border-black text-center leading-tight">
          <span className="text-[8px] font-bold">HIJRAH</span>
          <span className="text-[7px]">AT-TAUHID</span>
          <span className="mt-1 font-mono text-[6.5px]">{refPendek.slice(0, 8)}</span>
        </div>

        <div className="text-center text-[9.5pt]">
          <p>Penyetor,</p>
          <div className="h-14" />
          <p>(....................................)</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
