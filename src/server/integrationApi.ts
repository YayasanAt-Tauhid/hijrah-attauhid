import { createAdminClient } from './supabase'

const SCOPES = ['pendaftaran:read','pendaftaran:identity:read','pendaftaran:contact:read','pendaftaran:sensitive:read','pendaftaran:documents:read','siswa:read','kelas:read','pegawai:read','pegawai:contact:read','pegawai:write','pendaftaran:milestone:update'] as const
type Scope=(typeof SCOPES)[number]
type Ctx={integration:any;token:any;admin:any;requestId:string;started:number;tokenHash:string}
const MAX_PAGE=200, DEFAULT_PAGE=100

const enc=new TextEncoder()
function b64url(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function b64json(v:unknown){return b64url(enc.encode(JSON.stringify(v)))}
function unb64json(v:string){try{const p=v.replace(/-/g,'+').replace(/_/g,'/');const raw=atob(p+'='.repeat((4-p.length%4)%4));const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));return JSON.parse(new TextDecoder().decode(bytes))}catch{return null}}
async function sha256(s:string){const d=await crypto.subtle.digest('SHA-256',enc.encode(s));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function hmac(keyHex:string,s:string){const key=Uint8Array.from(keyHex.match(/.{2}/g)!.map(x=>parseInt(x,16)));const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64url(new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(s))))}
function json(body:unknown,status=200,headers:Record<string,string>={}){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...headers}})}
function err(code:string,message:string,status:number,requestId:string,extra:Record<string,unknown>={},headers:Record<string,string>={}){return json({error:{code,message,request_id:requestId,...extra}},status,headers)}
function has(ctx:Ctx,s:Scope){return (ctx.integration.scopes||[]).includes(s)}
export function allowed(ctx:Ctx,dept?:string|null,year?:string|null){const ds:string[]=ctx.integration.department_ids||[],ys:string[]=ctx.integration.academic_year_ids||[];return (!ds.length||!!dept&&ds.includes(dept))&&(!ys.length||!!year&&ys.includes(year))}
export function uuid(v:string|null){return !!v&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)}
function page(url:URL){const n=Number(url.searchParams.get('limit')||DEFAULT_PAGE);if(!Number.isInteger(n)||n<1||n>MAX_PAGE)throw new Error('LIMIT');return n}
function scopeFingerprint(ctx:Ctx){return JSON.stringify({s:[...(ctx.integration.scopes||[])].sort(),d:[...(ctx.integration.department_ids||[])].sort(),y:[...(ctx.integration.academic_year_ids||[])].sort()})}
function filterFingerprint(u:URL){return JSON.stringify([...u.searchParams.entries()].filter(([k])=>k!=='cursor'&&k!=='limit'&&k!=='checkpoint').sort())}
async function readCursor(v:string|null,kind:string,ctx:Ctx,filters:string){if(!v)return null;const [payload,sig]=v.split('.');if(!payload||!sig||await hmac(ctx.tokenHash,payload)!==sig)throw new Error('CURSOR');const x=unb64json(payload);if(!x||x.v!==2||x.kind!==kind||x.i!==ctx.integration.id||x.scope!==scopeFingerprint(ctx)||x.filters!==filters)throw new Error('CURSOR');return x}
async function nextCursor(kind:string,ctx:Ctx,filters:string,p:Record<string,unknown>){const payload=b64json({v:2,kind,i:ctx.integration.id,scope:scopeFingerprint(ctx),filters,...p});return `${payload}.${await hmac(ctx.tokenHash,payload)}`}

async function rate(admin:any,bucket:string,limit:number,seconds:number){const {data}=await (admin.rpc as any)('integration_rate_limit_hit',{p_bucket:bucket,p_limit:limit,p_window_seconds:seconds});return data?.[0]||{allowed:true,remaining:0,retry_after:seconds}}
export async function authenticateIntegration(request:Request):Promise<Ctx|Response>{
 const requestId=crypto.randomUUID(),started=Date.now(),admin=createAdminClient();const raw=request.headers.get('authorization'),token=raw?.replace(/^Bearer\s+/i,'').trim()
 if(!token){const r=await rate(admin,'invalid:missing',20,60);return r.allowed?err('unauthorized','Bearer token diperlukan',401,requestId):err('rate_limited','Terlalu banyak percobaan autentikasi',429,requestId,{retry_after:r.retry_after},{'Retry-After':String(r.retry_after)})}
 const prefix=token.slice(0,12),tokenHash=await sha256(token);const {data:t}=await (admin.from('integration_tokens') as any).select('id,integration_id,token_prefix,expires_at,revoked_at').eq('token_hash',tokenHash).maybeSingle()
 if(!t){const r=await rate(admin,`invalid:${prefix}`,20,60);return r.allowed?err('unauthorized','Token integrasi tidak valid',401,requestId):err('rate_limited','Terlalu banyak percobaan autentikasi',429,requestId,{retry_after:r.retry_after},{'Retry-After':String(r.retry_after)})}
 const {data:i}=await (admin.from('integration_apps') as any).select('id,name,active,scopes,department_ids,academic_year_ids,expires_at').eq('id',t.integration_id).maybeSingle();const now=Date.now()
 if(!i||!i.active||t.revoked_at||(t.expires_at&&Date.parse(t.expires_at)<=now)||(i.expires_at&&Date.parse(i.expires_at)<=now))return err('unauthorized','Token kedaluwarsa, dicabut, atau integrasi nonaktif',401,requestId)
 const r=await rate(admin,`integration:${i.id}`,300,60);if(!r.allowed)return err('rate_limited','Batas permintaan terlampaui',429,requestId,{retry_after:r.retry_after},{'Retry-After':String(r.retry_after)})
 await Promise.all([(admin.from('integration_tokens') as any).update({last_used_at:new Date().toISOString()}).eq('id',t.id),(admin.from('integration_apps') as any).update({last_used_at:new Date().toISOString()}).eq('id',i.id)])
 return {integration:i,token:t,admin,requestId,started,tokenHash}
}
export async function done(ctx:Ctx,route:string,response:Response){try{await (ctx.admin.from('integration_api_usage') as any).insert({integration_id:ctx.integration.id,route,request_id:ctx.requestId,status:response.status,duration_ms:Date.now()-ctx.started})}catch{}response.headers.set('X-Request-ID',ctx.requestId);response.headers.set('X-Hijrah-API-Version','1.1');response.headers.set('X-Hijrah-API-Major','1');return response}
export function need(ctx:Ctx,s:Scope){return has(ctx,s)?null:err('forbidden',`Scope ${s} diperlukan`,403,ctx.requestId)}

