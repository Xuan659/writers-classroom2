import {databaseFailure} from './diagnostics.mjs';
import {LEGACY_LESSONS} from './legacy-lessons.mjs';
const GROUPS=[[6,20,22,15],[9,13,26,18],[4,25,1,8],[2,3,21,19],[12,10,16,24],[17,14,11,7],[27,5,23]];
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const setups=new WeakMap();
export const WORKFLOW_VERSION='two-stage-v1';
export const SCHEMA="CREATE TABLE IF NOT EXISTS writing_two_stage (work_key TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('group','individual','observer')),target INTEGER NOT NULL,group_id INTEGER NOT NULL,token TEXT NOT NULL,answers TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('writing','submitted')),claim_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,last_request TEXT NOT NULL DEFAULT '',updated TEXT NOT NULL,parent_claim TEXT NOT NULL DEFAULT '',parent_revision INTEGER NOT NULL DEFAULT 0)";
async function setup(db){let p=setups.get(db);if(!p){p=db.prepare(SCHEMA).run();setups.set(db,p);p.catch(()=>setups.delete(db))}await p}
const answersOf=r=>{const a=JSON.parse(r.answers);if(!Array.isArray(a)||a.length!==4||a.some(v=>typeof v!=='string'))throw new Error('Invalid two-stage answers');return a};
const rowOf=r=>({key:r.work_key,stage:r.kind,id:r.target,seat:r.kind==='group'?null:r.target,groupId:r.group_id,topic:3,answers:answersOf(r),status:r.status,updated:r.updated,revision:r.revision,claimId:r.claim_id,isRevision:r.claim_id.startsWith('edit:'),groupRevision:r.parent_revision});
const allowed=(r,b)=>r&&(r.kind!=='individual'||r.token===b.token);
const owns=(r,b)=>allowed(r,b)&&r.claim_id===b.claimId;
function targetOf(b){
 const stage=b.stage;
 if(stage==='group'&&Number.isInteger(b.groupId)&&b.groupId>=1&&b.groupId<=7)return{key:'g:'+b.groupId,stage,id:b.groupId,groupId:b.groupId};
 if(stage==='individual'&&Number.isInteger(b.seat)&&b.seat>=1&&b.seat<=27){const groupId=GROUPS.findIndex(g=>g.includes(b.seat))+1;if(b.groupId!==groupId)return null;return{key:'s:'+b.seat,stage,id:b.seat,groupId}}
 if(stage==='observer'&&Number.isInteger(b.seat)&&b.seat>=28&&b.seat<=35)return{key:'o:'+b.seat,stage,id:b.seat,groupId:0};
 return null;
}
export async function handleTwoStage(b,env){
 try{
  const db=env.DB;if(!db)return reply({error:'作品儲存服務尚未就緒，請通知老師。',retryable:false},503);
  await setup(db);
  if(b.action==='health')return reply({ok:true,workflow:WORKFLOW_VERSION});
  const teacher=!!env.TEACHER_PIN&&b.teacherPin===env.TEACHER_PIN;
  if(b.action==='teacher'){
   if(!teacher)return reply({error:'教師密碼不正確。'},401);
   let records,delta=false,keys;
   if(Array.isArray(b.knownRecords)&&b.knownRecords.length<=42&&b.knownRecords.every(r=>r&&typeof r.key==='string'&&Number.isInteger(r.revision)&&typeof r.claimId==='string')){
    delta=true;const known=new Map(b.knownRecords.map(r=>[r.key,r]));
    const meta=(await db.prepare('SELECT work_key,revision,claim_id,status FROM writing_two_stage ORDER BY work_key').all()).results;keys=meta.map(r=>r.work_key);
    const changed=meta.filter(r=>{const old=known.get(r.work_key);return !old||old.claimId!==r.claim_id||old.revision!==r.revision||old.status!==r.status}).map(r=>r.work_key);
    records=changed.length?(await db.prepare('SELECT * FROM writing_two_stage WHERE work_key IN ('+changed.map(()=>'?').join(',')+') ORDER BY target').bind(...changed).all()).results:[];
   }else records=(await db.prepare('SELECT * FROM writing_two_stage ORDER BY target').all()).results;
   const data={workflow:WORKFLOW_VERSION,delta,keys,rows:records.filter(r=>r.kind!=='group').map(rowOf),groups:records.filter(r=>r.kind==='group').map(rowOf)};
   if(b.includeLegacy){try{data.legacyRows=(await db.prepare('SELECT seat,topic,answers,status,updated FROM submissions ORDER BY seat').all()).results.map(r=>({...r,answers:JSON.parse(r.answers),title:LEGACY_LESSONS.find(l=>l.id===r.topic)?.title||'先前作品',parts:LEGACY_LESSONS.find(l=>l.id===r.topic)?.parts||[]}))}catch(e){if(!/no such table/i.test(e.message))throw e;data.legacyRows=[]}}
   return reply(data);
  }
  const t=targetOf(b);if(!t)return reply({error:'組別或座號不正確，請返回重新選擇。'},400);
  if(b.action==='release'){
   if(!teacher)return reply({error:'請重新登入教師控制台。'},401);
   if(typeof b.claimId!=='string')return reply({error:'請更新作品狀態後再操作。'},400);
   const removed=await db.prepare('DELETE FROM writing_two_stage WHERE work_key=? AND claim_id=? RETURNING work_key').bind(t.key,b.claimId).first();
   if(removed)return reply({ok:true});
   const current=await db.prepare('SELECT work_key FROM writing_two_stage WHERE work_key=?').bind(t.key).first();
   return current?reply({error:'作品已更新，請重新讀取後再操作。'},409):reply({ok:true});
  }
  if(typeof b.token!=='string'||b.token.length<20||b.token.length>100)return reply({error:'裝置識別有誤，請重新載入網站。'},400);
  if(b.action==='join'){
   let r=await db.prepare('SELECT * FROM writing_two_stage WHERE work_key=?').bind(t.key).first();
   if(!r){
    let a=['','','',''],parentClaim='',parentRevision=0;
    if(t.stage==='individual'){
     const parent=await db.prepare('SELECT * FROM writing_two_stage WHERE work_key=?').bind('g:'+t.groupId).first();
     if(!parent||parent.status!=='submitted')return reply({error:'請先完成並繳交本組第一階段的小組共作，再進入個人寫作。',code:'GROUP_NOT_READY',retryable:false},423);
     const p=answersOf(parent);a=[p[0],p[1],'',''];parentClaim=parent.claim_id;parentRevision=parent.revision;
    }
    await db.prepare("INSERT INTO writing_two_stage(work_key,kind,target,group_id,token,answers,status,claim_id,revision,last_request,updated,parent_claim,parent_revision) VALUES(?,?,?,?,?,?,'writing',?,0,'',?,?,?) ON CONFLICT(work_key) DO NOTHING").bind(t.key,t.stage,t.id,t.groupId,b.token,JSON.stringify(a),crypto.randomUUID(),new Date().toISOString(),parentClaim,parentRevision).run();
    r=await db.prepare('SELECT * FROM writing_two_stage WHERE work_key=?').bind(t.key).first();
   }
   if(!allowed(r,b))return reply({error:t.stage==='group'?'本組已由另一台平板開始共作，請使用原本的小組平板；需要更換時請通知老師。':'這個座號已由另一台平板開始個人寫作，請確認座號或通知老師。',code:'DEVICE_CONFLICT'},409);
   return reply(rowOf(r));
  }
  if(!['save','submit','reopen'].includes(b.action))return reply({error:'找不到這個操作，請重新載入最新網站。'},400);
  if(typeof b.claimId!=='string'||!Number.isInteger(b.revision)||b.revision<0||typeof b.requestId!=='string'||b.requestId.length<20||b.requestId.length>100)return reply({error:'作品狀態已改變，請重新選取。'},409);
  let r=await db.prepare('SELECT * FROM writing_two_stage WHERE work_key=?').bind(t.key).first();
  if(b.action==='reopen'&&allowed(r,b)&&r.last_request===b.requestId&&r.status==='writing'&&r.claim_id.startsWith('edit:'))return reply(rowOf(r));
  if(!owns(r,b))return reply({error:'作品使用狀態已改變，文字已保留在本機，請重新進入或通知老師。'},409);
  if(b.action==='reopen'){
   const changed=await db.prepare("UPDATE writing_two_stage SET status='writing',claim_id=?,revision=revision+1,last_request=?,updated=? WHERE work_key=? AND claim_id=? AND revision=? AND status='submitted' RETURNING *").bind('edit:'+crypto.randomUUID(),b.requestId,new Date().toISOString(),t.key,b.claimId,b.revision).first();
   if(changed)return reply(rowOf(changed));
   r=await db.prepare('SELECT * FROM writing_two_stage WHERE work_key=?').bind(t.key).first();
   if(allowed(r,b)&&r.last_request===b.requestId&&r.status==='writing')return reply(rowOf(r));
   return reply({error:'作品已由另一個頁面更新，請重新進入。'},409);
  }
  if(!Array.isArray(b.answers)||b.answers.length!==4||b.answers.some(v=>typeof v!=='string'))return reply({error:'作答格式不正確，請重新載入後再試。'},400);
  const current=answersOf(r),a=t.stage==='group'?[b.answers[0],b.answers[1],'','']:t.stage==='individual'?[current[0],current[1],b.answers[2],b.answers[3]]:[...b.answers];
  const editable=t.stage==='group'?[0,1]:t.stage==='individual'?[2,3]:[0,1,2,3];
  const required=t.stage==='group'?4:6;
  if(b.action==='submit'&&(!Array.isArray(b.checks)||b.checks.length!==required||b.checks.some(v=>v!==true)))return reply({error:'請先完成本階段全部自我檢核。'},400);
  if(b.action==='submit'&&editable.some(i=>!a[i].trim()))return reply({error:'請先填完本階段開放的欄位。'},400);
  if(r.last_request===b.requestId)return reply({ok:true,status:r.status,revision:r.revision});
  if(r.status==='submitted')return reply({error:'這份作品已繳交，請先按「修改作品」。'},409);
  const status=b.action==='submit'?'submitted':'writing';
  const changed=await db.prepare("UPDATE writing_two_stage SET answers=?,status=?,revision=revision+1,last_request=?,updated=? WHERE work_key=? AND claim_id=? AND revision=? AND status='writing' RETURNING revision,status").bind(JSON.stringify(a),status,b.requestId,new Date().toISOString(),t.key,b.claimId,b.revision).first();
  if(changed)return reply({ok:true,...changed});
  r=await db.prepare('SELECT * FROM writing_two_stage WHERE work_key=?').bind(t.key).first();
  if(owns(r,b)&&r.last_request===b.requestId)return reply({ok:true,status:r.status,revision:r.revision});
  return reply({error:'作品剛由其他頁面更新，已阻止舊內容覆蓋。請保留本機文字並重新進入。'},409);
 }catch(e){const detail=databaseFailure(e);return reply(detail,detail.status)}
}
