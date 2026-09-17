import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib tersedia");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchAll(table, select, configure = (query) => query) {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await configure(
      supabase.from(table).select(select).range(from, from + pageSize - 1)
    );
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

const [configs, students] = await Promise.all([
  fetchAll("konfigurasi_pmb", "departemen_id, jenis_pembayaran_id"),
  fetchAll("siswa", "id, departemen_id", (query) => query.eq("status", "calon")),
]);

if (!students.length) {
  console.log("Tidak ada calon murid yang perlu diperiksa.");
  process.exit(0);
}

const [details, payments] = await Promise.all([
  fetchAll("siswa_detail", "siswa_id, tahun_ajaran_id"),
  fetchAll(
    "pembayaran",
    "id, siswa_id, jenis_id, tahun_ajaran_id, jurnal_id",
    (query) => query.not("jurnal_id", "is", null)
  ),
]);

const configByDepartment = new Map(
  configs.map((config) => [config.departemen_id, config.jenis_pembayaran_id])
);
const studentById = new Map(students.map((student) => [student.id, student]));
const yearByStudent = new Map(
  details.map((detail) => [detail.siswa_id, detail.tahun_ajaran_id])
);

const mismatches = payments.filter((payment) => {
  const student = studentById.get(payment.siswa_id);
  const registrationYear = yearByStudent.get(payment.siswa_id);
  if (!student || !registrationYear) return false;
  return (
    configByDepartment.get(student.departemen_id) === payment.jenis_id &&
    payment.tahun_ajaran_id !== registrationYear
  );
});

for (const payment of mismatches) {
  const registrationYear = yearByStudent.get(payment.siswa_id);
  const { error } = await supabase
    .from("pembayaran")
    .update({ tahun_ajaran_id: registrationYear })
    .eq("id", payment.id)
    .eq("siswa_id", payment.siswa_id)
    .eq("tahun_ajaran_id", payment.tahun_ajaran_id);
  if (error) throw error;
}

console.log(`Rekonsiliasi tahun ajaran pembayaran SPMB selesai: ${mismatches.length} transaksi diperbaiki.`);