const BASE='id,nis,nisn,nama,jenis_kelamin,tempat_lahir,tanggal_lahir,agama,alamat,telepon,email,status,angkatan_id,created_at,departemen_id,terverifikasi'
const DETAIL='id,siswa_id,pendaftaran_id,tahun_ajaran_id,jenis_pendaftaran,nik,nik_dapodik,no_kk,kategori,status_asrama,anak_ke,jumlah_bersaudara,tinggi_badan_cm,berat_badan_kg,lingkar_kepala_cm,ukuran_baju,penyakit_pernah_diderita,jarak_rumah_km,waktu_perjalanan_menit,transportasi,nama_ayah,nik_ayah,tempat_lahir_ayah,tanggal_lahir_ayah,pendidikan_ayah,pekerjaan_ayah,penghasilan_ayah,telepon_ayah,alamat_ayah,nama_ibu,nik_ibu,tempat_lahir_ibu,tanggal_lahir_ibu,pendidikan_ibu,pekerjaan_ibu,penghasilan_ibu,telepon_ibu,alamat_ibu,telepon_ortu,alamat_ortu,asal_sekolah,kelas_terakhir,alasan_pindah,alamat_sekolah_asal,kabupaten_sekolah_asal,kecamatan_sekolah_asal,kelurahan_sekolah_asal,kemampuan_iqro,membaca_latin,menulis_latin,hafalan_quran,dokumen_kk_path,dokumen_akta_path,dokumen_rapor_path,dokumen_ijazah_path,spmb_tanggal_tes,spmb_tanggal_lulus,spmb_status_kelulusan,spmb_tanggal_keputusan,spmb_tanggal_daftar_ulang,spmb_departemen_tujuan_id,spmb_angkatan_tujuan_id,spmb_status_pendaftaran,spmb_siswa_internal,spmb_gelombang_id,spmb_gelombang:spmb_gelombang_id(id,nama,gratis_pendaftaran,tanggal_mulai,tanggal_selesai),spmb_verifikasi_status,spmb_verifikasi_at'
async function pathVersion(path:string){return (await sha256(path)).slice(0,24)}
async function docs(pid:string,d:any){const rows=[['kk',d.dokumen_kk_path],['akta',d.dokumen_akta_path],['rapor',d.dokumen_rapor_path],['ijazah',d.dokumen_ijazah_path]].filter(x=>x[1]);return Promise.all(rows.map(async([kind,path])=>({id:`${pid}.${kind}`,jenis:kind,nama_file:String(path).split('/').pop(),mime_type:null,ukuran:null,version:await pathVersion(String(path)),download_path:`/api/v1/documents/${pid}.${kind}`})))}
async function payment(ctx:Ctx,s:any,d:any){const targetDept=d.spmb_departemen_tujuan_id||s.departemen_id;const {data,error}=await (ctx.admin.rpc as any)('integration_registration_payment_status',{p_siswa_id:s.id,p_departemen_id:targetDept,p_created_at:s.created_at});if(error)return {status:'tidak_tersedia',tanggal_bayar:null,jumlah:null,gratis_gelombang_pertama:false};const p=Array.isArray(data)?data[0]:data;return {status:p?.status||'belum_tercatat',tanggal_bayar:p?.tanggal_bayar||null,jumlah:p?.jumlah??null,gratis_gelombang_pertama:!!p?.gratis_gelombang_pertama}}
async function registration(s:any,d:any,ctx:Ctx){
 const targetDept=d.spmb_departemen_tujuan_id||s.departemen_id,targetCohort=d.spmb_angkatan_tujuan_id||s.angkatan_id,registrationStatus=d.spmb_status_pendaftaran||s.status
 const statusTes=d.spmb_tanggal_tes?'sudah_tes':'belum_tes'
 const out:any={id:d.pendaftaran_id,siswa_id:d.spmb_siswa_internal?s.id:(registrationStatus==='calon'?null:s.id),status:registrationStatus,tanggal_pendaftaran:s.created_at,unit:{id:targetDept},tahun_ajaran:{id:d.tahun_ajaran_id},angkatan:{id:targetCohort},identitas:{nama:s.nama,jenis_kelamin:s.jenis_kelamin},jenis_pendaftaran:d.jenis_pendaftaran,kategori:d.kategori,status_asrama:d.status_asrama,gelombang:d.spmb_gelombang?{id:d.spmb_gelombang.id,nama:d.spmb_gelombang.nama,gratis_pendaftaran:!!d.spmb_gelombang.gratis_pendaftaran,tanggal_mulai:d.spmb_gelombang.tanggal_mulai,tanggal_selesai:d.spmb_gelombang.tanggal_selesai}:null,status_tes:statusTes,tanggal_tes:d.spmb_tanggal_tes,status_kelulusan:d.spmb_status_kelulusan,tanggal_kelulusan:d.spmb_tanggal_lulus,tanggal_keputusan:d.spmb_tanggal_keputusan,tanggal_daftar_ulang:d.spmb_tanggal_daftar_ulang,status_verifikasi:d.spmb_verifikasi_status,verifikasi:{status:d.spmb_verifikasi_status,waktu:d.spmb_verifikasi_at},pembayaran_pendaftaran:await payment(ctx,s,d)}
 const legacySensitive=has(ctx,'pendaftaran:sensitive:read'),identity=legacySensitive||has(ctx,'pendaftaran:identity:read'),contact=legacySensitive||has(ctx,'pendaftaran:contact:read')
 if(legacySensitive)out.data_sensitif={nisn:s.nisn,nik:d.nik,no_kk:d.no_kk,tempat_lahir:s.tempat_lahir,tanggal_lahir:s.tanggal_lahir,agama:s.agama,alamat:s.alamat,telepon:s.telepon,email:s.email,anak_ke:d.anak_ke,jumlah_bersaudara:d.jumlah_bersaudara,tinggi_badan_cm:d.tinggi_badan_cm,berat_badan_kg:d.berat_badan_kg,lingkar_kepala_cm:d.lingkar_kepala_cm,ukuran_baju:d.ukuran_baju,penyakit_pernah_diderita:d.penyakit_pernah_diderita,jarak_rumah_km:d.jarak_rumah_km,waktu_perjalanan_menit:d.waktu_perjalanan_menit,transportasi:d.transportasi,orang_tua:{ayah:{nama:d.nama_ayah,nik:d.nik_ayah,tempat_lahir:d.tempat_lahir_ayah,tanggal_lahir:d.tanggal_lahir_ayah,pendidikan:d.pendidikan_ayah,pekerjaan:d.pekerjaan_ayah,penghasilan:d.penghasilan_ayah,telepon:d.telepon_ayah,alamat:d.alamat_ayah},ibu:{nama:d.nama_ibu,nik:d.nik_ibu,tempat_lahir:d.tempat_lahir_ibu,tanggal_lahir:d.tanggal_lahir_ibu,pendidikan:d.pendidikan_ibu,pekerjaan:d.pekerjaan_ibu,penghasilan:d.penghasilan_ibu,telepon:d.telepon_ibu,alamat:d.alamat_ibu},telepon:d.telepon_ortu,alamat:d.alamat_ortu},sekolah_asal:{nama:d.asal_sekolah,kelas_terakhir:d.kelas_terakhir,alasan_pindah:d.alasan_pindah,alamat:d.alamat_sekolah_asal,kabupaten:d.kabupaten_sekolah_asal,kecamatan:d.kecamatan_sekolah_asal,kelurahan:d.kelurahan_sekolah_asal},kemampuan:{iqro:d.kemampuan_iqro,membaca_latin:d.membaca_latin,menulis_latin:d.menulis_latin,hafalan_quran:d.hafalan_quran}}
 else if(identity||contact){
  const sensitive:any={}
  if(identity)Object.assign(sensitive,{nisn:s.nisn,nik:d.nik,no_kk:d.no_kk,tempat_lahir:s.tempat_lahir,tanggal_lahir:s.tanggal_lahir})
  if(contact)Object.assign(sensitive,{alamat:s.alamat,telepon:s.telepon,email:s.email,orang_tua:{ayah:{nama:d.nama_ayah,telepon:d.telepon_ayah,alamat:d.alamat_ayah},ibu:{nama:d.nama_ibu,telepon:d.telepon_ibu,alamat:d.alamat_ibu},telepon:d.telepon_ortu,alamat:d.alamat_ortu}})
  out.data_sensitif=sensitive
 }
 if(has(ctx,'pendaftaran:documents:read'))out.dokumen=await docs(d.pendaftaran_id,d)
 return out
}
async function fetchRegistration(ctx:Ctx,id:string){const {data:d}=await (ctx.admin.from('siswa_detail') as any).select(DETAIL).eq('pendaftaran_id',id).maybeSingle();if(!d)return null;const {data:s}=await ctx.admin.from('siswa').select(BASE).eq('id',d.siswa_id).maybeSingle();if(!s||!allowed(ctx,d.spmb_departemen_tujuan_id||s.departemen_id,d.tahun_ajaran_id))return null;return registration(s,d,ctx)}

