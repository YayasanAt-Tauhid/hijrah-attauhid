import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { terbilang } from "@/hooks/useKeuangan";
import { YAYASAN_LOGO_URL } from "@/lib/branding";

export interface PrintTagihanItem {
  id: string;
  jenisNama: string;
  periodeLabel?: string;
  nominal: number;
  terbayar?: number;
  sisa: number;
  status: string;
  jatuhTempo?: string | null;
  siswa: { nama: string; nis?: string; nisn?: string };
}

interface PrintTagihanProps {
  tagihan: PrintTagihanItem | PrintTagihanItem[];
  kelasNama: string;
  lembagaNama: string;
}

function formatAngka(value: number) {
  return new Intl.NumberFormat("id-ID").format(value);
}

function statusLabel(status: string, jatuhTempo?: string | null) {
  if (status === "sebagian") return "DIBAYAR SEBAGIAN";
  if (status === "lunas") return "LUNAS";
  if (jatuhTempo) {
    const due = new Date(jatuhTempo + "T00:00:00");
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (due.getTime() > now.getTime()) return "BELUM JATUH TEMPO";
    return "SUDAH JATUH TEMPO";
  }
  return status === "terjadwal" ? "BELUM JATUH TEMPO" : "BELUM DIBAYAR";
}

function formatJatuhTempo(value?: string | null) {
  if (!value) return "-";
  return format(new Date(value + "T00:00:00"), "dd MMM yyyy", { locale: idLocale });
}

export function PrintTagihan({ tagihan, kelasNama, lembagaNama }: PrintTagihanProps) {
  const { data: sekolah } = useQuery({
    queryKey: ["sekolah_info"],
    queryFn: async () => {
      const { data } = await supabase.from("sekolah").select("*").limit(1).maybeSingle();
      return data;
    },
  });

  const items = Array.isArray(tagihan) ? tagihan : [tagihan];
  const first = items[0];
  if (!first || typeof document === "undefined") return null;

  const tanggalCetak = new Date();
  const refPendek = first.id.replace(/-/g, "").slice(0, 10).toUpperCase();
  const nomorTagihan = `TG-${format(tanggalCetak, "yyyyMMdd")}-${refPendek}`;
  const identitas = [first.siswa.nis, first.siswa.nisn].filter(Boolean).join(" / ") || "-";
  const totalSisa = items.reduce((sum, item) => sum + Math.max(Number(item.sisa || 0), 0), 0);

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
          TAGIHAN SISWA
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-4">
        <span className="font-bold tracking-wide">{nomorTagihan}</span>
        <span className="text-[9pt] font-semibold">
          {items.length} TAGIHAN
        </span>
      </div>

      <table className="mt-2 w-full table-fixed text-[10pt]">
        <tbody>
          <tr>
            <td className="w-[105px] py-1 align-top">Nama Siswa</td>
            <td className="py-1 align-top font-semibold">{first.siswa.nama}</td>
            <td className="w-[90px] py-1 align-top">Tgl. Cetak</td>
            <td className="w-[150px] py-1 align-top">
              {format(tanggalCetak, "dd MMM yyyy", { locale: idLocale })}
            </td>
          </tr>
          <tr>
            <td className="py-1 align-top">NIS / NISN</td>
            <td className="py-1 align-top">{identitas}</td>
            <td className="py-1 align-top">Kelas</td>
            <td className="py-1 align-top">{kelasNama || "-"}</td>
          </tr>
          <tr>
            <td className="py-1 align-top">Lembaga</td>
            <td className="py-1 align-top" colSpan={3}>{lembagaNama || "-"}</td>
          </tr>
        </tbody>
      </table>

      <div className="my-3 border-y border-black py-1.5 text-[10pt] font-bold">
        Dengan rincian tagihan sebagai berikut:
      </div>

      <table className="w-full text-[9.5pt]">
        <thead>
          <tr>
            <th className="w-[28px] py-1.5 text-left">No.</th>
            <th className="py-1.5 text-left">Rincian</th>
            <th className="w-[112px] py-1.5 text-left">Jatuh Tempo</th>
            <th className="w-[126px] py-1.5 text-left">Status</th>
            <th className="w-[120px] py-1.5 text-right">Sisa</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const terbayar = Math.max(Number(item.terbayar || 0), 0);
            const label = statusLabel(item.status, item.jatuhTempo);
            return (
              <tr key={item.id}>
                <td className="py-1.5 align-top">{index + 1}.</td>
                <td className="py-1.5 pr-3 align-top">
                  <div className="font-semibold">
                    {item.jenisNama}
                    {item.periodeLabel ? ` ( ${item.periodeLabel.toUpperCase()} )` : ""}
                  </div>
                  {terbayar > 0 && (
                    <div className="mt-0.5 text-[8.5pt]">
                      Tagihan Rp {formatAngka(item.nominal)} · Sudah dibayar Rp {formatAngka(terbayar)}
                    </div>
                  )}
                </td>
                <td className="py-1.5 align-top">{formatJatuhTempo(item.jatuhTempo)}</td>
                <td className="py-1.5 align-top text-[8.5pt] font-semibold">{label}</td>
                <td className="py-1.5 text-right align-top">
                  Rp {formatAngka(Math.max(Number(item.sisa || 0), 0))}
                </td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-black font-extrabold">
            <td className="py-2 text-right" colSpan={4}>TOTAL SISA TAGIHAN</td>
            <td className="py-2 text-right">Rp {formatAngka(totalSisa)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-2 text-[9.5pt]">
        <span className="font-semibold">Terbilang:</span>{" "}
        <span className="italic">{terbilang(totalSisa)}</span>
      </div>

      <div className="mt-8 grid grid-cols-[1.55fr_0.7fr_1fr] items-end gap-6">
        <div className="text-[8.5pt] leading-snug">
          <p className="italic">
            Dokumen ini merupakan tagihan yang dihasilkan sistem dan tidak memerlukan tanda tangan petugas.
          </p>
          <p className="mt-3 font-medium">Powered by Hijrah At-Tauhid</p>
        </div>

        <div className="mx-auto flex h-[68px] w-[68px] flex-col items-center justify-center border border-black text-center leading-tight">
          <span className="text-[8px] font-bold">HIJRAH</span>
          <span className="text-[7px]">AT-TAUHID</span>
          <span className="mt-1 font-mono text-[6.5px]">{refPendek.slice(0, 8)}</span>
        </div>

        <div className="text-right text-[8.5pt] leading-snug">
          <p>{items.length === 1 ? "1 tagihan" : `${items.length} tagihan`} dalam satu dokumen</p>
          <p>Total sisa: Rp {formatAngka(totalSisa)}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
