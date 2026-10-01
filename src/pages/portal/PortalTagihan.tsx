import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-compat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RupiahInput } from "@/components/shared/RupiahInput";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ShoppingCart, CheckCheck, Lock, X } from "lucide-react";
import { BULAN_ORDER_AKADEMIK } from "@/hooks/useKeuangan";
import { isSppPaymentName } from "@/lib/installment";
import {
  billingPeriodLabel,
  findBillingPrerequisite,
  sortBillingSequence,
  type BillingSequenceBill,
} from "@/lib/billingSequence";

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

  const sequenceBills = useMemo<BillingSequenceBill[]>(
    () =>
      tagihan
        .filter((t) => t.bulan > 0)
        .map((t) => ({
          id: t.tagihan_id,
          siswa_id: t.siswa_id,
          jenis_id: t.jenis_id,
          bulan: t.bulan,
          jatuh_tempo: t.jatuh_tempo,
          tahun_ajaran_mulai: t.tahun_ajaran_mulai,
        })),
    [tagihan],
  );

  const selectedItems = tagihan.filter((t) => selected.has(getKey(t)));
  const selectedTagihanIds = useMemo(
    () => new Set(selectedItems.map((t) => t.tagihan_id)),
    [selectedItems],
  );

  const getPrerequisite = (
    t: TagihanItem,
    selectedIds: ReadonlySet<string> = selectedTagihanIds,
  ) => {
    if (t.bulan <= 0) return null;
    const target = sequenceBills.find((bill) => bill.id === t.tagihan_id);
    return target
      ? findBillingPrerequisite(target, sequenceBills, selectedIds)
      : null;
  };

  const toggleItem = (t: TagihanItem) => {
    const key = getKey(t);
    const isSelected = selected.has(key);

    if (!isSelected) {
      const prerequisite = getPrerequisite(t);
      if (prerequisite) {
        toast.warning(
          `Selesaikan ${t.jenis_nama} ${billingPeriodLabel(prerequisite)} terlebih dahulu`,
        );
        return;
      }
    }

    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.has(key)) {
        next.add(key);
        return next;
      }

      next.delete(key);
      if (t.bulan <= 0) return next;

      // Jika periode lama dilepas, periode setelahnya pada rangkaian yang sama
      // ikut dilepas agar keranjang tidak pernah membentuk lompatan bulan.
      const sameSequence = sortBillingSequence(
        sequenceBills.filter(
          (bill) =>
            bill.siswa_id === t.siswa_id && bill.jenis_id === t.jenis_id,
        ),
      );
      const targetIndex = sameSequence.findIndex(
        (bill) => bill.id === t.tagihan_id,
      );
      if (targetIndex >= 0) {
        const laterIds = new Set(
          sameSequence.slice(targetIndex + 1).map((bill) => bill.id),
        );
        for (const row of tagihan) {
          if (laterIds.has(row.tagihan_id)) next.delete(getKey(row));
        }
      }
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

  const selectSppThrough = (
    siswaId: string,
    jenisId: string,
    tahunAjaranId: string,
    targetTagihanId: string,
  ) => {
    const sameYear = tagihan
      .filter(
        (t) =>
          t.siswa_id === siswaId &&
          t.jenis_id === jenisId &&
          t.tahun_ajaran_id === tahunAjaranId &&
          t.bulan > 0 &&
          isSppPaymentName(t.jenis_nama),
      )
      .sort(
        (a, b) =>
          BULAN_ORDER_AKADEMIK.indexOf(a.bulan) -
          BULAN_ORDER_AKADEMIK.indexOf(b.bulan),
      );

    const targetIndex = sameYear.findIndex((t) => t.tagihan_id === targetTagihanId);
    if (targetIndex < 0) return;

    setSelected((prev) => {
      const next = new Set(prev);

      // Aksi "bayar sampai" hanya mengatur rangkaian SPP pada TA yang sama.
      // Tagihan lain (uang pangkal, seragam, dsb.) tidak disentuh.
      sameYear.forEach((t) => next.delete(getKey(t)));
      sameYear.slice(0, targetIndex + 1).forEach((t) => next.add(getKey(t)));
      return next;
    });
  };

  const selectSppFullAcademicYear = (
    siswaId: string,
    jenisId: string,
    tahunAjaranId: string,
  ) => {
    const sameYear = tagihan
      .filter(
        (t) =>
          t.siswa_id === siswaId &&
          t.jenis_id === jenisId &&
          t.tahun_ajaran_id === tahunAjaranId &&
          t.bulan > 0 &&
          isSppPaymentName(t.jenis_nama),
      )
      .sort(
        (a, b) =>
          BULAN_ORDER_AKADEMIK.indexOf(a.bulan) -
          BULAN_ORDER_AKADEMIK.indexOf(b.bulan),
      );
    const last = sameYear.at(-1);
    if (last) selectSppThrough(siswaId, jenisId, tahunAjaranId, last.tagihan_id);
  };

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

    const skipped = selectedItems
      .filter((t) => t.bulan > 0)
      .map((t) => ({ item: t, prerequisite: getPrerequisite(t, selectedTagihanIds) }))
      .find((entry) => entry.prerequisite);
    if (skipped?.prerequisite) {
      toast.error(
        `Selesaikan ${skipped.item.jenis_nama} ${billingPeriodLabel(skipped.prerequisite)} terlebih dahulu`,
      );
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
    <div className={`space-y-6 animate-fade-in ${tagihan.length > 0 ? "pb-32 md:pb-0" : ""}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">Tagihan</h1>
          <p className="text-sm text-muted-foreground">
            Pilih tagihan yang ingin dibayar
          </p>
        </div>
        {tagihan.length > 0 && (
          <Button
            onClick={handleCheckout}
            disabled={selectedItems.length === 0}
            className="hidden shrink-0 bg-emerald-600 hover:bg-emerald-700 md:inline-flex"
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            Masukkan ke Keranjang · {formatRupiah(totalSelected)}
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

          const sppQuickGroups = Array.from(
            items
              .filter((t) => t.bulan > 0 && isSppPaymentName(t.jenis_nama))
              .reduce((map, item) => {
                const groupKey = `${item.jenis_id}:${item.tahun_ajaran_id}`;
                const list = map.get(groupKey) || [];
                list.push(item);
                map.set(groupKey, list);
                return map;
              }, new Map<string, TagihanItem[]>()),
          ).map(([groupKey, groupItems]) => ({
            groupKey,
            items: [...groupItems].sort(
              (a, b) =>
                BULAN_ORDER_AKADEMIK.indexOf(a.bulan) -
                BULAN_ORDER_AKADEMIK.indexOf(b.bulan),
            ),
          }));

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
                {sppQuickGroups.length > 0 && (
                  <div className="mb-4 space-y-3">
                    {sppQuickGroups.map(({ groupKey, items: sppItems }) => {
                      const sppFirst = sppItems[0];
                      const semester1Items = sppItems.filter((t) =>
                        [7, 8, 9, 10, 11, 12].includes(t.bulan),
                      );
                      const semester1Target = semester1Items.at(-1);
                      const totalOpenSpp = sppItems.reduce(
                        (sum, t) => sum + Number(t.nominal || 0),
                        0,
                      );

                      return (
                        <div
                          key={groupKey}
                          className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/20"
                        >
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
                                Pembayaran SPP Cepat
                              </p>
                              <p className="text-xs text-emerald-800/75 dark:text-emerald-200/70">
                                TA {sppFirst.tahun_ajaran_nama} · maksimal 2 semester (Juli–Juni)
                              </p>
                            </div>
                            <p className="text-xs font-medium tabular-nums text-emerald-800 dark:text-emerald-200">
                              Sisa tersedia {formatRupiah(totalOpenSpp)}
                            </p>
                          </div>

                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={!semester1Target}
                              className="h-10 justify-start border-emerald-300 bg-white/80 text-emerald-800 hover:bg-emerald-100 dark:bg-background"
                              onClick={() =>
                                semester1Target &&
                                selectSppThrough(
                                  siswaId,
                                  sppFirst.jenis_id,
                                  sppFirst.tahun_ajaran_id,
                                  semester1Target.tagihan_id,
                                )
                              }
                            >
                              Semester 1 · Jul–Des
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-10 justify-start border-emerald-300 bg-white/80 text-emerald-800 hover:bg-emerald-100 dark:bg-background"
                              onClick={() =>
                                selectSppFullAcademicYear(
                                  siswaId,
                                  sppFirst.jenis_id,
                                  sppFirst.tahun_ajaran_id,
                                )
                              }
                            >
                              2 Semester · Jul–Jun
                            </Button>
                          </div>

                          <div className="mt-2">
                            <Select
                              onValueChange={(tagihanId) =>
                                selectSppThrough(
                                  siswaId,
                                  sppFirst.jenis_id,
                                  sppFirst.tahun_ajaran_id,
                                  tagihanId,
                                )
                              }
                            >
                              <SelectTrigger className="h-10 bg-background">
                                <SelectValue placeholder="Atau bayar sampai bulan tertentu..." />
                              </SelectTrigger>
                              <SelectContent>
                                {sppItems.map((t) => (
                                  <SelectItem key={t.tagihan_id} value={t.tagihan_id}>
                                    Sampai {labelBulanTA(t.bulan, t.tahun_ajaran_mulai)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/70 dark:text-emerald-200/60">
                            Bulan yang sudah lunas otomatis dilewati. Pemilihan tetap berurutan dari tagihan SPP paling lama dan tidak memasukkan Uang Pangkal, Seragam, atau tagihan lainnya.
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="divide-y">
                  {items.map((t) => {
                    const key = getKey(t);
                    const isSelected = selected.has(key);
                    const prerequisite = isSelected ? null : getPrerequisite(t);
                    const isLocked = !!prerequisite;
                    return (
                      <div
                        key={key}
                        className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 py-4"
                      >
                        <Checkbox
                          id={`select-bill-${key}`}
                          className="mt-0.5 h-5 w-5 rounded-full border-emerald-700/60 data-[state=checked]:bg-emerald-700"
                          checked={isSelected}
                          disabled={isLocked}
                          onCheckedChange={() => toggleItem(t)}
                          aria-label={`${isLocked ? "Terkunci" : "Pilih"} ${t.jenis_nama} ${t.bulan === 0 ? t.tahun_ajaran_nama : labelBulanTA(t.bulan, t.tahun_ajaran_mulai)} untuk ${t.nama_siswa}`}
                        />
                        <label
                          htmlFor={`select-bill-${key}`}
                          className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 ${isLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
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
                          {isLocked && prerequisite ? (
                            <span className="col-span-2 mt-1 flex w-fit items-center gap-1 rounded bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                              <Lock className="h-3 w-3" />
                              Selesaikan {t.jenis_nama} {billingPeriodLabel(prerequisite)} terlebih dahulu
                            </span>
                          ) : t.menunggak ? (
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

      {tagihan.length > 0 && (
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
              disabled={selectedItems.length === 0}
              className="h-11 shrink-0 gap-2 bg-emerald-600 px-3 hover:bg-emerald-700 sm:px-5"
            >
              <ShoppingCart className="h-4 w-4" />
              Masukkan ke Keranjang
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
