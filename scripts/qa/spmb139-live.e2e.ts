import {describe,it,expect,vi} from 'vitest';
vi.mock('@tanstack/react-start',()=>({
 createServerFn:()=>{const q={middleware:()=>q,inputValidator:()=>q,handler:(fn:any)=>fn};return q;},
 createMiddleware:()=>{const q={client:()=>q,server:()=>q};return q;}
}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
vi.mock('@/server/supabase',async()=>{
 const {service}=await import('./spmb139-common.mjs');
 return {createAdminClient:()=>service,readEnv:()=>undefined};
});
import {getSpmbBillingCandidates} from '@/server/spmbBilling';
import {cariSiswaPembayaran,prosesPembayaran} from '@/server/pembayaran';
import {rekapTunggakan,rekapTunggakanBatch} from '@/server/tunggakan';
import {getSpmbPaymentMonitor} from '@/server/spmbPaymentMonitor';
import {service,admin,parent,outsider,cashier,ok,f,c,type,subject} from './spmb139-common.mjs';
const ctx=(role='admin')=>({userId:c.ids[role],userEmail:'qa139-'+role+'@example.invalid'});
const invoke=(fn:any,data:any,role='admin')=>fn({data,context:ctx(role)});
const fee=type('UANG PANGKAL SMP'),spp=type('SPP SMP');
const bill=async(name:string,kind=fee)=>(await ok(service.from('tagihan').select('*').eq('siswa_id',subject(name).id).eq('jenis_id',kind.id),'bill'))[0];
const pay=(b:any,amount:number,date='2026-10-09',role='admin')=>invoke(prosesPembayaran,{
 siswa_id:b.siswa_id,jenis_id:b.jenis_id,bulan:0,jumlah:amount,tanggal_bayar:date,
 departemen_id:f.oldDept,tahun_ajaran_id:b.tahun_ajaran_id,is_bayar_dimuka:false,tagihan_id:b.id,keterangan:'QA139 staging transaksi'},role);
async function journal(payment:any,credit:string,book:string){
 const j=await ok(service.from('jurnal').select('*').eq('id',payment.jurnal_id).single(),'journal');
 expect(j.departemen_id).toBe(f.dept);
 const lines=await ok(service.from('jurnal_detail').select('akun_id,debit,kredit').eq('jurnal_id',j.id),'journal lines');
 expect(lines.reduce((a:number,x:any)=>a+Number(x.debit),0)).toBe(Number(payment.jumlah));
 expect(lines.reduce((a:number,x:any)=>a+Number(x.kredit),0)).toBe(Number(payment.jumlah));
 expect(lines.find((x:any)=>Number(x.kredit)>0).akun_id).toBe(credit);
 const p=await ok(service.from('pembayaran').select('*').eq('id',payment.pembayaran_id).single(),'payment');
 expect(p.tahun_ajaran_id).toBe(book);expect(p.departemen_id).toBe(f.dept);
 return p;
}
describe('QA139 staging database and actual server handlers',()=>{
 it('cashier finds accepted students with bills and parent cannot invoke staff handlers',async()=>{
 const candidates=await invoke(getSpmbBillingCandidates,undefined);
 for(const x of f.subjects){expect(candidates.items.find((r:any)=>r.id===x.id)).toMatchObject({ready_for_billing:true,ready_for_spp:false,kelas_id:null});}
 const found=await invoke(cariSiswaPembayaran,{search:'Qa139 External',status:'aktif',include_calon_lulus_with_open_bills:true},'cashier');
 expect(found.items.map((x:any)=>x.id)).toContain(subject('external').id);
 await expect(invoke(cariSiswaPembayaran,{search:'QA139'},'parent')).rejects.toThrow('Forbidden');
 const future=await invoke(rekapTunggakanBatch,{jenis_id:fee.id,tahun_ajaran_id:f.book27,tanpa_kelas:true,per_tanggal:'2026-10-09'});
 expect(future.rows).toHaveLength(0);
 const current=await invoke(rekapTunggakanBatch,{jenis_id:fee.id,tahun_ajaran_id:f.book26,tanpa_kelas:true,per_tanggal:'2026-10-09'});
 expect(current.rows.filter((x:any)=>f.subjects.some((s:any)=>s.id===x.siswa_id))).toHaveLength(2);
 for(const x of current.rows)expect(x.kelas).toBe('Belum ditempatkan');
 const monitor=await invoke(getSpmbPaymentMonitor,undefined,'cashier');
 expect(monitor.historyAvailable).toBe(true);
 for(const x of f.subjects)expect(monitor.items.find((r:any)=>r.siswa_id===x.id).progress.total).toBe(4200000);
 });
 it('scheduled installment is recorded in receipt/book 2026 with liability in target SMP',async()=>{
 const b=await bill('external');
 const r=await pay(b,1000000,'2027-01-11','cashier');
 expect(r.jumlah).toBe(1000000);expect(r.sisa_tagihan).toBe(3200000);expect(r.receipt_id).toBeTruthy();
 const p=await journal(r,fee.akun_dimuka_id,f.book26);
 expect(p.tanggal_bayar).toBe('2026-10-09');
 const deferred=await ok(service.from('pendapatan_dimuka').select('*').eq('pembayaran_id',p.id).single(),'deferred');
 expect(deferred.tahun_ajaran_pembayaran_id).toBe(f.book26);
 expect(deferred.tahun_ajaran_target_id).toBe(f.book27);
 expect(deferred.status).toBe('pending');expect(deferred.jurnal_pengakuan_id).toBeNull();
 const portal=await ok(parent.from('v_tagihan_belum_bayar').select('*').eq('siswa_id',b.siswa_id).eq('sudah_bayar',false),'parent outstanding');
 expect(portal[0].nominal).toBe(3200000);expect(portal[0].departemen_id).toBe(f.dept);expect(portal[0].kelas_nama).toBeNull();
 const progress=(await invoke(getSpmbPaymentMonitor,undefined)).items.find((x:any)=>x.siswa_id===b.siswa_id).progress;
 expect(progress.paid).toBe(1000000);expect(progress.remaining).toBe(3200000);
 const late=await invoke(rekapTunggakanBatch,{jenis_id:fee.id,tahun_ajaran_id:f.book27,tanpa_kelas:true,per_tanggal:'2027-07-02'});
 expect(late.rows.find((x:any)=>x.siswa_id===b.siswa_id).total).toBe(3200000);
 });
 it('concurrent final payment across book years produces one payment and journal only',async()=>{
 const b=await bill('external');
 const results=await Promise.allSettled([pay(b,3200000,'2027-01-11'),pay(b,3200000,'2027-01-11')]);
 expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
 const success=(results.find(x=>x.status==='fulfilled') as any).value;
 await journal(success,fee.akun_dimuka_id,f.book27);
 const payments=await ok(service.from('pembayaran').select('id,jumlah').eq('tagihan_id',b.id),'pay count');
 expect(payments).toHaveLength(2);expect(payments.reduce((a:number,x:any)=>a+Number(x.jumlah),0)).toBe(4200000);
 expect((await bill('external')).status).toBe('lunas');
 await expect(pay(b,4200000)).rejects.toThrow(/lunas/);
 });
 it('internal student can pay future target invoice while origin remains SD',async()=>{
 const b=await bill('internal'),r=await pay(b,4200000,'2026-10-09','cashier');
 await journal(r,fee.akun_dimuka_id,f.book26);
 const s=await ok(service.from('siswa').select('departemen_id').eq('id',b.siswa_id).single(),'origin');
 expect(s.departemen_id).toBe(f.oldDept);
 const ks=await ok(service.from('kelas_siswa').select('kelas_id').eq('siswa_id',b.siswa_id).eq('aktif',true),'origin class');
 expect(ks[0].kelas_id).toBe(f.oldClass);
 });
 it('current-year installment settles receivable and report follows remaining invoice',async()=>{
 const b=await bill('externalCurrent'),r=await pay(b,500000,'2026-10-09','cashier');
 const piutang=(await import('./spmb139-common.mjs')).ref.settings.find((x:any)=>x.kode_setting==='piutang_siswa').akun_id;
 await journal(r,piutang,f.book26);
 const report=await invoke(rekapTunggakan,{siswa_id:b.siswa_id,tahun_ajaran_id:f.book26,sertakan_belum_jatuh_tempo:true,per_tanggal:'2026-10-09'});
 expect(report.total).toBe(3700000);expect(report.tunggakan[0].terbayar).toBe(500000);
 });
 it('class placement, academic activation and monthly SPP leave initial invoices intact',async()=>{
 const ext=subject('externalCurrent'),internal=subject('internalCurrent');
 await ok(admin.from('kelas_siswa').insert({siswa_id:ext.id,kelas_id:f.targetClass,tahun_ajaran_id:f.academic26,aktif:true}),'external placement');
 await ok(admin.from('siswa').update({status:'aktif'}).eq('id',ext.id),'external activation');
 await ok(admin.rpc('spmb_activate_internal_student',{p_siswa_id:internal.id,p_kelas_id:f.targetClass,p_tahun_ajaran_id:f.academic26}),'internal activation');
 const candidates=await invoke(getSpmbBillingCandidates,undefined);
 for(const x of [ext,internal]){
 expect(candidates.items.find((r:any)=>r.id===x.id)).toMatchObject({ready_for_spp:true,kelas_id:f.targetClass});
 const tariff=[f.book26,f.book27].map(year=>({jenis_id:spp.id,siswa_id:x.id,kelas_id:null,angkatan_id:null,tahun_ajaran_id:year,nominal:450000,keterangan:'QA139 SPP'}));
 const r=await ok(admin.rpc('simpan_tarif_generate_dan_rencana_fleksibel_atomik',{
 p_tarif_rows:tariff,p_tahun_akademik_id:f.academic26,p_jenis_id:spp.id,
 p_generate_groups:[{tahun_buku_id:f.book26,bulan_list:[10,11,12]},{tahun_buku_id:f.book27,bulan_list:[1,2,3,4,5,6]}],
 p_departemen_id:f.dept,p_siswa_ids:null,p_siswa_id:x.id,p_kelas_id:f.targetClass,p_angkatan_id:null,
 p_mode_akhir:'akhir_jenjang',p_rencana_mulai:'2026-10-01',p_rencana_selesai:null
 }),'SPP and plan');
 expect(r.generated).toBe(9);expect(r.rencana.rencana_id).toBeTruthy();
 const bills=await ok(service.from('tagihan').select('id,jenis_id,kelas_id,tanggal_pengakuan').eq('siswa_id',x.id),'post activation bills');
 expect(bills.filter((b:any)=>b.jenis_id===fee.id)).toHaveLength(1);
 expect(bills.filter((b:any)=>b.jenis_id===spp.id)).toHaveLength(9);
 expect(bills.filter((b:any)=>b.jenis_id===spp.id).every((b:any)=>b.kelas_id===f.targetClass)).toBe(true);
 }
 const detail=await ok(service.from('siswa_detail').select('spmb_tanggal_aktivasi,spmb_status_pendaftaran').eq('siswa_id',internal.id).single(),'internal final');
 expect(detail.spmb_status_pendaftaran).toBe('selesai');expect(detail.spmb_tanggal_aktivasi).toBeTruthy();
 const origin=await ok(service.from('kelas_siswa').select('aktif').eq('siswa_id',internal.id).eq('kelas_id',f.oldClass).single(),'old class archived');
 expect(origin.aktif).toBe(false);
 await expect(ok(admin.rpc('spmb_activate_internal_student',{p_siswa_id:internal.id,p_kelas_id:f.targetClass,p_tahun_ajaran_id:f.academic26}),'duplicate activation')).rejects.toThrow();
 });
});
