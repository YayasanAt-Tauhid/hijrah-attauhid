import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-compat";
import { Card, CardContent } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { RupiahInput } from "@/components/shared/RupiahInput";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ChevronDown, GraduationCap } from "lucide-react";
import { PortalHero } from "@/components/portal/PortalHero";
import { inisialNama, labelKelas } from "@/lib/portalAnak";
import { BULAN_ORDER_AKADEMIK } from "@/hooks/useKeuangan";
import { isUangPangkalPaymentName } from "@/lib/installment";
import {
  billingPeriodLabel,
  findBillingPrerequisite,
  findOneTimePrerequisite,
  oneTimePeriodLabel,
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
  /** Nama tampilan opsional dari view (mis. rincian biaya lama); hanya untuk teks, bukan logika. */
  nama_tampil: string | null;
  nominal: number;
  bulan: number;
  tahun_ajaran_id: string;
  tahun_ajaran_nama: string;
  tahun_ajaran_mulai: string;
  jatuh_tempo: string | null;
  /** Sudah lewat jatuh tempo dan belum lunas. */
  menunggak: boolean | null;
}

type BillBucketKey = "overdue" | "current" | "future";

function getBillBucket(t: TagihanItem, now = new Date()): BillBucketKey {
  if (t.menunggak) return "overdue";
  if (!t.jatuh_tempo) return "current";

  const due = new Date(t.jatuh_tempo);
  if (Number.isNaN(due.getTime())) return "current";

  const dueMonth = due.getFullYear() * 12 + due.getMonth();
  const currentMonth = now.getFullYear() * 12 + now.getMonth();
  return dueMonth > currentMonth ? "future" : "current";
}

