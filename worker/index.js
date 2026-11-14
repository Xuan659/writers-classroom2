import {handleClassroom} from './classroom-service.mjs';
const json=(data,status)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export default {
 async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/api/classroom'){
   if(request.method!=='POST')return json({error:'請從寫作教室的介面操作。'},405);
   if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return json({error:'來源不符。'},403);
   if(!env.DB||!env.TEACHER_PIN)return json({error:'課堂尚未開放，請老師完成資料庫與教師密碼設定。'},503);
   let payload;try{payload=await request.json()}catch{return json({error:'資料格式不正確。'},400)}
   if(!payload||Array.isArray(payload)||typeof payload!=='object')return json({error:'資料格式不正確。'},400);
   const headers=new Headers(request.headers);headers.delete('content-length');
   headers.set('x-teacher-pin',typeof payload.teacherPin==='string'?payload.teacherPin:'');
   if(payload.action==='teacher')return handleClassroom(new Request(request.url,{method:'GET',headers}),env);
   const {teacherPin,...body}=payload;
   return handleClassroom(new Request(request.url,{method:'POST',headers,body:JSON.stringify(body)}),env);
  }
  if(path.startsWith('/api/'))return json({error:'找不到這個功能。'},404);
  return env.ASSETS.fetch(request);
 }
};

