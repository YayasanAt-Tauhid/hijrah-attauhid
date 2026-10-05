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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ShoppingCart, CheckCheck, Lock, X, AlertTriangle, CalendarDays, Users } from "lucide-react";
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

type BillBucketKey = "overdue" | "current" | "future";

const BILL_BUCKET_LABELS: Record<BillBucketKey, string> = {
  overdue: "Tunggakan",
  current: "Bulan Ini",
  future: "Mendatang",
};

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
    tahunAjaranMulai: string,
    targetTagihanId: string,
  ) => {
    const sameYear = tagihan
      .filter(
        (t) =>
          t.siswa_id === siswaId &&
          t.jenis_id === jenisId &&
          t.tahun_ajaran_mulai === tahunAjaranMulai &&
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
    tahunAjaranMulai: string,
  ) => {
    const sameYear = tagihan
      .filter(
        (t) =>
          t.siswa_id === siswaId &&
          t.jenis_id === jenisId &&
          t.tahun_ajaran_mulai === tahunAjaranMulai &&
          t.bulan > 0 &&
          isSppPaymentName(t.jenis_nama),
      )
      .sort(
        (a, b) =>
          BULAN_ORDER_AKADEMIK.indexOf(a.bulan) -
          BULAN_ORDER_AKADEMIK.indexOf(b.bulan),
      );
    const last = sameYear.at(-1);
    if (last) selectSppThrough(siswaId, jenisId, tahunAjaranMulai, last.tagihan_id);
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

  const portalSummary = useMemo(() => {
    const overdueItems = tagihan.filter((t) => getBillBucket(t) === "overdue");
    const futureItems = tagihan.filter((t) => getBillBucket(t) === "future");
    return {
      childCount: grouped.size,
      billCount: tagihan.length,
      total: tagihan.reduce((sum, t) => sum + Number(t.nominal || 0), 0),
      overdueCount: overdueItems.length,
      overdueTotal: overdueItems.reduce((sum, t) => sum + Number(t.nominal || 0), 0),
      futureCount: futureItems.length,
    };
  }, [grouped, tagihan]);

  const selectedStudentCount = useMemo(
    () => new Set(selectedItems.map((t) => t.siswa_id)).size,
    [selectedItems],
  );

  const defaultOpenChildren = useMemo(() => {
    const entries = Array.from(grouped.entries());
    const overdueChild = entries.find(([, items]) =>
      items.some((item) => getBillBucket(item) === "overdue"),
    );
    const first = overdueChild || entries[0];
    return first ? [first[0]] : [];
  }, [grouped]);

  const groupByType = (items: TagihanItem[]) =>
    Array.from(
      items.reduce((map, item) => {
        const key = item.jenis_id;
        const list = map.get(key) || [];
        list.push(item);
        map.set(key, list);
        return map;
      }, new Map<string, TagihanItem[]>()),
    ).map(([jenisId, typeItems]) => ({
      jenisId,
      items: [...typeItems].sort((a, b) =>
        (a.jatuh_tempo || "").localeCompare(b.jatuh_tempo || ""),
      ),
    }));

  const renderSppQuickActions = (siswaId: string, typeItems: TagihanItem[]) => {
    if (!typeItems.some((t) => t.bulan > 0 && isSppPaymentName(t.jenis_nama))) {
      return null;
    }

    const sppQuickGroups = Array.from(
      typeItems
        .filter((t) => t.bulan > 0 && isSppPaymentName(t.jenis_nama))
        .reduce((map, item) => {
          const groupKey = item.tahun_ajaran_mulai;
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
      <div className="space-y-3 pb-3">
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
                    TA {sppFirst.tahun_ajaran_nama} · {sppItems.length} bulan tersedia
                  </p>
                </div>
                <p className="text-xs font-medium tabular-nums text-emerald-800 dark:text-emerald-200">
                  {formatRupiah(totalOpenSpp)}
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
                      sppFirst.tahun_ajaran_mulai,
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
                      sppFirst.tahun_ajaran_mulai,
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
                      sppFirst.tahun_ajaran_mulai,
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
            </div>
          );
        })}
      </div>
    );
  };

  const renderBillRow = (t: TagihanItem) => {
    const key = getKey(t);
    const isSelected = selected.has(key);
    const prerequisite = isSelected ? null : getPrerequisite(t);
    const isLocked = !!prerequisite;

    return (
      <div
        key={key}
        className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 py-3.5"
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
            {t.bulan === 0
              ? t.jenis_nama
              : labelBulanTA(t.bulan, t.tahun_ajaran_mulai)}
          </span>
          <span className="whitespace-nowrap text-sm font-semibold tabular-nums leading-snug">
            {formatRupiah(t.nominal || 0)}
          </span>
          <span className="col-span-2 text-xs text-muted-foreground">
            {t.bulan === 0
              ? `Sekali Bayar — TA ${t.tahun_ajaran_nama}`
              : t.jatuh_tempo
                ? `Jatuh tempo ${labelTanggal(t.jatuh_tempo)}`
                : t.jenis_nama}
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
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className={`space-y-5 animate-fade-in ${tagihan.length > 0 ? "pb-32 md:pb-0" : ""}`}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-foreground">Tagihan</h1>
        <p className="text-sm text-muted-foreground">
          Pilih anak dan tagihan yang ingin dibayar
        </p>
      </div>

      {tagihan.length > 0 && (
        <Card className="overflow-hidden rounded-2xl border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-background shadow-sm dark:border-emerald-950 dark:from-emerald-950/20">
          <CardContent className="p-4 sm:p-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl bg-background/85 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Users className="h-4 w-4" />
                  Anak
                </div>
                <p className="mt-1 text-xl font-bold tabular-nums">{portalSummary.childCount}</p>
              </div>
              <div className="rounded-xl bg-background/85 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarDays className="h-4 w-4" />
                  Tagihan
                </div>
                <p className="mt-1 text-xl font-bold tabular-nums">{portalSummary.billCount}</p>
              </div>
              <div className="rounded-xl bg-background/85 p-3">
                <p className="text-xs text-muted-foreground">Total tersedia</p>
                <p className="mt-1 break-words text-base font-bold tabular-nums sm:text-lg">
                  {formatRupiah(portalSummary.total)}
                </p>
              </div>
              <div className="rounded-xl bg-background/85 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="h-4 w-4" />
                  Tunggakan
                </div>
                <p className="mt-1 break-words text-base font-bold tabular-nums text-destructive sm:text-lg">
                  {formatRupiah(portalSummary.overdueTotal)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {portalSummary.overdueCount} tagihan
                </p>
              </div>
            </div>
            {portalSummary.futureCount > 0 && (
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Tagihan mendatang tetap tersedia bila ingin dibayar lebih awal. Tunggakan dan tagihan bulan berjalan ditampilkan lebih dahulu.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {tagihan.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            🎉 Tidak ada tagihan yang belum dibayar
          </CardContent>
        </Card>
      ) : (
        <Accordion
          type="multiple"
          defaultValue={defaultOpenChildren}
          className="space-y-3"
        >
          {Array.from(grouped.entries()).map(([siswaId, items]) => {
            const first = items[0];
            const allKeys = items.map(getKey);
            const allChecked = allKeys.every((k) => selected.has(k));
            const selectedCount = allKeys.filter((k) => selected.has(k)).length;
            const childTotal = items.reduce(
              (sum, t) => sum + Number(t.nominal || 0),
              0,
            );
            const childOverdue = items.filter(
              (t) => getBillBucket(t) === "overdue",
            );
            const childOverdueTotal = childOverdue.reduce(
              (sum, t) => sum + Number(t.nominal || 0),
              0,
            );
            const subtotal = items
              .filter((t) => selected.has(getKey(t)))
              .reduce((sum, t) => sum + amountFor(t), 0);

            const bucketGroups = (["overdue", "current", "future"] as BillBucketKey[])
              .map((bucket) => {
                const bucketItems = items.filter(
                  (item) => getBillBucket(item) === bucket,
                );
                return {
                  bucket,
                  items: bucketItems,
                  groups: groupByType(bucketItems),
                  total: bucketItems.reduce(
                    (sum, item) => sum + Number(item.nominal || 0),
                    0,
                  ),
                };
              })
              .filter((group) => group.items.length > 0);

            return (
              <AccordionItem
                key={siswaId}
                value={siswaId}
                className="overflow-hidden rounded-2xl border bg-card px-0 shadow-sm"
              >
                <AccordionTrigger
                  className="px-4 py-4 text-left hover:no-underline sm:px-5"
                  aria-label={`Buka tagihan ${first.nama_siswa}`}
                >
                  <div className="grid min-w-0 flex-1 gap-3 pr-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="break-words text-base font-semibold leading-snug text-foreground">
                        {first.nama_siswa}
                      </p>
                      <p className="mt-1 break-words text-xs font-normal text-muted-foreground">
                        {first.departemen_nama} — {first.kelas_nama} · NIS {first.nis || "-"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                          {items.length} tagihan
                        </span>
                        {childOverdue.length > 0 && (
                          <span className="rounded-full bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive">
                            {childOverdue.length} tunggakan
                          </span>
                        )}
                        {selectedCount > 0 && (
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                            {selectedCount} dipilih
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-[11px] font-normal text-muted-foreground">Total tersedia</p>
                      <p className="text-base font-bold tabular-nums text-foreground">
                        {formatRupiah(childTotal)}
                      </p>
                      {childOverdueTotal > 0 && (
                        <p className="mt-0.5 text-[11px] font-medium tabular-nums text-destructive">
                          Tunggakan {formatRupiah(childOverdueTotal)}
                        </p>
                      )}
                    </div>
                  </div>
                </AccordionTrigger>

                <AccordionContent className="px-4 pb-4 sm:px-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                    <p className="text-xs text-muted-foreground" aria-live="polite" aria-atomic="true">
                      {selectedCount} dari {items.length} tagihan dipilih
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0 gap-1.5 rounded-full border-emerald-600/50 bg-emerald-50/70 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
                      onClick={() => selectAllForSiswa(siswaId)}
                      aria-pressed={allChecked}
                      aria-label={`${allChecked ? "Batalkan pilihan" : "Pilih semua tagihan"} ${first.nama_siswa}`}
                    >
                      {allChecked ? <X className="h-4 w-4" /> : <CheckCheck className="h-4 w-4" />}
                      {allChecked ? "Batalkan pilihan" : "Pilih semua"}
                    </Button>
                  </div>

                  <div className="space-y-5">
                    {bucketGroups.map(({ bucket, items: bucketItems, groups, total }) => (
                      <section key={bucket} aria-label={BILL_BUCKET_LABELS[bucket]}>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div>
                            <h2
                              className={`text-sm font-semibold ${
                                bucket === "overdue" ? "text-destructive" : "text-foreground"
                              }`}
                            >
                              {BILL_BUCKET_LABELS[bucket]}
                            </h2>
                            <p className="text-[11px] text-muted-foreground">
                              {bucketItems.length} tagihan
                            </p>
                          </div>
                          <p className="text-sm font-semibold tabular-nums">
                            {formatRupiah(total)}
                          </p>
                        </div>

                        <Accordion
                          type="multiple"
                          defaultValue={
                            bucket === "future"
                              ? []
                              : groups.map((group) => `${bucket}:${group.jenisId}`)
                          }
                          className="space-y-2"
                        >
                          {groups.map(({ jenisId, items: typeItems }) => {
                            const typeFirst = typeItems[0];
                            const typeTotal = typeItems.reduce(
                              (sum, item) => sum + Number(item.nominal || 0),
                              0,
                            );
                            const typeSelected = typeItems.filter((item) =>
                              selected.has(getKey(item)),
                            ).length;
                            const typeKey = `${bucket}:${jenisId}`;

                            const allTypeItems = items.filter(
                              (item) => item.jenis_id === jenisId,
                            );
                            const firstBucketForType = (
                              ["overdue", "current", "future"] as BillBucketKey[]
                            ).find((candidate) =>
                              allTypeItems.some(
                                (item) => getBillBucket(item) === candidate,
                              ),
                            );

                            return (
                              <AccordionItem
                                key={typeKey}
                                value={typeKey}
                                className="overflow-hidden rounded-xl border bg-background px-0"
                              >
                                <AccordionTrigger className="px-3 py-3 text-left hover:no-underline">
                                  <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 pr-2">
                                    <div className="min-w-0">
                                      <p className="break-words text-sm font-medium leading-snug">
                                        {typeFirst.jenis_nama}
                                      </p>
                                      <p className="mt-1 text-[11px] font-normal text-muted-foreground">
                                        {typeItems.length} tagihan
                                        {typeSelected > 0 ? ` · ${typeSelected} dipilih` : ""}
                                      </p>
                                    </div>
                                    <p className="whitespace-nowrap text-sm font-semibold tabular-nums">
                                      {formatRupiah(typeTotal)}
                                    </p>
                                  </div>
                                </AccordionTrigger>
                                <AccordionContent className="px-3 pb-2">
                                  {bucket === firstBucketForType
                                    ? renderSppQuickActions(siswaId, allTypeItems)
                                    : null}
                                  <div className="divide-y">
                                    {typeItems.map(renderBillRow)}
                                  </div>
                                </AccordionContent>
                              </AccordionItem>
                            );
                          })}
                        </Accordion>
                      </section>
                    ))}
                  </div>

                  {subtotal > 0 && (
                    <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3 text-sm">
                      <span className="text-muted-foreground">Subtotal dipilih</span>
                      <span className="whitespace-nowrap font-semibold tabular-nums text-emerald-700">
                        {formatRupiah(subtotal)}
                      </span>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {tagihan.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur supports-[backdrop-filter]:bg-background/90">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <div className="min-w-0" aria-live="polite" aria-atomic="true">
              <p className="text-xs text-muted-foreground">
                {selectedItems.length} tagihan
                {selectedStudentCount > 0 ? ` dari ${selectedStudentCount} anak` : ""} dipilih
              </p>
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
