-- Konfigurasi eksplisit pembayaran PMB per lembaga.
-- Satu lembaga menunjuk satu jenis pembayaran pendaftaran yang dipakai
-- baik oleh checkout publik /pmb maupun input pembayaran PMB manual.

CREATE TABLE IF NOT EXISTS public.konfigurasi_pmb (
  departemen_id uuid PRIMARY KEY REFERENCES public.departemen(id) ON DELETE CASCADE,
  jenis_pembayaran_id uuid NOT NULL REFERENCES public.jenis_pembayaran(id) ON DELETE RESTRICT,
  pembayaran_online_aktif boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_konfigurasi_pmb_jenis
  ON public.konfigurasi_pmb(jenis_pembayaran_id);

ALTER TABLE public.konfigurasi_pmb ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth read konfigurasi_pmb" ON public.konfigurasi_pmb;
CREATE POLICY "Auth read konfigurasi_pmb" ON public.konfigurasi_pmb
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin keuangan manage konfigurasi_pmb" ON public.konfigurasi_pmb;
CREATE POLICY "Admin keuangan manage konfigurasi_pmb" ON public.konfigurasi_pmb
  FOR ALL TO authenticated
  USING (public.is_admin_or_kepala(auth.uid()) OR public.has_role(auth.uid(), 'keuangan'))
  WITH CHECK (public.is_admin_or_kepala(auth.uid()) OR public.has_role(auth.uid(), 'keuangan'));

COMMENT ON TABLE public.konfigurasi_pmb IS
  'Pemetaan jenis pembayaran pendaftaran PMB yang digunakan per lembaga.';