export async function handleList(request:Request,type:'pendaftaran'|'siswa'|'kelas'){
 const a=await authenticateIntegration(request);if(a instanceof Response)return a
 const ctx=a,route=`/api/v1/${type}`,req=need(ctx,type==='pendaftaran'?'pendaftaran:read':type==='siswa'?'siswa:read':'kelas:read')
 if(req)return done(ctx,route,req)
 try{
  const u=new URL(request.url),lim=page(u),filters=filterFingerprint(u),c=await readCursor(u.searchParams.get('cursor'),`list:${type}`,ctx,filters),after=c?.after||''
  let items:any[]=[]
  const dept=u.searchParams.get('departemen_id'),year=u.searchParams.get('tahun_ajaran_id')
  if(dept){
   if(!uuid(dept))throw new Error('PARAM')
   if(ctx.integration.department_ids?.length&&!ctx.integration.department_ids.includes(dept))return done(ctx,route,err('filter_out_of_scope','Unit di luar cakupan token',403,ctx.requestId))
  }
  if(year){
   if(!uuid(year))throw new Error('PARAM')
   if(ctx.integration.academic_year_ids?.length&&!ctx.integration.academic_year_ids.includes(year))return done(ctx,route,err('filter_out_of_scope','Tahun ajaran di luar cakupan token',403,ctx.requestId))
  }

  if(type==='pendaftaran'){
   const status=u.searchParams.get('status'),statusTes=u.searchParams.get('status_tes'),statusKelulusan=u.searchParams.get('status_kelulusan'),wave=u.searchParams.get('gelombang_id'),verification=u.searchParams.get('status_verifikasi')
   if(wave&&!uuid(wave))throw new Error('PARAM')
   if(statusTes&&!['sudah_tes','belum_tes'].includes(statusTes))throw new Error('PARAM')
   if(statusKelulusan&&!['lulus','tidak_lulus','belum_diputuskan'].includes(statusKelulusan))throw new Error('PARAM')
   let scanAfter=after
   const batchSize=200
   while(items.length<=lim){
    let q=(ctx.admin.from('siswa_detail') as any).select(DETAIL).not('pendaftaran_id','is',null).order('pendaftaran_id').limit(batchSize)
    if(scanAfter)q=q.gt('pendaftaran_id',scanAfter)
    if(year)q=q.eq('tahun_ajaran_id',year)
    if(wave)q=q.eq('spmb_gelombang_id',wave)
    if(statusTes==='sudah_tes')q=q.not('spmb_tanggal_tes','is',null)
    if(statusTes==='belum_tes')q=q.is('spmb_tanggal_tes',null)
    if(statusKelulusan==='belum_diputuskan')q=q.is('spmb_status_kelulusan',null)
    else if(statusKelulusan)q=q.eq('spmb_status_kelulusan',statusKelulusan)
    if(verification)q=q.eq('spmb_verifikasi_status',verification)
    const {data,error}=await q;if(error)throw error
    const rows=data||[];if(!rows.length)break
    scanAfter=rows.at(-1).pendaftaran_id
    const ids=rows.map((d:any)=>d.siswa_id)
    const {data:ss}=ids.length?await ctx.admin.from('siswa').select(BASE).in('id',ids):{data:[]}
    const sm=new Map((ss||[]).map((x:any)=>[x.id,x]))
    for(const d of rows){
     const student:any=sm.get(d.siswa_id);if(!student)continue
     const targetDept=d.spmb_departemen_tujuan_id||student.departemen_id
     if(!allowed(ctx,targetDept,d.tahun_ajaran_id))continue
     if(dept&&targetDept!==dept)continue
     if(status&&(d.spmb_status_pendaftaran||student.status)!==status)continue
     items.push(await registration(student,d,ctx))
     if(items.length>lim)break
    }
    if(rows.length<batchSize||items.length>lim)break
   }
  }else if(type==='siswa'){
   const status=u.searchParams.get('status'),classId=u.searchParams.get('kelas_id')
   if(classId&&!uuid(classId))throw new Error('PARAM')
   if(classId){
    const {data:k}=await ctx.admin.from('kelas').select('id,departemen_id').eq('id',classId).maybeSingle()
    if(!k){return done(ctx,route,json({data:[],pagination:{limit:lim,has_more:false,next_cursor:null}}))}
    if(ctx.integration.department_ids?.length&&!ctx.integration.department_ids.includes(k.departemen_id))return done(ctx,route,err('filter_out_of_scope','Kelas di luar cakupan unit token',403,ctx.requestId))
    if(dept&&k.departemen_id!==dept)return done(ctx,route,json({data:[],pagination:{limit:lim,has_more:false,next_cursor:null}}))
   }
   let scanAfter=after
   const batchSize=200
   while(items.length<=lim){
    let q=ctx.admin.from('siswa').select(BASE).neq('status','calon').order('id').limit(batchSize)
    if(scanAfter)q=q.gt('id',scanAfter)
    if(dept)q=q.eq('departemen_id',dept)
    if(status)q=q.eq('status',status)
    const {data,error}=await q;if(error)throw error
    const rows=data||[];if(!rows.length)break
    scanAfter=rows.at(-1).id
    const ids=rows.map((x:any)=>x.id)
    const needsMembership=!!year||!!classId||!!ctx.integration.academic_year_ids?.length
    let visibleIds:Set<string>|null=null
    if(needsMembership&&ids.length){
     let rq=(ctx.admin.from('kelas_siswa') as any).select('siswa_id,kelas_id,tahun_ajaran_id').in('siswa_id',ids).eq('aktif',true)
     if(year)rq=rq.eq('tahun_ajaran_id',year)
     else if(ctx.integration.academic_year_ids?.length)rq=rq.in('tahun_ajaran_id',ctx.integration.academic_year_ids)
     if(classId)rq=rq.eq('kelas_id',classId)
     const {data:rels,error:relError}=await rq;if(relError)throw relError
     visibleIds=new Set((rels||[]).map((x:any)=>x.siswa_id))
    }
    for(const student of rows){
     if(ctx.integration.department_ids?.length&&!ctx.integration.department_ids.includes(student.departemen_id))continue
     if(visibleIds&&!visibleIds.has(student.id))continue
     items.push({id:student.id,nis:student.nis,nama:student.nama,jenis_kelamin:student.jenis_kelamin,status:student.status,unit:{id:student.departemen_id},angkatan:{id:student.angkatan_id},terverifikasi:student.terverifikasi,created_at:student.created_at})
     if(items.length>lim)break
    }
    if(rows.length<batchSize||items.length>lim)break
   }
  }else{
   let scanAfter=after
   const batchSize=200
   while(items.length<=lim){
    let q=ctx.admin.from('kelas').select('id,nama,tingkat_id,departemen_id,kapasitas,aktif').order('id').limit(batchSize)
    if(scanAfter)q=q.gt('id',scanAfter)
    if(dept)q=q.eq('departemen_id',dept)
    const {data,error}=await q;if(error)throw error
    const rows=data||[];if(!rows.length)break
    scanAfter=rows.at(-1).id
    const ids=rows.map((x:any)=>x.id)
    const needsMembership=!!year||!!ctx.integration.academic_year_ids?.length
    let visibleIds:Set<string>|null=null
    if(needsMembership&&ids.length){
     let rq=(ctx.admin.from('kelas_siswa') as any).select('kelas_id,tahun_ajaran_id').in('kelas_id',ids).eq('aktif',true)
     if(year)rq=rq.eq('tahun_ajaran_id',year)
     else if(ctx.integration.academic_year_ids?.length)rq=rq.in('tahun_ajaran_id',ctx.integration.academic_year_ids)
     const {data:rels,error:relError}=await rq;if(relError)throw relError
     visibleIds=new Set((rels||[]).map((x:any)=>x.kelas_id))
    }
    for(const k of rows){
     if(ctx.integration.department_ids?.length&&!ctx.integration.department_ids.includes(k.departemen_id))continue
     if(visibleIds&&!visibleIds.has(k.id))continue
     items.push(k)
     if(items.length>lim)break
    }
    if(rows.length<batchSize||items.length>lim)break
   }
  }

  const more=items.length>lim
  items=items.slice(0,lim)
  const last:any=items.at(-1)
  return done(ctx,route,json({data:items,pagination:{limit:lim,has_more:more,next_cursor:more&&last?await nextCursor(`list:${type}`,ctx,filters,{after:last.id}):null}}))
 }catch(e){
  const code=e instanceof Error&&e.message==='LIMIT'?'invalid_limit':e instanceof Error&&e.message==='PARAM'?'invalid_parameter':'invalid_cursor'
  return done(ctx,route,err(code,'Parameter request tidak valid',400,ctx.requestId))
 }
}

