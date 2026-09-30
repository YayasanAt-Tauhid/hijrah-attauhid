import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-compat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RupiahInput } from "@/components/shared/RupiahInput";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ShoppingCart, CheckCheck, X } from "lucide-react";
import { BULAN_ORDER_AKADEMIK } from "@/hooks/useKeuangan";

const NAMA_BULAN = [
  "",
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

// Label "Bulan Tahun" yang akurat untuk siklus tahun ajaran Juli-Juni
// (mis. "Juli 2026", "Januari 2027" untuk Tahun Ajaran 2026/2027) --
// bulan Juli-Des = tahun mulai tahun ajaran, bulan Jan-Jun = tahun
// mulai + 1.
function labelBulanTA(bulan: number, tahunAjaranMulai: string): string {
  const nama = NAMA_BULAN[bulan];
  if (!nama) return "";
  const tahunMulai = new Date(tahunAjaranMulai).getFullYear();
  if (!tahunAjaranMulai || Number.isNaN(tahunMulai)) return nama;
  const tahunKalender = bulan >= 7 ? tahunMulai : tahunMulai + 1;
  return `${nama} ${tahunKalender}`;
}

// Tanggal ringkas "10 Jul 2027" untuk label jatuh tempo.
function labelTanggal(tgl: string): string {
  const d = new Date(tgl);
  if (Number.isNaN(d.getTime())) return tgl;
  return `${d.getDate()} ${NAMA_BULAN[d.getMonth() + 1]?.slice(0, 3) ?? ""} ${d.getFullYear()}`;
}

const formatRupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);

interface TagihanItem {
  tagihan_id: string;
  status: string;
  siswa_id: string;
  nama_siswa: string;
  nis: string;
  kelas_nama: string;
  departemen_nama: string;
  departemen_kode: string;
  departemen_id: string;
  jenis_id: string;
  jenis_nama: string;
  nominal: number;
  bulan: number;
  tahun_ajaran_id: string;
  tahun_ajaran_nama: string;
  tahun_ajaran_mulai: string;
  jatuh_tempo: string | null;
  /** Sudah lewat jatuh tempo dan belum lunas. */
  menunggak: boolean | null;
}

