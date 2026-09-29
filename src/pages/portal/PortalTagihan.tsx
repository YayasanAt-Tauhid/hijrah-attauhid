import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-compat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShoppingCart } from "lucide-react";
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
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tagihan</h1>
          <p className="text-sm text-muted-foreground">
            Pilih tagihan yang ingin dibayar
          </p>
        </div>
        {selectedItems.length > 0 && (
          <Button
            onClick={handleCheckout}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <ShoppingCart className="h-4 w-4 mr-2" />
            Bayar {selectedItems.length} item — {formatRupiah(totalSelected)}
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
          const subtotal = items
            .filter((t) => selected.has(getKey(t)))
            .reduce((s, t) => s + amountFor(t), 0);

          return (
            <Card key={siswaId}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={() => selectAllForSiswa(siswaId)}
                  />
                  <div>
                    <CardTitle className="text-base">
                      {first.nama_siswa}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {first.departemen_nama} — {first.kelas_nama} • NIS:{" "}
                      {first.nis || "-"}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {items.map((t) => {
                    const key = getKey(t);
                    return (
                      <div
                        key={key}
                        className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-muted/30 px-1 rounded"
                        onClick={() => toggleItem(key)}
                      >
                        <Checkbox checked={selected.has(key)} />
                        <div className="flex-1">
                          <span className="text-sm font-medium">
                            {t.jenis_nama}
                          </span>
                        <span className="text-xs text-muted-foreground ml-2">
                            {t.bulan === 0
                              ? `Sekali Bayar — TA ${t.tahun_ajaran_nama}`
                              : labelBulanTA(t.bulan, t.tahun_ajaran_mulai)}
                          </span>
                          {/* Bedakan tagihan yang sudah lewat tempo dari yang
                              memang belum waktunya, supaya daftar tagihan
                              bertahun-tahun ke depan tidak terbaca sebagai
                              tunggakan. Keduanya tetap boleh dibayar. */}
                          {t.menunggak ? (
                            <span className="ml-2 text-[10px] font-medium rounded px-1.5 py-0.5 bg-destructive/10 text-destructive">
                              Lewat jatuh tempo
                            </span>
                          ) : t.jatuh_tempo ? (
                            <span className="ml-2 text-[10px] rounded px-1.5 py-0.5 bg-muted text-muted-foreground">
                              Jatuh tempo {labelTanggal(t.jatuh_tempo)}
                            </span>
                          ) : null}
                          {cicilanDiizinkan(t) && (
                            <div
                              className="mt-2 flex max-w-sm items-center gap-2"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                                Bayar cicilan
                              </span>
                              <Input
                                type="number"
                                min={1}
                                max={Number(t.nominal || 0)}
                                value={partialAmounts[key] ?? Number(t.nominal || 0)}
                                onChange={(event) => {
                                  const value = Number(event.target.value);
                                  setPartialAmounts((prev) => ({ ...prev, [key]: value }));
                                  setSelected((prev) => {
                                    const next = new Set(prev);
                                    next.add(key);
                                    return next;
                                  });
                                }}
                                className="h-8 w-36 text-xs"
                              />
                              <span className="text-[10px] text-muted-foreground">
                                maks. {formatRupiah(Number(t.nominal || 0))}
                              </span>
                            </div>
                          )}
                        </div>
                        <span className="text-sm font-semibold">
                          {formatRupiah(t.nominal || 0)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {subtotal > 0 && (
                  <div className="mt-3 pt-3 border-t flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Subtotal {first.nama_siswa}
                    </span>
                    <span className="font-bold text-emerald-700">
                      {formatRupiah(subtotal)}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      {/* Floating checkout button mobile */}
      {selectedItems.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 md:hidden z-40">
          <Button
            onClick={handleCheckout}
            className="w-full bg-emerald-600 hover:bg-emerald-700 shadow-lg h-12 text-base"
          >
            <ShoppingCart className="h-5 w-5 mr-2" />
            Bayar {selectedItems.length} item — {formatRupiah(totalSelected)}
          </Button>
        </div>
      )}
    </div>
  );
}