export async function handleDetail(request:Request,type:'pendaftaran'|'siswa',id:string){const a=await authenticateIntegration(request);if(a instanceof Response)return a;const ctx=a,route=`/api/v1/${type}/:id`,req=need(ctx,type==='pendaftaran'?'pendaftaran:read':'siswa:read');if(req)return done(ctx,route,req);if(!uuid(id))return done(ctx,route,err('invalid_id','ID tidak valid',400,ctx.requestId));if(type==='pendaftaran'){const x=await fetchRegistration(ctx,id);return done(ctx,route,x?json({data:x}):err('not_found','Data tidak ditemukan atau di luar cakupan',404,ctx.requestId))}const {data:s}=await ctx.admin.from('siswa').select(BASE).eq('id',id).neq('status','calon').maybeSingle();if(!s||(ctx.integration.department_ids?.length&&!ctx.integration.department_ids.includes(s.departemen_id)))return done(ctx,route,err('not_found','Data tidak ditemukan atau di luar cakupan',404,ctx.requestId));const {data:ks}=await ctx.admin.from('kelas_siswa').select('id,kelas_id,tahun_ajaran_id,aktif').eq('siswa_id',id).eq('aktif',true);const visible=(ks||[]).filter((x:any)=>!ctx.integration.academic_year_ids?.length||ctx.integration.academic_year_ids.includes(x.tahun_ajaran_id));if(ctx.integration.academic_year_ids?.length&&!visible.length)return done(ctx,route,err('not_found','Data tidak ditemukan atau di luar cakupan',404,ctx.requestId));return done(ctx,route,json({data:{...s,kelas_aktif:visible}}))}

