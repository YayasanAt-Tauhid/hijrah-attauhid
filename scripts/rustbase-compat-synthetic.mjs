// One-time opt-in, isolated synthetic compatibility smoke test against LOCAL Rustbase.
// Run only on a development server: node --experimental-websocket scripts/rustbase-compat-synthetic.mjs
// Creates a temporary platform owner and project; deletes the project in finally.
// The platform owner record needs manual scoped cleanup (API does not expose owner deletion).
// Never run this on a production Rustbase instance, or with school data.
import {createClient} from "@supabase/supabase-js";
import {randomBytes} from "node:crypto";
const BASE="http://127.0.0.1:8000",id=randomBytes(5).toString("hex"),name="hijrah-compat-"+id;
let proj=null,ownerToken=null,cleaned=false,passed=0;
function check(ok,label){if(!ok)throw Error(label);console.log("PASS "+label);passed++}
async function api(path,method="GET",body,token){
  const headers={"content-type":"application/json"};
  if(token)headers.authorization="Bearer "+token;
  const response=await fetch(BASE+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(18000)});
  const raw=await response.text();let result;
  try{result=raw?JSON.parse(raw):null}catch{result=raw}
  if(!response.ok)throw Error(method+" "+path+" HTTP "+response.status+": "+JSON.stringify(result).slice(0,180));
  return result;
}
function sdk(out,label){if(out.error)throw Error(label+": "+out.error.message);return out.data}
const client=key=>createClient(BASE,key,{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});
try{
  check((await fetch(BASE+"/health")).ok,"Rustbase dev health");
  ownerToken=(await api("/platform/v1/signup","POST",{email:"ht-"+id+"@test.invalid",password:"TempOnly"+randomBytes(16).toString("hex")})).access_token;
  check(!!ownerToken,"Temporary platform owner");
  proj=await api("/platform/v1/projects","POST",{name},ownerToken);
  check(!!proj.ref&&!!proj.anon_key&&!!proj.service_role_key,"Temporary isolated project");
  await api("/platform/v1/projects/"+proj.ref+"/sql","POST",{query:"CREATE TABLE public.hijrah_tagihan_dummy (id bigint generated always as identity primary key, owner_id uuid not null, jumlah bigint not null check(jumlah>0)); ALTER TABLE public.hijrah_tagihan_dummy ENABLE ROW LEVEL SECURITY; CREATE POLICY own ON public.hijrah_tagihan_dummy FOR ALL USING (owner_id=auth.uid()) WITH CHECK (owner_id=auth.uid()); GRANT SELECT,INSERT,UPDATE,DELETE ON public.hijrah_tagihan_dummy TO PUBLIC; GRANT USAGE,SELECT ON SEQUENCE public.hijrah_tagihan_dummy_id_seq TO PUBLIC; CREATE FUNCTION public.hijrah_whoami_dummy() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;"},ownerToken);
  check(true,"SQL table, RLS and RPC created");
  const roles=await api("/platform/v1/projects/"+proj.ref+"/sql","POST",{query:"SELECT to_regrole('authenticated')::text AS supabase_authenticated_role, to_regrole('service_role')::text AS supabase_service_role"},ownerToken);
  const roleRows=roles.results?.flatMap(x=>x.rows||[])||[];
  const missingRoles=roleRows.length>0 && roleRows[0][0]===null && roleRows[0][1]===null;
  check(missingRoles,"Supabase Postgres roles require mapping in Rustbase");
  const a=client(proj.anon_key),b=client(proj.anon_key),admin=client(proj.service_role_key);
  try{
    const mailA="a-"+id+"@test.invalid",mailB="b-"+id+"@test.invalid",passwordA="Synthetic-A-"+id,passwordB="Synthetic-B-"+id;
    const sa=sdk(await a.auth.signUp({email:mailA,password:passwordA}),"signup A");
    const sb=sdk(await b.auth.signUp({email:mailB,password:passwordB}),"signup B");
    check(!!sa.user?.id&&!!sb.user?.id&&!!sa.session?.access_token,"Supabase-js signUp sessions");
    const login=sdk(await a.auth.signInWithPassword({email:mailA,password:passwordA}),"login");
    check(!!login.session?.access_token,"Supabase-js login with password");
    const self=sdk(await a.auth.getUser(),"getUser");
    check(self.user?.id===sa.user.id,"Supabase-js getUser");
    check(!!(await b.auth.signInWithPassword({email:mailB,password:"incorrect-demo-password"})).error,"Wrong password rejected");
    sdk(await b.auth.signInWithPassword({email:mailB,password:passwordB}),"restore B login");
    const ins=sdk(await a.from("hijrah_tagihan_dummy").insert({owner_id:sa.user.id,jumlah:175000}).select("id,owner_id,jumlah").single(),"insert");
    check(ins.jumlah===175000,"Invoice insert own account");
    const ar=sdk(await a.from("hijrah_tagihan_dummy").select("id,jumlah"),"read A");
    const br=sdk(await b.from("hijrah_tagihan_dummy").select("id,jumlah"),"read B");
    check(ar.length===1&&br.length===0,"RLS hides parent A invoice from B");
    const wrongful=await b.from("hijrah_tagihan_dummy").insert({owner_id:sa.user.id,jumlah:100000});
    check(!!wrongful.error,"RLS blocks cross-parent insert");
    const who=sdk(await a.rpc("hijrah_whoami_dummy"),"RPC");
    check(who===sa.user.id,"RPC auth.uid context");
    const svc=sdk(await admin.from("hijrah_tagihan_dummy").select("id"),"service");
    check(svc.length===1,"service_role reads data");
    const bucket="docs-"+id,obj="kk/synthetic-document.txt";
    sdk(await admin.storage.createBucket(bucket,{public:false}),"private bucket");
    const txt="hijrah-compat-test-only";
    sdk(await admin.storage.from(bucket).upload(obj,new Blob([txt],{type:"text/plain"})),"storage upload");
    check(!!(await b.storage.from(bucket).download(obj)).error,"Private file access denied");
    const signed=sdk(await admin.storage.from(bucket).createSignedUrl(obj,60),"signed URL");
    const downloaded=await fetch(signed.signedUrl,{signal:AbortSignal.timeout(10000)});
    check(downloaded.ok&&(await downloaded.text())===txt,"Signed URL download validated");
  } finally{a.realtime.disconnect();b.realtime.disconnect();admin.realtime.disconnect();}
}catch(e){console.error("FAIL "+String(e.message||e).slice(0,300));process.exitCode=1}
finally{
  if(proj?.ref&&ownerToken){
    try{const x=await api("/platform/v1/projects/"+proj.ref+"?confirm="+encodeURIComponent(name),"DELETE",undefined,ownerToken);cleaned=x.deleted===proj.ref;console.log(cleaned?"PASS disposable database deleted":"FAIL delete not confirmed");if(!cleaned)process.exitCode=1;}
    catch(e){console.error("FAIL cleanup "+String(e.message||e).slice(0,230));process.exitCode=1}
  }
  console.log("RESULT "+JSON.stringify({passed,projectCleaned:cleaned,createdProject:!!proj,mode:"synthetic-only"}));
}