export default function PortalTagihan() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [partialAmounts, setPartialAmounts] = useState<Record<string, number>>({});

  // Get anak IDs
  const { data: anakIds = [] } = useQuery({
    queryKey: ["portal-anak-ids", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("ortu_siswa")
        .select("siswa_id")
        .eq("user_id", user!.id);
      return (data || []).map((d: any) => d.siswa_id);
    },
    enabled: !!user,
  });

  // Get tagihan belum bayar
  const { data: tagihan = [], isLoading } = useQuery({
    queryKey: ["portal-tagihan", anakIds],
    queryFn: async () => {
      if (anakIds.length === 0) return [];
      const { data } = await supabase
        .from("v_tagihan_belum_bayar")
        .select("*")
        .in("siswa_id", anakIds)
        .eq("sudah_bayar", false)
        .order("nama_siswa");

      // nominal sudah final dari tabel tagihan (dihitung saat tagihan di-generate),
      // tidak perlu dihitung ulang di klien.
      const rows = ((data || []) as TagihanItem[]).filter(t => t.nominal > 0);

      // Urutkan berdasarkan tahun ajaran (tanggal mulai) dulu, lalu posisi
      // bulan dalam siklus akademik Juli-Juni (BULAN_ORDER_AKADEMIK) --
      // BUKAN urutan angka bulan 1-12 polos. Tahun ajaran berjalan lintas
      // tahun kalender (mis. Juli 2026 s.d. Juni 2027), jadi mengurutkan
      // murni berdasar angka bulan akan menaruh Januari (1) sebelum
      // Desember (12) walau Desember terjadi lebih dulu secara waktu.
      const posisiBulan = (b: number) => {
        const idx = BULAN_ORDER_AKADEMIK.indexOf(b);
        return idx === -1 ? 99 : idx; // 0 = sekali bayar, taruh di awal
      };
      rows.sort((a, b) => {
        // Grouping per siswa eksplisit (bukan mengandalkan stable-sort dari
        // urutan query), lalu tahun ajaran, lalu posisi bulan akademik.
        const namaCmp = a.nama_siswa.localeCompare(b.nama_siswa);
        if (namaCmp !== 0) return namaCmp;
        if (a.siswa_id !== b.siswa_id) return a.siswa_id.localeCompare(b.siswa_id);
        const tA = a.tahun_ajaran_mulai || "";
        const tB = b.tahun_ajaran_mulai || "";
        if (tA !== tB) return tA.localeCompare(tB);
        return posisiBulan(a.bulan) - posisiBulan(b.bulan);
      });
      return rows;
    },
    enabled: anakIds.length > 0,
  });

  // Group by siswa
  const grouped = useMemo(() => {
    const map = new Map<string, TagihanItem[]>();
    tagihan.forEach((t) => {
      const list = map.get(t.siswa_id) || [];
      list.push(t);
      map.set(t.siswa_id, list);
    });
    return map;
  }, [tagihan]);

  const getKey = (t: TagihanItem) =>
    `${t.siswa_id}-${t.jenis_id}-${t.tahun_ajaran_id}-${t.bulan}`;

  const toggleItem = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllForSiswa = (siswaId: string) => {
    const items = grouped.get(siswaId) || [];
    const keys = items.map(getKey);
    const allSelected = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (allSelected ? next.delete(k) : next.add(k)));
      return next;
    });
  };

  const selectedItems = tagihan.filter((t) => selected.has(getKey(t)));
  const cicilanDiizinkan = (t: TagihanItem) =>
    t.bulan === 0 && t.status !== "terjadwal";
  const amountFor = (t: TagihanItem) => {
    const requested = partialAmounts[getKey(t)];
    if (!cicilanDiizinkan(t) || requested == null) return Number(t.nominal || 0);
    return Math.min(Math.max(Number(requested) || 0, 0), Number(t.nominal || 0));
  };
  const totalSelected = selectedItems.reduce(
    (sum, t) => sum + amountFor(t),
    0
  );

  const handleCheckout = () => {
    if (selectedItems.length === 0) {
      toast.warning("Pilih minimal satu tagihan");
      return;
    }
    const invalidPartial = selectedItems.find((t) => {
      const amount = amountFor(t);
      return amount <= 0 || amount > Number(t.nominal || 0);
    });
    if (invalidPartial) {
      toast.error("Nominal cicilan harus lebih dari 0 dan tidak boleh melebihi sisa tagihan");
      return;
    }

    sessionStorage.setItem(
      "keranjang_tagihan",
      JSON.stringify(
        selectedItems.map((t) => ({
          tagihan_id: t.tagihan_id,
          siswa_id: t.siswa_id,
          nama_siswa: t.nama_siswa,
          jenis_id: t.jenis_id,
          jenis_nama: t.jenis_nama,
          bulan: t.bulan,
          jumlah: amountFor(t),
          departemen_id: t.departemen_id,
          departemen_nama: t.departemen_nama,
          tahun_ajaran_id: t.tahun_ajaran_id,
          tahun_ajaran_nama: t.tahun_ajaran_nama,
          kelas_nama: t.kelas_nama,
        }))
      )
    );
    navigate("/portal/checkout");
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className={`space-y-6 animate-fade-in ${selectedItems.length > 0 ? "pb-32 md:pb-0" : ""}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">Tagihan</h1>
          <p className="text-sm text-muted-foreground">
            Pilih tagihan yang ingin dibayar
          </p>
        </div>
        {selectedItems.length > 0 && (
          <Button
            onClick={handleCheckout}
            className="hidden shrink-0 bg-emerald-600 hover:bg-emerald-700 md:inline-flex"
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            Ke Keranjang · {formatRupiah(totalSelected)}
          </Button>
        )}
      </div>

      {tagihan.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            🎉 Tidak ada tagihan yang belum dibayar
          </CardContent>
        </Card>
      ) : (
        Array.from(grouped.entries()).map(([siswaId, items]) => {
          const first = items[0];
          const allKeys = items.map(getKey);
          const allChecked = allKeys.every((k) => selected.has(k));
          const selectedCount = allKeys.filter((k) => selected.has(k)).length;
          const subtotal = items
            .filter((t) => selected.has(getKey(t)))
            .reduce((s, t) => s + amountFor(t), 0);

          return (
            <Card key={siswaId} className="min-w-0 rounded-2xl shadow-sm">
              <CardHeader className="px-4 pb-3 pt-5 sm:px-6">
                <div className="min-w-0">
                  <CardTitle className="break-words text-base leading-snug">
                    {first.nama_siswa}
                  </CardTitle>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {first.departemen_nama} — {first.kelas_nama} • NIS:{" "}
                    {first.nis || "-"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <p className="text-xs text-muted-foreground" aria-live="polite" aria-atomic="true">
                    {selectedCount} dari {items.length} tagihan dipilih
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto h-9 shrink-0 gap-1.5 rounded-full border-emerald-600/50 bg-emerald-50/70 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
                    onClick={() => selectAllForSiswa(siswaId)}
                    aria-pressed={allChecked}
                    aria-label={`${allChecked ? "Batalkan pilihan" : "Pilih semua tagihan"} ${first.nama_siswa}`}
                  >
                    {allChecked ? <X className="h-4 w-4" /> : <CheckCheck className="h-4 w-4" />}
                    {allChecked ? "Batalkan pilihan" : "Pilih semua"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 sm:px-6">
                <div className="divide-y">
                  {items.map((t) => {
                    const key = getKey(t);
                    const isSelected = selected.has(key);
                    return (
                      <div
                        key={key}
                        className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 py-4"
                      >
                        <Checkbox
                          id={`select-bill-${key}`}
                          className="mt-0.5 h-5 w-5 rounded-full border-emerald-700/60 data-[state=checked]:bg-emerald-700"
                          checked={isSelected}
                          onCheckedChange={() => toggleItem(key)}
                          aria-label={`Pilih ${t.jenis_nama} ${t.bulan === 0 ? t.tahun_ajaran_nama : labelBulanTA(t.bulan, t.tahun_ajaran_mulai)} untuk ${t.nama_siswa}`}
                        />
                        <label
                          htmlFor={`select-bill-${key}`}
                          className="grid min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1"
                        >
                          <span className="min-w-0 break-words text-sm font-medium leading-snug">
                            {t.jenis_nama}
                          </span>
                          <span className="whitespace-nowrap text-sm font-semibold tabular-nums leading-snug">
                            {formatRupiah(t.nominal || 0)}
                          </span>
                          <span className="col-span-2 text-xs text-muted-foreground">
                            {t.bulan === 0
                              ? `Sekali Bayar — TA ${t.tahun_ajaran_nama}`
                              : labelBulanTA(t.bulan, t.tahun_ajaran_mulai)}
                          </span>
                          {t.menunggak ? (
                            <span className="col-span-2 mt-1 w-fit whitespace-nowrap rounded bg-destructive/10 px-2 py-1 text-[10px] font-medium text-destructive">
                              Lewat jatuh tempo
                            </span>
                          ) : t.jatuh_tempo ? (
                            <span className="col-span-2 mt-1 w-fit whitespace-nowrap rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                              Jatuh tempo {labelTanggal(t.jatuh_tempo)}
                            </span>
                          ) : null}
                        </label>
                        {cicilanDiizinkan(t) && isSelected && (
                          <div className="col-start-2 mt-3 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
                            <label htmlFor={`installment-${key}`} className="text-xs text-muted-foreground">
                              Bayar cicilan
                            </label>
                            <RupiahInput
                              id={`installment-${key}`}
                              value={String(partialAmounts[key] ?? Number(t.nominal || 0))}
                              onChange={(raw) => {
                                setPartialAmounts((prev) => ({ ...prev, [key]: Number(raw) }));
                              }}
                              className="min-w-0 max-w-56 [&_input]:h-9 [&_input]:bg-muted/40 [&_input]:text-sm"
                            />
                            <span className="col-start-2 text-[10px] text-muted-foreground">
                              Maks. {formatRupiah(Number(t.nominal || 0))}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {subtotal > 0 && (
                  <div className="mt-1 flex items-center justify-between gap-3 border-t pt-3 text-sm">
                    <span className="text-muted-foreground">Subtotal dipilih</span>
                    <span className="whitespace-nowrap font-semibold tabular-nums text-emerald-700">
                      {formatRupiah(subtotal)}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      {selectedItems.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.04)] md:hidden">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <div className="min-w-0" aria-live="polite" aria-atomic="true">
              <p className="text-xs text-muted-foreground">{selectedItems.length} tagihan dipilih</p>
              <p className="break-words text-lg font-bold tabular-nums leading-tight">
                {formatRupiah(totalSelected)}
              </p>
            </div>
            <Button
              onClick={handleCheckout}
              className="h-11 shrink-0 gap-2 bg-emerald-600 px-3 hover:bg-emerald-700 sm:px-5"
            >
              <ShoppingCart className="h-4 w-4" />
              Ke Keranjang
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