export async function handleClassStudents(request:Request,id:string){
 const a=await authenticateIntegration(request);if(a instanceof Response)return a
 const ctx=a,route='/api/v1/kelas/:id/siswa',req=need(ctx,'kelas:read')||need(ctx,'siswa:read')
 if(req)return done(ctx,route,req)
 if(!uuid(id))return done(ctx,route,err('invalid_id','ID tidak valid',400,ctx.requestId))
 const {data:k}=await ctx.admin.from('kelas').select('id,nama,departemen_id,aktif').eq('id',id).maybeSingle()
 if(!k||(ctx.integration.department_ids?.length&&!ctx.integration.department_ids.includes(k.departemen_id)))return done(ctx,route,err('not_found','Kelas tidak ditemukan atau di luar cakupan',404,ctx.requestId))
 const u=new URL(request.url),year=u.searchParams.get('tahun_ajaran_id')
 if(year){
  if(!uuid(year))return done(ctx,route,err('invalid_parameter','Tahun ajaran tidak valid',400,ctx.requestId))
  if(ctx.integration.academic_year_ids?.length&&!ctx.integration.academic_year_ids.includes(year))return done(ctx,route,err('filter_out_of_scope','Tahun ajaran di luar cakupan token',403,ctx.requestId))
 }
 let q=(ctx.admin.from('kelas_siswa') as any).select('siswa_id,tahun_ajaran_id').eq('kelas_id',id).eq('aktif',true)
 if(year)q=q.eq('tahun_ajaran_id',year)
 else if(ctx.integration.academic_year_ids?.length)q=q.in('tahun_ajaran_id',ctx.integration.academic_year_ids)
 const {data:rels,error}=await q
 if(error)return done(ctx,route,err('temporary_failure','Gagal membaca anggota kelas',503,ctx.requestId))
 const ids=(rels||[]).map((r:any)=>r.siswa_id)
 const {data:ss}=ids.length?await ctx.admin.from('siswa').select('id,nis,nama,status,departemen_id').in('id',ids):{data:[]}
 return done(ctx,route,json({data:ss||[]}))
}

