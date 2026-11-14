export const REQUIRED_COLUMNS=['seat','topic','token','answers','status','updated','claim_id','revision','last_request'];
const CREATE_SQL="CREATE TABLE IF NOT EXISTS submissions (seat INTEGER PRIMARY KEY CHECK (seat BETWEEN 1 AND 35), topic INTEGER NOT NULL DEFAULT 1 CHECK (topic BETWEEN 1 AND 3), token TEXT NOT NULL, answers TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'writing' CHECK (status IN ('writing','submitted')), updated TEXT NOT NULL, claim_id TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0, last_request TEXT NOT NULL DEFAULT '');";
const ADD_COLUMNS={
 topic:"ALTER TABLE submissions ADD COLUMN topic INTEGER NOT NULL DEFAULT 1;",
 token:"ALTER TABLE submissions ADD COLUMN token TEXT NOT NULL DEFAULT '';",
 answers:"ALTER TABLE submissions ADD COLUMN answers TEXT NOT NULL DEFAULT '[]';",
 status:"ALTER TABLE submissions ADD COLUMN status TEXT NOT NULL DEFAULT 'writing';",
 updated:"ALTER TABLE submissions ADD COLUMN updated TEXT NOT NULL DEFAULT '';",
 claim_id:"ALTER TABLE submissions ADD COLUMN claim_id TEXT NOT NULL DEFAULT '';",
 revision:"ALTER TABLE submissions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;",
 last_request:"ALTER TABLE submissions ADD COLUMN last_request TEXT NOT NULL DEFAULT '';"
};
export function databaseFailure(error){
 const text=[error?.message,error?.cause?.message].filter(Boolean).join(' ');
 if(/no such table/i.test(text))return {code:'DB_TABLE_MISSING',status:424,retryable:false,error:'作答資料表尚未建立。請老師開啟網站的連線診斷頁完成設定。'};
 if(/no such column|has no column named/i.test(text))return {code:'DB_SCHEMA_MISMATCH',status:424,retryable:false,error:'網站與資料表版本不一致。請老師開啟連線診斷頁修正。'};
 if(error?.code==='DB_CONTENT_INVALID'||error instanceof SyntaxError)return {code:'DB_CONTENT_INVALID',status:424,retryable:false,error:'資料庫內的作答格式需要檢查。請老師查看連線診斷，原有資料未清除。'};
 if(/quota|exceeded.*limit|SQLITE_FULL|daily.*limit/i.test(text))return {code:'DB_LIMIT_REACHED',status:429,retryable:false,error:'資料庫使用額度已達上限。請老師檢查 Cloudflare 使用量。'};
 return {code:'SERVER_UNAVAILABLE',status:503,retryable:true,error:'後端目前無法完成作答處理。請老師開啟連線診斷頁確認原因。'};
}
export async function diagnose(env){
 const checks=[],add=(id,ok,message)=>checks.push({id,ok,message});
 add('worker',true,'網站後端已回應');
 add('teacherSecret',!!env.TEACHER_PIN,env.TEACHER_PIN?'教師密碼已設定':'尚未設定 TEACHER_PIN Secret');
 add('databaseBinding',!!env.DB&&typeof env.DB.prepare==='function',env.DB&&typeof env.DB.prepare==='function'?'DB 綁定已設定':'找不到有效的 DB 資料庫綁定');
 let repairSql='',columns=[],missing=[];
 if(env.DB&&typeof env.DB.prepare==='function'){
  try{
   const result=await env.DB.prepare('PRAGMA table_info(submissions)').all();
   columns=result.results.map(r=>r.name);
   add('databaseReachable',true,'資料庫可以讀取');
   add('table',columns.length>0,columns.length?'submissions 資料表已存在':'尚未建立 submissions 資料表');
   if(!columns.length)repairSql=CREATE_SQL;
   else{
    missing=REQUIRED_COLUMNS.filter(c=>!columns.includes(c));
    const seat=result.results.find(r=>r.name==='seat');const seatReady=!!seat?.pk&&String(seat.type).toUpperCase()==='INTEGER'&&result.results.filter(r=>r.pk).length===1;
    add('seatKey',seatReady,seatReady?'座號主鍵已設定':'座號主鍵不正確，需要協助檢查資料表');
    add('columns',!missing.length,missing.length?'缺少欄位：'+missing.join('、'):'所有必要欄位已就緒');
    if(missing.length&&!missing.includes('seat')&&seatReady)repairSql=missing.map(c=>ADD_COLUMNS[c]).join('\n');
    if(!missing.length){
     const content=await env.DB.prepare('SELECT answers FROM submissions LIMIT 35').all();const invalid=content.results.some(r=>{try{const value=JSON.parse(r.answers);return !Array.isArray(value)||![0,4].includes(value.length)||value.some(x=>typeof x!=='string')}catch{return true}});
     add('answerData',!invalid,invalid?'作答格式異常，請先備份再由教師檢查':'既有作答 JSON 格式可讀取');
    }
   }
  }catch(error){const detail=databaseFailure(error);add('databaseReachable',false,detail.error)}
 }
 return {version:'connection-fix-2026-11-14',ok:checks.every(x=>x.ok),checks,missingColumns:missing,repairSql};
}

