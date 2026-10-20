import { deleteWithApproval, deletionMessage } from "@/lib/dataDeletion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface KasKecilSetting {
  id: string;
  dana_imprest: number;
  akun_kas_kecil_id: string | null;
  akun_pengisian_id: string | null;
  keterangan: string | null;
  updated_at: string | null;
}

export interface TransaksiKasKecil {
  id: string;
  tanggal: string;
  keterangan: string;
  jenis_pengeluaran_id: string | null;
  jumlah: number;
  penerima: string | null;
  no_bukti: string | null;
  replenishment_id: string | null;
  dibuat_oleh: string | null;
  created_at: string | null;
  jenis_pengeluaran?: { id: string; nama: string; akun_beban_id: string | null } | null;
}

export interface ReplenishmentKasKecil {
  id: string;
  tanggal: string;
  jumlah: number;
  keterangan: string | null;
  jurnal_id: string | null;
  created_at: string | null;
  jurnal?: { nomor: string | null } | null;
  transaksi?: TransaksiKasKecil[];
}

// ── Settings ───────────────────────────────────────────────────────────────────

export function useKasKecilSetting() {
  return useQuery({
    queryKey: ["kas_kecil_setting"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("kas_kecil_setting")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as KasKecilSetting | null;
    },
  });
}