export async function handleSync(request:Request,type:'pendaftaran'|'siswa'|'kelas'){const a=await authenticateIntegration(request);if(a instanceof Response)return a;const ctx=a,route=`/api/v1/sync/${type}`,req=need(ctx,type==='pendaftaran'?'pendaftaran:read':type==='siswa'?'siswa:read':'kelas:read');if(req)return done(ctx,route,req)
 try{const u=new URL(request.url),lim=page(u),filters=filterFingerprint(u),c=await readCursor(u.searchParams.get('cursor'),`sync:${type}`,ctx,filters);let checkpoint:number,after:number;if(!c){const {data:max}=await (ctx.admin.from('integration_change_log') as any).select('seq').order('seq',{ascending:false}).limit(1);checkpoint=max?.[0]?.seq||0;after=Number(u.searchParams.get('checkpoint')||0);if(!Number.isSafeInteger(after)||after<0)throw new Error('PARAM')}else{checkpoint=c.checkpoint;after=c.after}const minCut=new Date(Date.now()-90*86400000).toISOString();const {data:minRows}=await (ctx.admin.from('integration_change_log') as any).select('seq').gte('changed_at',minCut).order('seq').limit(1);const minSeq=minRows?.[0]?.seq||0;if(after&&after<minSeq)return done(ctx,route,err('checkpoint_expired','Checkpoint sudah melewati retensi change log; lakukan bootstrap ulang',410,ctx.requestId));const {data,error}=await (ctx.admin.from('integration_change_log') as any).select('seq,object_type,object_id,change_type,department_id,academic_year_id,previous_department_id,previous_academic_year_id,changed_at').gt('seq',after).lte('seq',checkpoint).in('object_type',type==='pendaftaran'?['pendaftaran','dokumen']:[type]).order('seq').limit(Math.min(1000,lim*5+1));if(error)throw error;const rows=(data||[]).filter((r:any)=>allowed(ctx,r.department_id,r.academic_year_id)||allowed(ctx,r.previous_department_id,r.previous_academic_year_id));const chosen=rows.slice(0,lim),changes=[];for(const r of chosen){let data:any=null,change=r.change_type;if(r.object_type==='pendaftaran'||r.object_type==='dokumen')data=await fetchRegistration(ctx,r.object_id);else if(r.object_type==='siswa'){const {data:s}=await ctx.admin.from('siswa').select(BASE).eq('id',r.object_id).maybeSingle();data=s&&s.status!=='calon'&&(!ctx.integration.department_ids?.length||ctx.integration.department_ids.includes(s.departemen_id))?s:null}else{const {data:k}=await ctx.admin.from('kelas').select('id,nama,tingkat_id,departemen_id,kapasitas,aktif').eq('id',r.object_id).maybeSingle();data=k&&(!ctx.integration.department_ids?.length||ctx.integration.department_ids.includes(k.departemen_id))?k:null}if(!data&&change==='upsert')change='scope_exit';changes.push({id:r.object_id,object_type:r.object_type,change,version:r.seq,changed_at:r.changed_at,data})}const last=chosen.at(-1),more=rows.length>lim;return done(ctx,route,json({data:changes,sync:{checkpoint,checkpoint_safe:!more,next_cursor:more&&last?await nextCursor(`sync:${type}`,ctx,filters,{checkpoint,after:last.seq}):null,has_more:more,retention_days:90}}))}catch(e){return done(ctx,route,err(e instanceof Error&&e.message==='LIMIT'?'invalid_limit':e instanceof Error&&e.message==='PARAM'?'invalid_parameter':'invalid_cursor','Cursor atau parameter sinkronisasi tidak valid',400,ctx.requestId))}}

export async function handleDocument(request:Request,docId:string){const a=await authenticateIntegration(request);if(a instanceof Response)return a;const ctx=a,route='/api/v1/documents/:id',req=need(ctx,'pendaftaran:read')||need(ctx,'pendaftaran:documents:read');if(req)return done(ctx,route,req);const m=/^([0-9a-f-]{36})\.(kk|akta|rapor|ijazah)$/i.exec(docId);if(!m)return done(ctx,route,err('invalid_id','ID dokumen tidak valid',400,ctx.requestId));const pid=m[1],kind=m[2].toLowerCase();const {data:d}=await (ctx.admin.from('siswa_detail') as any).select(`siswa_id,pendaftaran_id,tahun_ajaran_id,spmb_departemen_tujuan_id,dokumen_${kind}_path`).eq('pendaftaran_id',pid).maybeSingle();const {data:s}=d?await ctx.admin.from('siswa').select('departemen_id').eq('id',d.siswa_id).maybeSingle():{data:null};const path=d?.[`dokumen_${kind}_path`];if(!d||!s||!path||!allowed(ctx,d.spmb_departemen_tujuan_id||s.departemen_id,d.tahun_ajaran_id))return done(ctx,route,err('not_found','Dokumen tidak ditemukan atau di luar cakupan',404,ctx.requestId));const {data:signed,error}=await ctx.admin.storage.from('pmb-dokumen').createSignedUrl(path,60);if(error||!signed?.signedUrl)return done(ctx,route,err('temporary_failure','Gagal menerbitkan akses dokumen',503,ctx.requestId));return done(ctx,route,json({data:{id:docId,version:await pathVersion(path),expires_in:60,url:signed.signedUrl}}))}


const PEGAWAI_BASE='id,nip,nama,email,jenis_kelamin,jabatan,departemen_id,status,tanggal_masuk,tanggal_pensiun,golongan_terakhir,created_at'
function employeeAllowed(ctx:Ctx,dept?:string|null){const ds:string[]=ctx.integration.department_ids||[];return !ds.length||!!dept&&ds.includes(dept)}
function employeeView(_ctx:Ctx,p:any){return {id:p.id,nip:p.nip,nama:p.nama,email:p.email,jenis_kelamin:p.jenis_kelamin,jabatan:p.jabatan,status:p.status,unit:{id:p.departemen_id},tanggal_masuk:p.tanggal_masuk,tanggal_pensiun:p.tanggal_pensiun,golongan_terakhir:p.golongan_terakhir,created_at:p.created_at}}
function apiText(v:unknown){return typeof v==='string'?v.trim():v==null?'':String(v).trim()}
function validDate(v:unknown){const s=apiText(v);return !s||/^\d{4}-\d{2}-\d{2}$/.test(s)}
function employeeError(row:number,code:string,message:string){return {row,status:'error',error:{code,message}}}