export default function PortalTagihan() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [partialAmounts, setPartialAmounts] = useState<Record<string, number>>({});
  // Anak yang biaya selanjutnya (belum jatuh tempo) sudah dibuka.
  const [laterOpen, setLaterOpen] = useState<Set<string>>(new Set());

  // Get anak IDs
  const { data: anakIds = [] } = useQuery({
    queryKey: ["portal-anak-ids", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("ortu_siswa")
        .select("siswa_id")
        .eq("user_id", user!.id);
      return (data || []).map((d) => d.siswa_id);
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

  // Tagihan sekali bayar (mis. Uang Pangkal) lintas tahun ajaran: tahun
  // sebelumnya harus lunas dulu atau ikut dibayar penuh pada keranjang ini.
  // Server (buatTransaksiSnap) memeriksa ulang; ini hanya penjelasan dini.
  const oneTimeBills = useMemo<BillingSequenceBill[]>(
    () =>
      tagihan
        .filter((t) => t.bulan <= 0)
        .map((t) => ({
          id: t.tagihan_id,
          siswa_id: t.siswa_id,
          jenis_id: t.jenis_id,
          bulan: null,
          tahun_ajaran: {
            nama: t.tahun_ajaran_nama,
            tanggal_mulai: t.tahun_ajaran_mulai,
          },
        })),
    [tagihan],
  );

  const getPrerequisite = (
    t: TagihanItem,
    selectedIds?: ReadonlySet<string>,
  ) => {
    if (t.bulan <= 0) {
      const target = oneTimeBills.find((bill) => bill.id === t.tagihan_id);
      return target
        ? findOneTimePrerequisite(target, oneTimeBills, selectedIds ?? fullySelectedOneTimeIds)
        : null;
    }
    const target = sequenceBills.find((bill) => bill.id === t.tagihan_id);
    return target
      ? findBillingPrerequisite(target, sequenceBills, selectedIds ?? selectedTagihanIds)
      : null;
  };
  const prerequisiteLabel = (t: TagihanItem, prerequisite: BillingSequenceBill) =>
    t.bulan <= 0 ? oneTimePeriodLabel(prerequisite) : billingPeriodLabel(prerequisite);

  const toggleItem = (t: TagihanItem) => {
    const key = getKey(t);
    const isSelected = selected.has(key);

    if (!isSelected) {
      const prerequisite = getPrerequisite(t);
      if (prerequisite) {
        toast.warning(
          `Selesaikan ${t.jenis_nama} ${prerequisiteLabel(t, prerequisite)} terlebih dahulu`,
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

  // Biaya anak yang sedang tampil: yang sudah jatuh tempo (tunggakan lebih
  // dulu, lalu bulan ini) dan, bila dibuka, biaya selanjutnya.
  const visibleItemsFor = (siswaId: string) => {
    const items = grouped.get(siswaId) || [];
    const open = laterOpen.has(siswaId);
    return items.filter((t) => open || getBillBucket(t) !== "future");
  };

  const selectAllForSiswa = (siswaId: string) => {
    const items = grouped.get(siswaId) || [];
    const visibleKeys = visibleItemsFor(siswaId).map(getKey);
    const allSelected =
      visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        // Batalkan seluruh pilihan anak ini, termasuk biaya selanjutnya yang
        // sedang tertutup, supaya tidak tersisa pilihan yang melompati bulan.
        items.forEach((t) => next.delete(getKey(t)));
      } else {
        visibleKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  const toggleLater = (siswaId: string) => {
    setLaterOpen((prev) => {
      const next = new Set(prev);
      if (next.has(siswaId)) next.delete(siswaId);
      else next.add(siswaId);
      return next;
    });
  };

  const cicilanDiizinkan = (t: TagihanItem) =>
    t.bulan === 0 &&
    (t.status !== "terjadwal" || isUangPangkalPaymentName(t.jenis_nama));
  const amountFor = (t: TagihanItem) => {
    const requested = partialAmounts[getKey(t)];
    if (!cicilanDiizinkan(t) || requested == null) return Number(t.nominal || 0);
    return Math.min(Math.max(Number(requested) || 0, 0), Number(t.nominal || 0));
  };
  const totalSelected = selectedItems.reduce(
    (sum, t) => sum + amountFor(t),
    0
  );
  // Sekali bayar yang dibayar penuh pada keranjang ini; cicilan sebagian belum
  // memenuhi syarat tahun berikutnya.
  const fullySelectedOneTimeIds = useMemo(
    () =>
      new Set(
        selectedItems
          .filter((t) => t.bulan <= 0 && amountFor(t) >= Number(t.nominal || 0))
          .map((t) => t.tagihan_id),
      ),
    // amountFor bergantung pada partialAmounts dan daftar tagihan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedItems, partialAmounts],
  );

  const handleCheckout = () => {
    if (selectedItems.length === 0) {
      toast.warning("Pilih minimal satu biaya");
      return;
    }
    const invalidPartial = selectedItems.find((t) => {
      const amount = amountFor(t);
      return amount <= 0 || amount > Number(t.nominal || 0);
    });
    if (invalidPartial) {
      toast.error("Nominal cicilan harus lebih dari 0 dan tidak boleh melebihi sisa biaya");
      return;
    }

    const skipped = selectedItems
      .map((t) => ({ item: t, prerequisite: getPrerequisite(t) }))
      .find((entry) => entry.prerequisite);
    if (skipped?.prerequisite) {
      toast.error(
        `Selesaikan ${skipped.item.jenis_nama} ${prerequisiteLabel(skipped.item, skipped.prerequisite)} terlebih dahulu`,
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
          nama_tampil: t.nama_tampil,
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

  const selectedStudentCount = useMemo(
    () => new Set(selectedItems.map((t) => t.siswa_id)).size,
    [selectedItems],
  );

  // Urutan tampil: tunggakan, lalu bulan ini, lalu (bila dibuka) selanjutnya;
  // dalam tiap kelompok, biaya sejenis dikumpulkan berurutan menurut jatuh tempo.
  const orderForDisplay = (items: TagihanItem[]) =>
    (["overdue", "current", "future"] as BillBucketKey[]).flatMap((bucket) => {
      const byType = new Map<string, TagihanItem[]>();
      items
        .filter((item) => getBillBucket(item) === bucket)
        .forEach((item) => {
          const list = byType.get(item.jenis_id) || [];
          list.push(item);
          byType.set(item.jenis_id, list);
        });
      return Array.from(byType.values()).flatMap((typeItems) =>
        [...typeItems].sort((a, b) =>
          (a.jatuh_tempo || "").localeCompare(b.jatuh_tempo || ""),
        ),
      );
    });

  const renderBillRow = (t: TagihanItem) => {
    const key = getKey(t);
    const isSelected = selected.has(key);
    const prerequisite = isSelected ? null : getPrerequisite(t);
    const isLocked = !!prerequisite;
    const isOverdue = getBillBucket(t) === "overdue";
    const periode =
      t.bulan === 0 ? t.tahun_ajaran_nama : labelBulanTA(t.bulan, t.tahun_ajaran_mulai);
    const judul =
      t.bulan === 0 ? (t.nama_tampil ?? t.jenis_nama) : `${t.jenis_nama} ${periode}`;

    const rowTone = isSelected
      ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
      : isOverdue
        ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20"
        : "border-border bg-muted/40";
    const textTone = isOverdue
      ? "text-red-700 dark:text-red-400"
      : "text-foreground";

    return (
      <div
        key={key}
        title={
          isLocked && prerequisite
            ? `Bayar ${t.jenis_nama} ${prerequisiteLabel(t, prerequisite)} dulu`
            : undefined
        }
        className={`rounded-xl border px-3 py-2 ${rowTone}`}
      >
        <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-3">
          <Checkbox
            id={`select-bill-${key}`}
            className="h-5 w-5 rounded-md border-emerald-700/60 data-[state=checked]:border-emerald-700 data-[state=checked]:bg-emerald-700"
            checked={isSelected}
            disabled={isLocked}
            onCheckedChange={() => toggleItem(t)}
            aria-label={`${isLocked ? "Terkunci" : "Pilih"} ${t.jenis_nama} ${periode} untuk ${t.nama_siswa}`}
          />
          <label
            htmlFor={`select-bill-${key}`}
            className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 ${isLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
          >
            <span className={`min-w-0 break-words text-sm font-semibold leading-snug ${textTone}`}>
              {judul}
            </span>
            <span className={`whitespace-nowrap text-sm font-bold tabular-nums leading-snug ${textTone}`}>
              {formatRupiah(t.nominal || 0)}
            </span>
            {t.bulan === 0 && (
              <span className="col-span-2 text-xs text-muted-foreground">
                Sekali bayar · TA {t.tahun_ajaran_nama}
              </span>
            )}
          </label>
        </div>

        {cicilanDiizinkan(t) && isSelected && (
          <div className="mt-3 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 pl-8">
            <label htmlFor={`installment-${key}`} className="text-xs text-muted-foreground">
              Bayar cicilan
            </label>
            <RupiahInput
              id={`installment-${key}`}
              value={String(partialAmounts[key] ?? Number(t.nominal || 0))}
              onChange={(raw) => {
                setPartialAmounts((prev) => ({ ...prev, [key]: Number(raw) }));
              }}
              className="min-w-0 max-w-56 [&_input]:h-9 [&_input]:bg-background [&_input]:text-sm"
            />
            <span className="col-start-2 text-[10px] text-muted-foreground">
              Maks. {formatRupiah(Number(t.nominal || 0))}
            </span>
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className={`animate-fade-in ${tagihan.length > 0 ? "pb-32 md:pb-0" : ""}`}>
      <PortalHero
        title="Biaya Pendidikan"
        subtitle="Pilih biaya yang mau dibayar, lalu lanjut ke pembayaran."
        icon={GraduationCap}
        className="pb-14"
      />

      <div className="relative -mt-10 px-1 sm:px-3">
        {tagihan.length === 0 ? (
          <Card className="rounded-[1.125rem] shadow-sm">
            <CardContent className="py-12 text-center text-muted-foreground">
              Tidak ada biaya pendidikan yang belum dibayar
            </CardContent>
          </Card>
        ) : (
          <Accordion
            type="multiple"
            defaultValue={Array.from(grouped.keys())}
            className="space-y-4"
          >
            {Array.from(grouped.entries()).map(([siswaId, items]) => {
              const first = items[0];
              const allKeys = items.map(getKey);
              const selectedCount = allKeys.filter((k) => selected.has(k)).length;
              const visible = visibleItemsFor(siswaId);
              const visibleKeys = visible.map(getKey);
              const allSelected =
                visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k));
              const dueItems = orderForDisplay(
                items.filter((t) => getBillBucket(t) !== "future"),
              );
              const laterItems = orderForDisplay(
                items.filter((t) => getBillBucket(t) === "future"),
              );
              const isLaterOpen = laterOpen.has(siswaId);
              const kelas = labelKelas(first.kelas_nama);

              return (
                <AccordionItem
                  key={siswaId}
                  value={siswaId}
                  className="overflow-hidden rounded-[1.125rem] border bg-card px-0 shadow-[0_1px_2px_rgba(20,35,28,0.05),0_6px_16px_rgba(20,35,28,0.05)]"
                >
                  <AccordionTrigger
                    className="gap-3 px-4 py-4 text-left hover:no-underline"
                    aria-label={`Buka biaya pendidikan ${first.nama_siswa}`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-700 text-[15px] font-bold text-white"
                      >
                        {inisialNama(first.nama_siswa)}
                      </span>
                      <div className="min-w-0">
                        <p className="break-words text-base font-bold leading-normal text-foreground">
                          {first.nama_siswa}
                          {kelas && (
                            <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-emerald-100 px-2.5 align-[1px] text-xs font-semibold leading-normal text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                              {kelas}
                            </span>
                          )}
                        </p>
                        {selectedCount > 0 && (
                          <span className="mt-1.5 inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                            {selectedCount} dipilih
                          </span>
                        )}
                      </div>
                    </div>
                  </AccordionTrigger>

                  <AccordionContent className="px-4 pb-4">
                    <div className="space-y-3 border-t pt-4">
                      {dueItems.length === 0 && (
                        <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                          Belum ada biaya yang jatuh tempo.
                        </p>
                      )}

                      {visible.length > 0 && (
                        <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                          <Checkbox
                            className="h-5 w-5 rounded-md border-emerald-700/60 data-[state=checked]:border-emerald-700 data-[state=checked]:bg-emerald-700"
                            checked={allSelected}
                            onCheckedChange={() => selectAllForSiswa(siswaId)}
                            aria-label={`Pilih semua biaya ${first.nama_siswa}`}
                          />
                          <span className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                            Pilih semua
                          </span>
                        </label>
                      )}

                      {dueItems.length > 0 && (
                        <div className="space-y-1">{dueItems.map(renderBillRow)}</div>
                      )}

                      {laterItems.length > 0 && (
                        <>
                          <button
                            type="button"
                            aria-expanded={isLaterOpen}
                            onClick={() => toggleLater(siswaId)}
                            className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border bg-muted/40 px-3.5 py-2.5 text-left text-sm font-semibold text-foreground hover:bg-muted"
                          >
                            <span>Lihat biaya pendidikan sampai akhir tahun ajaran</span>
                            <ChevronDown
                              aria-hidden="true"
                              className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${isLaterOpen ? "rotate-180" : ""}`}
                            />
                          </button>
                          {isLaterOpen && (
                            <div className="space-y-1">{laterItems.map(renderBillRow)}</div>
                          )}
                        </>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </div>

      {tagihan.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-[#0f3d2e] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-6px_20px_rgba(15,61,46,0.25)]">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <div className="min-w-0" aria-live="polite" aria-atomic="true">
              <p className="text-xs text-emerald-200">
                {selectedItems.length === 0
                  ? "Belum ada biaya dipilih"
                  : `Dipilih: ${selectedItems.length} biaya · ${selectedStudentCount} anak`}
              </p>
              <p className="break-words text-[22px] font-extrabold leading-tight tabular-nums text-white">
                {formatRupiah(totalSelected)}
              </p>
            </div>
            <Button
              onClick={handleCheckout}
              disabled={selectedItems.length === 0}
              className="h-12 shrink-0 rounded-xl bg-emerald-400 px-5 text-[15px] font-bold text-emerald-950 shadow-[0_2px_10px_rgba(52,211,153,0.35)] hover:bg-emerald-300 disabled:bg-emerald-900 disabled:text-emerald-300/60 disabled:opacity-100 disabled:shadow-none"
            >
              Lanjut ke Pembayaran
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
