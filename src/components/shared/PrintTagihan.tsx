import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { terbilang } from "@/hooks/useKeuangan";

interface PrintTagihanProps {
  tagihan: {
    id: string;
    jenisNama: string;
    periodeLabel?: string;
    nominal: number;
    terbayar?: number;
    sisa: number;
    status: string;
    jatuhTempo?: string | null;
    siswa: { nama: string; nis?: string; nisn?: string };
  };
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

export function PrintTagihan({ tagihan, kelasNama, lembagaNama }: PrintTagihanProps) {
  const { data: sekolah } = useQuery({
    queryKey: ["sekolah_info"],
    queryFn: async () => {
      const { data } = await supabase.from("sekolah").select("*").limit(1).maybeSingle();
      return data;
    },
  });

  const refPendek = tagihan.id.replace(/-/g, "").slice(0, 10).toUpperCase();
  const nomorTagihan = `TG-${refPendek}`;
  const identitas = [tagihan.siswa.nis, tagihan.siswa.nisn].filter(Boolean).join(" / ") || "-";
  const terbayar = Math.max(Number(tagihan.terbayar || 0), 0);
  const status = statusLabel(tagihan.status, tagihan.jatuhTempo);

  return (
    <div
      id="tagihan-print"
      className="hidden print:!block bg-white text-black mx-auto max-w-[190mm] p-5 print:p-0 text-[10.5pt] leading-snug"
    >
      <div className="flex items-start justify-between gap-5 border-b-2 border-black pb-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {sekolah?.logo_url ? (
            <img src={sekolah.logo_url} alt="Logo Yayasan" className="h-[58px] w-[58px] shrink-0 object-contain" />
          ) : (
            <div className="flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-full border-2 border-black text-[9px] font-bold">
              AT-TAUHID
            </div>
          )}
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
        <div className="shrink-0 border-y-2 border-black px-4 py-2 text-center text-[11pt] font-extrabold tracking-wide">
          TAGIHAN SISWA
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-4">
        <span className="font-bold tracking-wide">{nomorTagihan}</span>
        <span className="border border-black px-2 py-1 text-[9pt] font-bold">{status}</span>
      </div>

      <table className="mt-3 w-full table-fixed text-[10pt]">
        <tbody>
          <tr>
            <td className="w-[105px] py-1 align-top">Nama Siswa</td>
            <td className="py-1 align-top font-semibold">{tagihan.siswa.nama}</td>
            <td className="w-[95px] py-1 align-top">Jatuh Tempo</td>
            <td className="w-[150px] py-1 align-top">
              {tagihan.jatuhTempo
                ? format(new Date(tagihan.jatuhTempo + "T00:00:00"), "dd MMM yyyy", { locale: idLocale })
                : "-"}
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
        Rincian tagihan:
      </div>

      <table className="w-full text-[10pt]">
        <tbody>
          <tr>
            <td className="w-[28px] py-1.5 align-top">1.</td>
            <td className="py-1.5 pr-3 align-top">
              {tagihan.jenisNama}
              {tagihan.periodeLabel ? ` ( ${tagihan.periodeLabel.toUpperCase()} )` : ""}
            </td>
            <td className="w-[30px] py-1.5 align-top">Rp</td>
            <td className="w-[120px] py-1.5 text-right align-top">{formatAngka(tagihan.nominal)}</td>
          </tr>
          {terbayar > 0 && (
            <tr>
              <td />
              <td className="py-1.5 pr-3 align-top">Sudah dibayar</td>
              <td className="py-1.5 align-top">Rp</td>
              <td className="py-1.5 text-right align-top">({formatAngka(terbayar)})</td>
            </tr>
          )}
          <tr className="border-t-2 border-black font-extrabold">
            <td className="py-2 text-right" colSpan={2}>SISA TAGIHAN</td>
            <td className="py-2">Rp</td>
            <td className="py-2 text-right">{formatAngka(tagihan.sisa)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-2 text-[9.5pt]">
        <span className="font-semibold">Terbilang sisa tagihan:</span>{" "}
        <span className="italic">{terbilang(tagihan.sisa)}</span>
      </div>

      <div className="mt-8 border-t border-black pt-3 text-[8.5pt] leading-snug">
        <p className="italic">Dokumen ini merupakan tagihan yang dihasilkan sistem dan tidak memerlukan tanda tangan petugas.</p>
        <p className="mt-2 font-medium">Powered by Hijrah At-Tauhid</p>
      </div>
    </div>
  );
}