export async function handlePegawaiList(request:Request){
 const a=await authenticateIntegration(request);if(a instanceof Response)return a
 const ctx=a,route='/api/v1/pegawai',req=need(ctx,'pegawai:read');if(req)return done(ctx,route,req)
 try{
  const u=new URL(request.url),lim=page(u),filters=filterFingerprint(u),cur=await readCursor(u.searchParams.get('cursor'),'list:pegawai',ctx,filters),after=cur?.after||''
  const dept=u.searchParams.get('departemen_id'),status=u.searchParams.get('status')
  if(dept){if(!uuid(dept))throw new Error('PARAM');if(ctx.integration.department_ids?.length&&!ctx.integration.department_ids.includes(dept))return done(ctx,route,err('filter_out_of_scope','Unit di luar cakupan token',403,ctx.requestId))}
  if(status&&!['aktif','nonaktif'].includes(status))throw new Error('PARAM')
  let q=(ctx.admin.from('pegawai') as any).select(PEGAWAI_BASE).order('id').limit(lim+1)
  if(after)q=q.gt('id',after)
  if(dept)q=q.eq('departemen_id',dept)
  else if(ctx.integration.department_ids?.length)q=q.in('departemen_id',ctx.integration.department_ids)
  if(status)q=q.eq('status',status)
  const {data,error}=await q;if(error)throw error
  let rows=(data||[]).filter((p:any)=>employeeAllowed(ctx,p.departemen_id))
  const more=rows.length>lim;rows=rows.slice(0,lim);const last=rows.at(-1)
  return done(ctx,route,json({data:rows.map((p:any)=>employeeView(ctx,p)),pagination:{limit:lim,has_more:more,next_cursor:more&&last?await nextCursor('list:pegawai',ctx,filters,{after:last.id}):null}}))
 }catch(e){return done(ctx,route,err(e instanceof Error&&e.message==='LIMIT'?'invalid_limit':e instanceof Error&&e.message==='PARAM'?'invalid_parameter':'invalid_cursor','Parameter request tidak valid',400,ctx.requestId))}
}

export async function handlePegawaiDetail(request:Request,id:string){
 const a=await authenticateIntegration(request);if(a instanceof Response)return a
 const ctx=a,route='/api/v1/pegawai/:id',req=need(ctx,'pegawai:read');if(req)return done(ctx,route,req)
 if(!uuid(id))return done(ctx,route,err('invalid_id','ID pegawai tidak valid',400,ctx.requestId))
 const {data:p,error}=await (ctx.admin.from('pegawai') as any).select(PEGAWAI_BASE).eq('id',id).maybeSingle()
 if(error)return done(ctx,route,err('temporary_failure','Gagal membaca data pegawai',503,ctx.requestId))
 if(!p||!employeeAllowed(ctx,p.departemen_id))return done(ctx,route,err('not_found','Pegawai tidak ditemukan atau di luar cakupan',404,ctx.requestId))
 return done(ctx,route,json({data:employeeView(ctx,p)}))
}

