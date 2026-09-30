import { useEffect, useRef } from "react";
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

export interface PrintKuitansiGabunganProps {
  nomorBukti?: string;
  exportMode?: boolean;
  onExportReady?: (element: HTMLElement) => void;
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
  nomorBukti: nomorBuktiProp,
  exportMode = false,
  onExportReady,
}: PrintKuitansiGabunganProps) {
  const exportRef = useRef<HTMLDivElement>(null);
  const exportStarted = useRef(false);
  const { data: sekolah, isLoading: sekolahLoading } = useQuery({
    queryKey: ["sekolah_info"],
    queryFn: async () => {
      const { data } = await supabase.from("sekolah").select("*").limit(1).maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (exportMode && !sekolahLoading && exportRef.current && !exportStarted.current) {
      exportStarted.current = true;
      onExportReady?.(exportRef.current);
    }
  }, [exportMode, sekolahLoading, onExportReady]);

  const tanggal = new Date(tanggalBayar);
  const total = items.reduce((sum, item) => sum + item.jumlah, 0);
  const refPendek = items[0]?.id?.replace(/-/g, "").slice(0, 10).toUpperCase() || "0000000000";
  const nomorBukti = nomorBuktiProp || `HTG-${format(tanggal, "yyyyMMdd")}-${refPendek}`;
  const identitas = [siswa.nis, siswa.nisn].filter(Boolean).join(" / ") || "-";

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={exportRef}
      style={{
        fontFamily: '"Times New Roman", Times, serif',
        ...(exportMode ? { position: "absolute" as const, left: "-10000px", top: 0, width: "213mm", paddingBottom: "12px" } : {}),
      }}
      id={exportMode ? "kuitansi-download" : "kuitansi-print"}
      className={`bg-white text-black mx-auto w-full max-w-[213mm] text-[12pt] leading-[1.25] ${exportMode ? "p-0" : "hidden print:!block p-5 print:p-0"}`}
      aria-hidden={exportMode || undefined}
    >
      <div className="flex items-start justify-between gap-5 border-b-2 border-black pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <img
            src={YAYASAN_LOGO_URL}
            alt="Logo Yayasan At-Tauhid"
            className="h-[64px] w-[64px] shrink-0 object-contain"
          />
          <div className="min-w-0">
            <h1 className="text-[15pt] font-extrabold uppercase tracking-tight">
              YAYASAN AT-TAUHID AL ISLAMY BANGKA BELITUNG
            </h1>
            {sekolah?.alamat && <p className="mt-0.5 text-[11pt]">{sekolah.alamat}</p>}
            {(sekolah?.telepon || sekolah?.email) && (
              <p className="text-[10.5pt]">
                {[sekolah?.telepon ? `Telp: ${sekolah.telepon}` : "", sekolah?.email || ""]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0 border-y-2 border-black px-5 py-2 text-center text-[12.5pt] font-extrabold tracking-wide">
          BUKTI PEMBAYARAN
        </div>
      </div>

      <div className="mt-2 font-bold tracking-wide">{nomorBukti}</div>

      <table className="mt-1 w-full table-fixed text-[11.5pt]">
        <tbody>
          <tr>
            <td className="w-[115px] py-1 align-top">Nama Siswa</td>
            <td className="py-1 align-top font-semibold">{siswa.nama}</td>
            <td className="w-[100px] py-1 align-top">Tgl. Bayar</td>
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

      <div className="my-2 border-y border-black py-1.5 text-[11.5pt] font-bold">
        Dengan rincian pembayaran sebagai berikut:
      </div>

      <table className="w-full text-[11.5pt]">
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
            <td className="py-1.5 pr-3 text-right" colSpan={2}>JUMLAH</td>
            <td className="py-1.5">Rp</td>
            <td className="py-1.5 text-right">{formatAngka(total)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-2 text-[11pt]">
        <span className="font-semibold">Terbilang:</span>{" "}
        <span className="italic">{terbilang(total)}</span>
      </div>
      {keterangan && (
        <div className="mt-1 text-[11pt]">
          <span className="font-semibold">Keterangan:</span> {keterangan}
        </div>
      )}

      <div className="mt-3 grid grid-cols-[1.6fr_1fr] items-end gap-8">
        <div className="text-[10pt] leading-snug">
          <p className="italic">
            This is a computer generated message and requires no signature.
          </p>
          <p className="italic">
            Informasi ini merupakan hasil cetakan komputer dan tidak memerlukan tanda tangan petugas.
          </p>
          <p className="mt-2 font-medium">Powered by Hijrah At-Tauhid</p>
        </div>

        <div className="text-center text-[11pt]">
          <p>Penyetor,</p>
          <div className="h-6" />
          <p>(....................................)</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
