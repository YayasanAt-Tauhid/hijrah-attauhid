import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { terbilang, namaBulanTahun } from "@/hooks/useKeuangan";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { YAYASAN_PRINT_LOGO_URL } from "@/lib/branding";
import type { ReceiptPrintOrientation } from "@/components/shared/ReceiptOrientationSelect";

interface CombinedPaymentItem {
  id?: string;
  jumlah: number;
  bulan: number;
  jenisNama: string;
  periodeLabel?: string;
  status?: "paid" | "void";
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
  orientation?: ReceiptPrintOrientation;
  receiptStatus?: "issued" | "reconciliation_required" | "partial_void" | "void";
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
  orientation = "landscape",
  receiptStatus = "issued",
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

  const isPortrait = orientation === "portrait";
  const printWidth = isPortrait ? "120mm" : "201mm";

  return createPortal(
    <div
      ref={exportRef}
      style={{
        fontFamily: '"Times New Roman", Times, serif',
        ...(exportMode ? { position: "absolute" as const, left: "-10000px", top: 0, width: printWidth, paddingBottom: "12px" } : {}),
      }}
      id={exportMode ? "kuitansi-download" : "kuitansi-print"}
      data-print-orientation={orientation}
      className={`receipt-compact bg-white text-black mx-auto w-full text-[12pt] leading-[1.15] ${isPortrait ? "max-w-[120mm]" : "max-w-[201mm]"} ${exportMode ? "p-0" : "hidden print:!block p-5 print:p-0"}`}
      aria-hidden={exportMode || undefined}
    >
      <div className={`flex items-start justify-between border-b-2 border-black pb-1 gap-2 ${isPortrait ? "flex-col" : ""}`}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <img
            src={YAYASAN_PRINT_LOGO_URL}
            alt="Logo Yayasan At-Tauhid"
            className="h-[56px] w-[44px] shrink-0 object-contain"
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
        <div className={`shrink-0 border-y-2 border-black px-2 py-1 text-center text-[12.5pt] font-extrabold tracking-wide ${isPortrait ? "w-full" : ""}`}>
          BUKTI PEMBAYARAN
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between gap-3 font-bold tracking-wide">
        <span>{nomorBukti}</span>
        {receiptStatus !== "issued" && (
          <span className="text-[10pt] uppercase">
            {receiptStatus === "void" ? "DIBATALKAN" : receiptStatus === "partial_void" ? "SEBAGIAN DIBATALKAN" : "PERLU REKONSILIASI"}
          </span>
        )}
      </div>

      <table className="mt-1 w-full table-fixed text-[11.5pt]">
        <tbody>
          <tr>
            <td className={`${isPortrait ? "w-[86px]" : "w-[115px]"} py-0.5 align-top`}>Nama Siswa</td>
            <td className="py-0.5 align-top font-semibold">{siswa.nama}</td>
            <td className={`${isPortrait ? "w-[70px]" : "w-[92px]"} py-0.5 align-top`}>Tgl. Bayar</td>
            <td className={`${isPortrait ? "w-[100px]" : "w-[132px]"} py-0.5 align-top`}>
              {format(tanggal, "dd MMM yyyy", { locale: idLocale })}
            </td>
          </tr>
          <tr>
            <td className="py-0.5 align-top">NIS / NISN</td>
            <td className="py-0.5 align-top">{identitas}</td>
            <td className="py-0.5 align-top">Metode</td>
            <td className="py-0.5 align-top">{metode}</td>
          </tr>
          <tr>
            <td className="py-0.5 align-top">Kelas</td>
            <td className="py-0.5 align-top">{kelasNama || "-"}</td>
            <td className="py-0.5 align-top">Petugas</td>
            <td className="py-0.5 align-top">{petugasNama || "-"}</td>
          </tr>
          <tr>
            <td className="py-0.5 align-top">Lembaga</td>
            <td className="py-0.5 align-top" colSpan={3}>{lembagaNama || "-"}</td>
          </tr>
        </tbody>
      </table>

      <div className="my-1 border-y border-black py-0.5 text-[11.5pt] font-bold">
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
                <td className="w-[28px] py-0.5 align-top">{index + 1}.</td>
                <td className={`py-0.5 pr-3 align-top ${item.status === "void" ? "line-through" : ""}`}>
                  {rincian}{item.status === "void" ? " — DIBATALKAN" : ""}
                </td>
                <td className="w-[30px] py-0.5 align-top">Rp</td>
                <td className={`${isPortrait ? "w-[88px]" : "w-[105px]"} py-0.5 text-right align-top`}>{formatAngka(item.jumlah)}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-black font-extrabold">
            <td className="py-0.5 pr-3 text-right" colSpan={2}>JUMLAH</td>
            <td className="py-0.5">Rp</td>
            <td className="py-0.5 text-right">{formatAngka(total)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-1 text-[11pt]">
        <span className="font-semibold">Terbilang:</span>{" "}
        <span className="italic">{terbilang(total)}</span>
      </div>
      {keterangan && (
        <div className="mt-1 text-[11pt]">
          <span className="font-semibold">Keterangan:</span> {keterangan}
        </div>
      )}

      <div className="receipt-footer mt-2 grid grid-cols-[1.6fr_1fr] items-start gap-4">
        <div className="text-[10pt] leading-[1.15]">
          <p className="italic">
            This is a computer generated message and requires no signature.
          </p>
          <p className="italic">
            Informasi ini merupakan hasil cetakan komputer dan tidak memerlukan tanda tangan petugas.
          </p>
          <p className="mt-1 font-medium">Powered by Hijrah At-Tauhid</p>
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
