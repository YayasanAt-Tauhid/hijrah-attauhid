INSERT INTO public.pengaturan_akun (kode_setting, label, keterangan)
VALUES (
  'kas_bank_transfer',
  'Akun Bank Transfer Kasir',
  'Akun yang di-debit saat kasir menerima pembayaran dengan metode transfer'
)
ON CONFLICT (kode_setting) DO NOTHING;
