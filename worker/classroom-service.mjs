import {databaseFailure} from './diagnostics.mjs';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const publicRow=r=>{let answers=JSON.parse(r.answers);if(Array.isArray(answers)&&answers.length===0)answers=['','','',''];if(!Array.isArray(answers)||answers.length!==4||answers.some(x=>typeof x!=='string'))throw Object.assign(new Error('Invalid stored answers'),{code:'DB_CONTENT_INVALID'});return{seat:r.seat,topic:r.topic,answers,status:r.status,updated:r.updated,revision:r.revision,claimId:r.claim_id}};
const own=(r,b)=>r&&r.token===b.token&&r.claim_id===b.claimId;
export async function handleClassroom(request,env){
 try{
  const db=env.DB;
  if(!db)return reply({error:'網站資料庫尚未就緒，請老師確認設定。'},503);
  const isTeacher=!!env.TEACHER_PIN&&request.headers.get('x-teacher-pin')===env.TEACHER_PIN;
  if(request.method==='GET'){
   if(!isTeacher)return reply({error:'教師密碼不正確。'},401);
   const result=await db.prepare('SELECT seat,topic,answers,status,updated,revision,claim_id FROM submissions ORDER BY seat').all();
   return reply({rows:result.results.map(publicRow)});
  }
  if(request.method!=='POST')return reply({error:'不支援此操作。'},405);
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'來源不符。'},403);
  let b;try{b=await request.json()}catch{return reply({error:'資料格式錯誤。'},400)}
  if(!Number.isInteger(b.seat)||b.seat<1||b.seat>35)return reply({error:'座號錯誤。'},400);
  if(b.action==='release'){
   if(!isTeacher)return reply({error:'請重新登入教師控制台。'},401);
   if(typeof b.claimId!=='string')return reply({error:'請更新作品狀態後再操作。'},400);
   const r=await db.prepare('DELETE FROM submissions WHERE seat=? AND claim_id=? RETURNING seat').bind(b.seat,b.claimId).first();
   if(r)return reply({ok:true});const current=await db.prepare('SELECT seat FROM submissions WHERE seat=?').bind(b.seat).first();return current?reply({error:'座號狀態已改變，請先更新。'},409):reply({ok:true});
  }
  if(typeof b.token!=='string'||b.token.length<20||b.token.length>100)return reply({error:'裝置識別錯誤。'},400);
  if(b.action==='join'){
   await db.prepare("INSERT INTO submissions (seat,topic,token,answers,status,updated,claim_id,revision,last_request) VALUES (?,1,?,'[]','writing',?,?,0,'') ON CONFLICT(seat) DO NOTHING").bind(b.seat,b.token,new Date().toISOString(),crypto.randomUUID()).run();
   const row=await db.prepare('SELECT * FROM submissions WHERE seat=?').bind(b.seat).first();
   if(!row||row.token!==b.token)return reply({error:'這個座號已被另一台裝置選用，請確認座號；換裝置請老師解除。'},409);
   return reply(publicRow(row));
  }
  if(!['save','submit'].includes(b.action)||![1,2,3].includes(b.topic)||!Array.isArray(b.answers)||b.answers.length!==4||b.answers.some(x=>typeof x!=='string'))return reply({error:'請檢查題目與填空內容。'},400);
  if(!Number.isInteger(b.revision)||b.revision<0||typeof b.claimId!=='string'||typeof b.requestId!=='string'||b.requestId.length<20||b.requestId.length>100)return reply({error:'作答連線狀態已改變，請重新選取座號。'},409);
  if(b.action==='submit'&&(!Array.isArray(b.checks)||b.checks.length!==4||b.checks.some(x=>x!==true)))return reply({error:'請先完成四項自我檢核。'},400);
  if(b.action==='submit'&&b.answers.some(x=>!x.trim()))return reply({error:'四個空格都完成後才能繳交喔。'},400);
  let row=await db.prepare('SELECT * FROM submissions WHERE seat=?').bind(b.seat).first();
  if(!own(row,b))return reply({error:'座號使用權已變更，文字仍保留在本機，請重新選取或通知老師。'},409);
  // A retried write is acknowledged without writing again.
  if(row.last_request===b.requestId)return reply({ok:true,status:row.status,revision:row.revision});
  if(row.status==='submitted')return reply({error:'此作品已繳交，舊草稿不會覆蓋它。'},409);
  const status=b.action==='submit'?'submitted':'writing';
  const updated=await db.prepare("UPDATE submissions SET topic=?,answers=?,status=?,updated=?,revision=revision+1,last_request=? WHERE seat=? AND token=? AND claim_id=? AND revision=? AND status='writing' RETURNING revision,status").bind(b.topic,JSON.stringify(b.answers),status,new Date().toISOString(),b.requestId,b.seat,b.token,b.claimId,b.revision).first();
  if(updated)return reply({ok:true,...updated});
  row=await db.prepare('SELECT * FROM submissions WHERE seat=?').bind(b.seat).first();
  if(own(row,b)&&row.last_request===b.requestId)return reply({ok:true,status:row.status,revision:row.revision});
  return reply({error:'作品已由另一個頁面更新，已阻止舊內容覆蓋。請保留本機草稿並重新選取座號。'},409);
 }catch(error){const detail=databaseFailure(error);return reply(detail,detail.status)}
}