export function useUpdateKasKecilSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Omit<KasKecilSetting, "id" | "updated_at">>) => {
      const { data: existing } = await (supabase as any)
        .from("kas_kecil_setting")
        .select("id")
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await (supabase as any)
          .from("kas_kecil_setting")
          .update({ ...values, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("kas_kecil_setting")
          .insert({ ...values });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kas_kecil_setting"] });
      toast.success("Pengaturan kas kecil disimpan");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ── Transaksi ──────────────────────────────────────────────────────────────────

export function useTransaksiKasKecilList(filters?: {
  bulan?: number;
  tahun?: number;
  onlyPending?: boolean;
}) {
  return useQuery({
    queryKey: ["transaksi_kas_kecil", filters],
    queryFn: async () => {
      let q = (supabase as any)
        .from("transaksi_kas_kecil")
        .select("*, jenis_pengeluaran:jenis_pengeluaran_id(id, nama, akun_beban_id)")
        .order("tanggal", { ascending: false });

      if (filters?.onlyPending) {
        q = q.is("replenishment_id", null);
      }
      if (filters?.bulan && filters?.tahun) {
        const y = filters.tahun;
        const m = filters.bulan;
        const start = `${y}-${String(m).padStart(2, "0")}-01`;
        const end = new Date(y, m, 0).toISOString().split("T")[0];
        q = q.gte("tanggal", start).lte("tanggal", end);
      } else if (filters?.tahun) {
        q = q.gte("tanggal", `${filters.tahun}-01-01`).lte("tanggal", `${filters.tahun}-12-31`);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as TransaksiKasKecil[];
    },
  });
}

export function useCreateTransaksiKasKecil() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      tanggal: string;
      keterangan: string;
      jenis_pengeluaran_id?: string | null;
      jumlah: number;
      penerima?: string | null;
      no_bukti?: string | null;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await (supabase as any)
        .from("transaksi_kas_kecil")
        .insert({ ...values, dibuat_oleh: user?.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transaksi_kas_kecil"] });
      toast.success("Transaksi kas kecil berhasil dicatat");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateTransaksiKasKecil() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: { id: string; [key: string]: any }) => {
      const { error } = await (supabase as any)
        .from("transaksi_kas_kecil")
        .update(values)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transaksi_kas_kecil"] });
      toast.success("Transaksi berhasil diperbarui");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteTransaksiKasKecil() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => deleteWithApproval("transaksi_kas_kecil", id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["transaksi_kas_kecil"] });
      toast.success(deletionMessage(result, "Transaksi dihapus"));
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ── Replenishment ──────────────────────────────────────────────────────────────

export function useReplenishmentList() {
  return useQuery({
    queryKey: ["replenishment_kas_kecil"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("replenishment_kas_kecil")
        .select("*, jurnal:jurnal_id(nomor)")
        .order("tanggal", { ascending: false });
      if (error) throw error;
      return (data || []) as ReplenishmentKasKecil[];
    },
  });
}

export function useCreateReplenishment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      tanggal,
      keterangan,
      transaksiIds,
    }: {
      tanggal: string;
      keterangan?: string;
      transaksiIds: string[];
    }) => {
      // 1. Ambil data transaksi yang dipilih
      const { data: transaksiList, error: tErr } = await (supabase as any)
        .from("transaksi_kas_kecil")
        .select("*, jenis_pengeluaran:jenis_pengeluaran_id(id, nama, akun_beban_id)")
        .in("id", transaksiIds);
      if (tErr) throw tErr;

      const totalJumlah = (transaksiList as TransaksiKasKecil[]).reduce(
        (s: number, t: TransaksiKasKecil) => s + Number(t.jumlah),
        0
      );

      // 2. Ambil setting akun
      const { data: setting } = await (supabase as any)
        .from("kas_kecil_setting")
        .select("akun_pengisian_id")
        .limit(1)
        .maybeSingle();

      // 3. Buat record replenishment
      const { data: { user } } = await supabase.auth.getUser();
      const { data: rep, error: repErr } = await (supabase as any)
        .from("replenishment_kas_kecil")
        .insert({
          tanggal,
          jumlah: totalJumlah,
          keterangan: keterangan || "Pengisian ulang kas kecil",
          dibuat_oleh: user?.id,
        })
        .select()
        .single();
      if (repErr) throw repErr;

      // 4. Tandai transaksi sebagai sudah diisi
      const { error: updErr } = await (supabase as any)
        .from("transaksi_kas_kecil")
        .update({ replenishment_id: rep.id })
        .in("id", transaksiIds);
      if (updErr) throw updErr;

      // 5. Buat jurnal otomatis jika akun tersedia
      const akunPengisianId = setting?.akun_pengisian_id;
      if (akunPengisianId && totalJumlah > 0) {
        try {
          const tahun = new Date(tanggal).getFullYear();
          const { data: nomorJurnal } = await supabase.rpc("generate_nomor_jurnal", {
            p_prefix: "JKK",
            p_tahun: tahun,
          });

          if (nomorJurnal) {
            const { data: jurnal, error: jErr } = await (supabase as any)
              .from("jurnal")
              .insert({
                nomor: nomorJurnal,
                tanggal,
                keterangan: `Pengisian Ulang Kas Kecil${keterangan ? " - " + keterangan : ""}`,
                referensi: rep.id,
                total_debit: totalJumlah,
                total_kredit: totalJumlah,
                status: "posted",
              })
              .select()
              .single();

            if (!jErr && jurnal) {
              // Buat detail: kredit akun pengisian
              const details: any[] = [
                {
                  jurnal_id: jurnal.id,
                  akun_id: akunPengisianId,
                  keterangan: "Pengisian kas kecil",
                  debit: 0,
                  kredit: totalJumlah,
                  urutan: 999,
                },
              ];

              // Debit per beban (agregasi per akun_beban)
              const bebanMap: Record<string, { nama: string; total: number; urutan: number }> = {};
              let urutan = 1;
              for (const t of transaksiList as TransaksiKasKecil[]) {
                const akunId = t.jenis_pengeluaran?.akun_beban_id;
                if (akunId) {
                  if (!bebanMap[akunId]) {
                    bebanMap[akunId] = { nama: t.jenis_pengeluaran?.nama || "Beban", total: 0, urutan: urutan++ };
                  }
                  bebanMap[akunId].total += Number(t.jumlah);
                }
              }

              // Jika ada transaksi tanpa akun beban, gunakan akun pengisian sebagai fallback debit
              const totalTanpaAkun = (transaksiList as TransaksiKasKecil[])
                .filter((t: TransaksiKasKecil) => !t.jenis_pengeluaran?.akun_beban_id)
                .reduce((s: number, t: TransaksiKasKecil) => s + Number(t.jumlah), 0);

              for (const [akunId, info] of Object.entries(bebanMap)) {
                details.push({
                  jurnal_id: jurnal.id,
                  akun_id: akunId,
                  keterangan: `Beban ${info.nama} (kas kecil)`,
                  debit: info.total,
                  kredit: 0,
                  urutan: info.urutan,
                });
              }

              if (totalTanpaAkun > 0) {
                details.push({
                  jurnal_id: jurnal.id,
                  akun_id: akunPengisianId,
                  keterangan: "Beban kas kecil (tanpa kategori)",
                  debit: totalTanpaAkun,
                  kredit: 0,
                  urutan: urutan,
                });
              }

              await (supabase as any).from("jurnal_detail").insert(details);

              // Link jurnal ke replenishment
              await (supabase as any)
                .from("replenishment_kas_kecil")
                .update({ jurnal_id: jurnal.id })
                .eq("id", rep.id);
            }
          }
        } catch (jurnalErr: any) {
          console.error("Auto-jurnal pengisian gagal:", jurnalErr);
          toast.warning("Pengisian berhasil, tapi jurnal otomatis gagal dibuat.");
        }
      }

      return rep;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transaksi_kas_kecil"] });
      qc.invalidateQueries({ queryKey: ["replenishment_kas_kecil"] });
      toast.success("Kas kecil berhasil diisi ulang");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ── Computed: saldo saat ini ───────────────────────────────────────────────────

export function useSaldoKasKecil() {
  return useQuery({
    queryKey: ["saldo_kas_kecil"],
    queryFn: async () => {
      const [{ data: setting }, { data: pending }] = await Promise.all([
        (supabase as any).from("kas_kecil_setting").select("dana_imprest").limit(1).maybeSingle(),
        (supabase as any)
          .from("transaksi_kas_kecil")
          .select("jumlah")
          .is("replenishment_id", null),
      ]);
      const imprest = Number(setting?.dana_imprest || 0);
      const totalPending = ((pending as any[]) || []).reduce(
        (s: number, t: any) => s + Number(t.jumlah),
        0
      );
      return { imprest, pending: totalPending, saldo: imprest - totalPending };
    },
  });
}
