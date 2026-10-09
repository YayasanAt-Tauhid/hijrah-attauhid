import {describe,it,expect,vi,beforeAll,afterAll} from 'vitest';
vi.mock('@tanstack/react-start',()=>({
 createServerFn:()=>{const q={middleware:()=>q,inputValidator:()=>q,handler:(fn:any)=>fn};return q;},
 createMiddleware:()=>{const q={client:()=>q,server:()=>q};return q;}
}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
vi.mock('@/server/supabase',async()=>{
 const {service}=await import('./spmb139-common.mjs');
 return {createAdminClient:()=>service,readEnv:(name:string)=>name==='MIDTRANS_SERVER_KEY'?'SB-qa139-simulated':undefined};
});
vi.mock('@/server/push',()=>({kirimPushKeOrtu:async()=>{}}));
import {buatTransaksiSnap} from '@/server/payment';
import {handleNotification} from '@/server/midtransNotification';
import {prosesPembayaran} from '@/server/pembayaran';
import {getSpmbPaymentMonitor,saveSpmbMonitorEvent} from '@/server/spmbPaymentMonitor';
import {service,admin,parent,ok,f,c,ref,type,subject,readFixture} from './spmb139-common.mjs';
const online=readFixture('spmb139-online-fixture.json');
const fee=type('UANG PANGKAL SMP');
const realFetch=globalThis.fetch;
let gatewayRequests:any[]=[];
beforeAll(()=>{globalThis.fetch=async(u:any,o:any)=>{
 const url=String(u);
 if(url.startsWith('https://app.sandbox.midtrans.com/snap/v1/transactions')){
  const body=JSON.parse(o.body);gatewayRequests.push(body);
  return Response.json({token:'qa139-simulated-'+gatewayRequests.length,redirect_url:'https://app.sandbox.midtrans.com/snap/v2/vtweb/qa139'});
 }
 if(url.startsWith('https://api.sandbox.midtrans.com/v2/')){
  return Response.json({status_code:'200',transaction_status:'pending',gross_amount:'1050000.00',order_id:url.split('/').at(-2)});
 }
 if(url.includes('midtrans.com'))throw new Error('Unexpected external gateway request blocked');
 return realFetch(u,o);
};});
afterAll(()=>{globalThis.fetch=realFetch;});
const input=(amount:number)=>({
 items:[{tagihan_id:online.bill.id,siswa_id:online.id,nama_siswa:'QA139 Online',jenis_id:fee.id,
 jenis_nama:'NAMA DARI KLIEN',bulan:0,jumlah:amount,departemen_id:f.oldDept,tahun_ajaran_id:f.book27}],
 customer:{user_id:c.ids.outsider,email:'qa139-parent@example.invalid',nama:'QA139 Parent'}
});
const checkout=(amount:number,user=c.ids.parent)=>buatTransaksiSnap({
 userId:user,input:input(amount),callbacks:()=>({finish:'https://qa139.invalid/finish',unfinish:'https://qa139.invalid/return',error:'https://qa139.invalid/error'})
});
async function notification(order:string,amount:number,valid=true){
 const gross=amount.toFixed(2),code='200';
 const bytes=new TextEncoder().encode(order+code+gross+'SB-qa139-simulated');
 const digest=await crypto.subtle.digest('SHA-512',bytes);
 const signature=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
 return handleNotification(new Request('https://qa139.invalid/api/midtrans-notification',{
 method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
 order_id:order,status_code:code,gross_amount:gross,transaction_status:'settlement',payment_type:'bank_transfer',
 transaction_id:'qa139-gateway-'+order,signature_key:valid?signature:'invalid-signature'
 })}));
}
const context={userId:c.ids.admin,userEmail:'qa139-admin@example.invalid'};
describe('QA139 online bookkeeping with simulated Midtrans and real staging DB',()=>{
 it('administrative monitor has 14-day deadline while official invoice is due in 2027',async()=>{
 const monitor=await (getSpmbPaymentMonitor as any)({context});
 const row=monitor.items.find((x:any)=>x.siswa_id===online.id);
 await (saveSpmbMonitorEvent as any)({context,data:{
 detail_id:row.id,tahun_ajaran_id:row.tahun_ajaran_id,departemen_id:row.departemen_id,
 gelombang_id:row.registration.spmb_gelombang_id,registered_at:row.registration.spmb_registered_at,
 jenis:'skema',skema:'cicilan',tahap:null,tenggat:null,catatan:'QA139 skema cicilan pengujian staging'
 }});
 const updated=(await (getSpmbPaymentMonitor as any)({context})).items.find((x:any)=>x.siswa_id===online.id);
 expect(updated.progress.due).toBe('2026-10-22');expect(updated.progress.total).toBe(4200000);
 expect(online.bill.jatuh_tempo).toBe('2027-07-01');
 });
 it('parent checkout uses canonical fee and target department; signed webhook books installment once',async()=>{
 await expect(checkout(1050000,c.ids.outsider)).rejects.toThrow(/bukan anak Anda/);
 const tx=await checkout(1050000);
 expect(tx.total_amount).toBe(1050000);expect(gatewayRequests).toHaveLength(1);
 expect(gatewayRequests[0].item_details[0].name).toContain('UANG PANGKAL SMP');
 const stored=await ok(service.from('transaksi_midtrans_item').select('*').eq('transaksi_id',tx.transaksi_id),'stored items');
 expect(stored[0].departemen_id).toBe(f.dept);
 expect((await notification(tx.order_id,1050000,false)).status).toBe(403);
 const response=await notification(tx.order_id,1050000);expect(response.status,await response.text()).toBe(200);
 expect((await notification(tx.order_id,1050000)).status).toBe(200);
 const payments=await ok(service.from('pembayaran').select('*').eq('tagihan_id',online.bill.id),'online payments');
 expect(payments).toHaveLength(1);
 const p=payments[0];expect(p.departemen_id).toBe(f.dept);expect(p.tahun_ajaran_id).toBe(f.book26);
 const lines=await ok(service.from('jurnal_detail').select('*').eq('jurnal_id',p.jurnal_id),'online journal');
 expect(lines.find((x:any)=>Number(x.debit)>0).akun_id).toBe(ref.settings.find((x:any)=>x.kode_setting==='bank_midtrans').akun_id);
 expect(lines.find((x:any)=>Number(x.kredit)>0).akun_id).toBe(fee.akun_dimuka_id);
 expect(lines.reduce((n:number,x:any)=>n+Number(x.debit)-Number(x.kredit),0)).toBe(0);
 const deferred=await ok(service.from('pendapatan_dimuka').select('*').eq('pembayaran_id',p.id).single(),'online liability');
 expect(deferred.tahun_ajaran_target_id).toBe(f.book27);expect(deferred.status).toBe('pending');
 const visible=await ok(parent.from('v_tagihan_belum_bayar').select('*').eq('tagihan_id',online.bill.id),'portal remaining');
 expect(visible[0].nominal).toBe(3150000);expect(visible[0].kelas_nama).toBeNull();expect(visible[0].departemen_id).toBe(f.dept);
 const progress=(await (getSpmbPaymentMonitor as any)({context})).items.find((x:any)=>x.siswa_id===online.id).progress;
 expect(progress.paid).toBe(1050000);expect(progress.remaining).toBe(3150000);expect(progress.stage).toBe(2);expect(progress.due).toBe('2026-11-08');
 });
 it('second online installment settles invoice; retry cannot duplicate payment or receipt',async()=>{
 const tx=await checkout(3150000);
 const r=await notification(tx.order_id,3150000);expect(r.status,await r.text()).toBe(200);
 expect((await notification(tx.order_id,3150000)).status).toBe(200);
 const payments=await ok(service.from('pembayaran').select('*').eq('tagihan_id',online.bill.id),'settled payments');
 expect(payments).toHaveLength(2);expect(payments.reduce((n:number,x:any)=>n+Number(x.jumlah),0)).toBe(4200000);
 const bill=await ok(service.from('tagihan').select('*').eq('id',online.bill.id).single(),'settled bill');expect(bill.status).toBe('lunas');
 await expect(checkout(4200000)).rejects.toThrow(/Tagihan aktif tidak ditemukan/);
 });
 it('monthly SPP installment after activation settles receivable without duplicating initial fee',async()=>{
 const x=subject('externalCurrent'),spp=type('SPP SMP');
 const b=await ok(service.from('tagihan').select('*').eq('siswa_id',x.id).eq('jenis_id',spp.id).eq('bulan',10).single(),'October SPP');
 const pay=(amount:number)=>(prosesPembayaran as any)({context,data:{siswa_id:x.id,jenis_id:spp.id,bulan:10,jumlah:amount,
 tanggal_bayar:'2026-10-09',tahun_ajaran_id:f.book26,is_bayar_dimuka:false,tagihan_id:b.id}});
 const first=await pay(100000);expect(first.sisa_tagihan).toBe(350000);
 const second=await pay(350000);expect(second.sisa_tagihan).toBe(0);
 await expect(pay(450000)).rejects.toThrow(/lunas/);
 const lines=await ok(service.from('jurnal_detail').select('*').eq('jurnal_id',first.jurnal_id),'SPP payment journal');
 expect(lines.find((l:any)=>Number(l.kredit)>0).akun_id).toBe(ref.settings.find((l:any)=>l.kode_setting==='piutang_siswa').akun_id);
 const fees=await ok(service.from('tagihan').select('id').eq('siswa_id',x.id).eq('jenis_id',fee.id),'initial fee preserved');expect(fees).toHaveLength(1);
 });
});
