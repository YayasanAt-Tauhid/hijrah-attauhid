import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Button, Card, Screen, SectionTitle, Subtitle } from "@/components/ui";
import { useTheme } from "@/constants/theme";
import { formatRupiah, labelBulanTA, NAMA_BULAN } from "@/lib/format";
import { clearKeranjang, getKeranjang } from "@/lib/keranjang";
import { supabase } from "@/lib/supabase";

// Di atas nominal ini biaya QRIS cenderung lebih mahal daripada Virtual Account,
// sehingga orang tua diimbau memilih VA. Hanya imbauan; QRIS tetap bisa dipilih.
// Nilai sama dengan portal web (src/pages/portal/PortalCheckout.tsx).
const BATAS_IMBAUAN_VA = 628000;

export default function CheckoutScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);

  // Snapshot sekali saat layar dibuka — keranjang di-clear setelah pembayaran.
  const [keranjang] = useState(getKeranjang);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof keranjang>();
    keranjang.forEach((item) => {
      const list = map.get(item.siswa_id) || [];
      list.push(item);
      map.set(item.siswa_id, list);
    });
    return map;
  }, [keranjang]);

  const totalAmount = keranjang.reduce((sum, i) => sum + i.jumlah, 0);
  const sarankanVA = totalAmount > BATAS_IMBAUAN_VA;

  const selesaiKeCekStatus = () => {
    clearKeranjang();
    // Status akhir ditentukan webhook Midtrans — refresh data lalu arahkan
    // ke Riwayat supaya pengguna melihat status transaksinya.
    queryClient.invalidateQueries({ queryKey: ["portal-tagihan"] });
    queryClient.invalidateQueries({ queryKey: ["portal-tagihan-count"] });
    queryClient.invalidateQueries({ queryKey: ["portal-riwayat"] });
    router.replace("/riwayat");
  };

  const handleBayar = async () => {
    const webUrl = process.env.EXPO_PUBLIC_PORTAL_WEB_URL?.replace(/\/$/, "");
    if (!webUrl) {
      Alert.alert(
        "Belum dikonfigurasi",
        "EXPO_PUBLIC_PORTAL_WEB_URL belum diset. Silakan bayar melalui portal web sekolah."
      );
      return;
    }

    setIsLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        Alert.alert("Sesi habis", "Sesi login habis. Silakan login ulang.");
        return;
      }

      const res = await fetch(`${webUrl}/api/portal/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          items: keranjang.map((item) => ({
            siswa_id: item.siswa_id,
            nama_siswa: item.nama_siswa,
            jenis_id: item.jenis_id,
            jenis_nama: item.jenis_nama,
            bulan: item.bulan,
            jumlah: item.jumlah,
            departemen_id: item.departemen_id,
            departemen_nama: item.departemen_nama,
            tahun_ajaran_id: item.tahun_ajaran_id,
          })),
        }),
      });

      const body = await res.json();
      if (!res.ok || !body.redirect_url) {
        Alert.alert("Gagal membuat transaksi", body.error || "Coba lagi beberapa saat.");
        return;
      }

      // Buka halaman Snap di browser in-app. Pilihan metode dan fee customer
      // ditangani langsung oleh Midtrans. Callback Midtrans mengarah ke deep link
      // portalortu://riwayat sehingga sesi tertutup otomatis saat pembayaran selesai.
      await WebBrowser.openAuthSessionAsync(body.redirect_url, "portalortu://riwayat");
      selesaiKeCekStatus();
    } catch {
      Alert.alert(
        "Gagal terhubung",
        "Tidak bisa menghubungi server pembayaran. Periksa koneksi internet Anda."
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (keranjang.length === 0) {
    return (
      <Screen>
        <Card style={{ gap: 12 }}>
          <Text style={{ color: theme.textSecondary, fontSize: 14 }}>
            Tidak ada tagihan yang dipilih.
          </Text>
          <Button
            title="Kembali ke Tagihan"
            variant="outline"
            onPress={() => router.replace("/tagihan")}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Subtitle>Periksa kembali tagihan Anda, lalu lanjutkan pembayaran</Subtitle>

      <Card style={{ gap: 14 }}>
        <SectionTitle>Detail Tagihan</SectionTitle>
        {Array.from(grouped.entries()).map(([siswaId, items]) => {
          const first = items[0];
          const subtotal = items.reduce((s, i) => s + i.jumlah, 0);
          return (
            <View key={siswaId} style={{ gap: 6 }}>
              <Text style={{ color: theme.text, fontWeight: "600", fontSize: 14 }}>
                {first.nama_siswa}
                {first.kelas_nama ? (
                  <Text style={{ color: theme.textSecondary, fontWeight: "400" }}>
                    {"  "}({first.departemen_nama} — {first.kelas_nama})
                  </Text>
                ) : null}
              </Text>
              {items.map((item, idx) => (
                <View
                  key={idx}
                  style={[styles.itemRow, { borderTopColor: theme.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontSize: 13 }}>{item.jenis_nama}</Text>
                    <Text style={{ color: theme.textSecondary, fontSize: 11 }}>
                      {item.bulan === 0
                        ? `Sekali Bayar${item.tahun_ajaran_nama ? ` — TA ${item.tahun_ajaran_nama}` : ""}`
                        : item.tahun_ajaran_mulai
                          ? labelBulanTA(item.bulan, item.tahun_ajaran_mulai)
                          : NAMA_BULAN[item.bulan] || "-"}
                    </Text>
                  </View>
                  <Text style={{ color: theme.text, fontSize: 13, fontWeight: "500" }}>
                    {formatRupiah(item.jumlah)}
                  </Text>
                </View>
              ))}
              <View style={[styles.subtotalRow, { borderTopColor: theme.border }]}>
                <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                  Subtotal {first.nama_siswa}
                </Text>
                <Text style={{ color: theme.text, fontWeight: "600", fontSize: 12 }}>
                  {formatRupiah(subtotal)}
                </Text>
              </View>
            </View>
          );
        })}

        <View style={[styles.totalRow, styles.grandTotal, { borderTopColor: theme.border }]}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700" }}>
            TOTAL TAGIHAN
          </Text>
          <Text style={{ color: theme.primary, fontSize: 17, fontWeight: "700" }}>
            {formatRupiah(totalAmount)}
          </Text>
        </View>
      </Card>

      <Card style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <Ionicons name="shield-checkmark-outline" size={22} color={theme.primary} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600" }}>
            Pembayaran via Midtrans
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
            Pilih metode pembayaran di halaman Midtrans. Biaya layanan, bila berlaku,
            dihitung dan ditampilkan langsung oleh Midtrans sesuai metode yang dipilih.
            Aplikasi tidak menambahkan biaya admin ke total tagihan.
          </Text>
        </View>
      </Card>

      {sarankanVA ? (
        <Card
          style={{
            flexDirection: "row",
            gap: 12,
            alignItems: "flex-start",
            backgroundColor: theme.amberSoft,
            borderColor: theme.amber,
          }}
        >
          <Ionicons name="information-circle-outline" size={22} color={theme.amber} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: theme.amber, fontSize: 13, fontWeight: "600" }}>
              Saran metode pembayaran
            </Text>
            <Text style={{ color: theme.text, fontSize: 12 }}>
              Untuk pembayaran di atas {formatRupiah(BATAS_IMBAUAN_VA)}, sebaiknya pilih
              Virtual Account (VA) di halaman Midtrans. Biaya layanan QRIS untuk nominal
              sebesar ini cenderung lebih mahal dibandingkan VA.
            </Text>
          </View>
        </Card>
      ) : null}

      <View style={{ gap: 10 }}>
        <Button
          title={isLoading ? "Memproses..." : "Lanjut ke Pembayaran"}
          icon="card-outline"
          loading={isLoading}
          onPress={handleBayar}
        />
        <Button
          title="Ubah Pilihan"
          variant="outline"
          icon="arrow-back-outline"
          disabled={isLoading}
          onPress={() => router.back()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  subtotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
    borderTopWidth: 1,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  grandTotal: {
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 2,
  },
});