export async function handlePegawaiImport(request:Request){
 const a=await authenticateIntegration(request);if(a instanceof Response)return a
 const ctx=a,route='/api/v1/pegawai/import',req=need(ctx,'pegawai:write');if(req)return done(ctx,route,req)
 const writeRate=await rate(ctx.admin,`integration:${ctx.integration.id}:pegawai-write`,30,60);if(!writeRate.allowed)return done(ctx,route,err('rate_limited','Batas bulk import pegawai terlampaui',429,ctx.requestId,{retry_after:writeRate.retry_after},{'Retry-After':String(writeRate.retry_after)}))
 let body:any
 try{body=await request.json()}catch{return done(ctx,route,err('invalid_json','Body harus JSON yang valid',400,ctx.requestId))}
 if(!body||typeof body!=='object'||Array.isArray(body)||!Array.isArray(body.rows)||body.rows.length<1||body.rows.length>200)return done(ctx,route,err('invalid_payload','rows wajib berupa array 1-200 baris',400,ctx.requestId))
 const topKeys=Object.keys(body);if(topKeys.some(k=>!['update_existing','rows'].includes(k)))return done(ctx,route,err('invalid_payload','Field request tidak dikenali',400,ctx.requestId))
 const updateExisting=body.update_existing===true
 const allowedFields=new Set(['pegawai_id','nip','nama','email','jenis_kelamin','jabatan','departemen_id','status','tanggal_masuk','tanggal_pensiun','golongan_terakhir'])
 const rawIds=[...new Set(body.rows.map((r:any)=>apiText(r?.pegawai_id)).filter(Boolean))]
 const ids=rawIds.filter(x=>uuid(x))
 const nips=[...new Set(body.rows.map((r:any)=>apiText(r?.nip)).filter(Boolean))]
 const idCounts=new Map<string,number>(),nipCounts=new Map<string,number>();for(const x of rawIds)idCounts.set(x,body.rows.filter((r:any)=>apiText(r?.pegawai_id)===x).length);for(const x of nips)nipCounts.set(x,body.rows.filter((r:any)=>apiText(r?.nip)===x).length)
 const byId=new Map<string,any>(),byNip=new Map<string,any>()
 if(ids.length){const {data,error}=await (ctx.admin.from('pegawai') as any).select(PEGAWAI_BASE).in('id',ids);if(error)return done(ctx,route,err('temporary_failure','Gagal mencocokkan pegawai existing',503,ctx.requestId));for(const p of data||[])byId.set(p.id,p)}
 if(nips.length){const {data,error}=await (ctx.admin.from('pegawai') as any).select(PEGAWAI_BASE).in('nip',nips);if(error)return done(ctx,route,err('temporary_failure','Gagal mencocokkan NIP existing',503,ctx.requestId));for(const p of data||[])if(p.nip)byNip.set(p.nip,p)}
 const results:any[]=[];let created=0,updated=0,failed=0
 for(let i=0;i<body.rows.length;i++){
  const row=body.rows[i],rowNo=i+1
  if(!row||typeof row!=='object'||Array.isArray(row)){results.push(employeeError(rowNo,'invalid_row','Baris harus object JSON'));failed++;continue}
  const unknown=Object.keys(row).filter(k=>!allowedFields.has(k));if(unknown.length){results.push(employeeError(rowNo,'unknown_field',`Field tidak diizinkan: ${unknown.join(', ')}`));failed++;continue}
  const employeeId=apiText(row.pegawai_id),nip=apiText(row.nip)
  if(employeeId&&!uuid(employeeId)){results.push(employeeError(rowNo,'invalid_employee_id','pegawai_id harus UUID'));failed++;continue}
  if(employeeId&&(idCounts.get(employeeId)||0)>1){results.push(employeeError(rowNo,'duplicate_employee_id','pegawai_id duplikat dalam request'));failed++;continue}
  if(nip&&(nipCounts.get(nip)||0)>1){results.push(employeeError(rowNo,'duplicate_nip','NIP duplikat dalam request'));failed++;continue}
  const idMatch=employeeId?byId.get(employeeId):null,nipMatch=nip?byNip.get(nip):null
  if(employeeId&&!idMatch){results.push(employeeError(rowNo,'employee_not_found','pegawai_id tidak ditemukan'));failed++;continue}
  if(idMatch&&nipMatch&&idMatch.id!==nipMatch.id){results.push(employeeError(rowNo,'identity_conflict','pegawai_id dan NIP mengarah ke pegawai berbeda'));failed++;continue}
  const existing=idMatch||nipMatch
  if(existing&&!employeeAllowed(ctx,existing.departemen_id)){results.push(employeeError(rowNo,'out_of_scope','Pegawai existing di luar cakupan unit token'));failed++;continue}
  if(existing&&!updateExisting){results.push(employeeError(rowNo,'already_exists','Pegawai sudah ada; set update_existing=true untuk memperbarui'));failed++;continue}
  const hasDept=Object.prototype.hasOwnProperty.call(row,'departemen_id')
  let dept:any=hasDept?row.departemen_id:undefined
  if(hasDept&&dept!==null){dept=apiText(dept);if(!uuid(dept)){results.push(employeeError(rowNo,'invalid_department','departemen_id harus UUID atau null'));failed++;continue}}
  const targetDept=hasDept?dept:(existing?.departemen_id??null)
  if(!employeeAllowed(ctx,targetDept)){results.push(employeeError(rowNo,'out_of_scope','Departemen target di luar cakupan unit token'));failed++;continue}
  const gender=apiText(row.jenis_kelamin).toUpperCase();if(gender&&!['L','P'].includes(gender)){results.push(employeeError(rowNo,'invalid_gender','jenis_kelamin harus L atau P'));failed++;continue}
  const status=apiText(row.status).toLowerCase();if(status&&!['aktif','nonaktif'].includes(status)){results.push(employeeError(rowNo,'invalid_status','status harus aktif atau nonaktif'));failed++;continue}
  if(!validDate(row.tanggal_masuk)||!validDate(row.tanggal_pensiun)){results.push(employeeError(rowNo,'invalid_date','Tanggal harus berformat YYYY-MM-DD'));failed++;continue}
  if(!existing&&(!apiText(row.nama)||!apiText(row.jabatan))){results.push(employeeError(rowNo,'required_field','Pegawai baru wajib memiliki nama dan jabatan'));failed++;continue}
  if(existing&&Object.prototype.hasOwnProperty.call(row,'nama')&&!apiText(row.nama)){results.push(employeeError(rowNo,'invalid_name','Nama tidak boleh dikosongkan saat update'));failed++;continue}
  if(existing&&Object.prototype.hasOwnProperty.call(row,'jabatan')&&!apiText(row.jabatan)){results.push(employeeError(rowNo,'invalid_position','Jabatan tidak boleh dikosongkan saat update'));failed++;continue}
  const payload:any={}
  const stringFields=['nip','nama','email','jenis_kelamin','jabatan','status','tanggal_masuk','tanggal_pensiun','golongan_terakhir']
  for(const field of stringFields){
   if(!Object.prototype.hasOwnProperty.call(row,field))continue
   const value=apiText(row[field])
   if(existing&&!value)continue
   payload[field]=value||null
  }
  if(payload.jenis_kelamin)payload.jenis_kelamin=gender
  if(payload.status)payload.status=status
  if(hasDept)payload.departemen_id=dept
  if(!existing){if(!Object.prototype.hasOwnProperty.call(payload,'status'))payload.status='aktif';if(!hasDept)payload.departemen_id=null}
  try{
   if(existing){
    if(!Object.keys(payload).length){results.push(employeeError(rowNo,'no_changes','Tidak ada field yang dapat diperbarui'));failed++;continue}
    const {error}=await (ctx.admin.from('pegawai') as any).update(payload).eq('id',existing.id);if(error)throw error
    results.push({row:rowNo,status:'updated',pegawai_id:existing.id});updated++
   }else{
    const {data:newRow,error}=await (ctx.admin.from('pegawai') as any).insert(payload).select('id').single();if(error)throw error
    results.push({row:rowNo,status:'created',pegawai_id:newRow.id});created++
   }
  }catch(e:any){results.push(employeeError(rowNo,'save_failed',e?.code==='23505'?'NIP sudah digunakan pegawai lain':'Gagal menyimpan pegawai'));failed++}
 }
 return done(ctx,route,json({data:{summary:{created,updated,failed,total:body.rows.length},rows:results}}))
}
