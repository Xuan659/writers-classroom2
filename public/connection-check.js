import {CONFIG} from './config.js';
import {rpc} from './transport.js';
import {ReliableWriter} from './reliable-writer.js';
const form=document.getElementById('test-form'),log=document.getElementById('test-log'),button=document.getElementById('run-test');
function line(text){const p=document.createElement('p');p.textContent=text;log.appendChild(p)}
form.addEventListener('submit',async event=>{
 event.preventDefault();if(button.disabled)return;button.disabled=true;log.textContent='';
 const teacherPin=document.getElementById('test-pin').value;
 const claimed=[];let success=false;
 try{
  if(!document.getElementById('test-confirm').checked)throw new Error('請先勾選確認：目前沒有學生使用網站。');
  line('檢查教師密碼、連線與教室是否空白…');
  const before=await rpc(CONFIG,{action:'teacher',teacherPin},{retries:0});
  if(before.rows.length)throw new Error('教室已有作答，已停止。測試不會清除原有作品。');
  line('建立 35 個測試作答身分…');
  await Promise.allSettled(Array.from({length:35},async(_,i)=>{
   const seat=i+1,token=crypto.randomUUID(),row=await rpc(CONFIG,{action:'join',seat,token});
   const record={seat,token,...row};claimed.push(record);
   const writer=new ReliableWriter({claimId:row.claimId,revision:row.revision,send:body=>rpc(CONFIG,{...body,seat,token})});
   const final={seat,topic:(seat%3)+1,answers:Array.from({length:4},(_,j)=>'連線測試 '+seat+' 號 / '+j),checks:[true,true,true,true,true,true]};
   const one=writer.enqueue({...final,answers:['較早草稿','較早草稿','較早草稿','較早草稿']});
   const two=writer.enqueue({...final,answers:['較新草稿','較新草稿','較新草稿','較新草稿']});
   const submit=writer.enqueue(final,true);
   await Promise.all([one,two,submit]);record.done=true;
  }));
  if(claimed.length!==35||claimed.some(r=>!r.done))throw new Error('至少一個身分未完成同步；請查看網路與資料庫設定。');
  line('讀取教師資料，核對 35 份最終答案與座號…');
  const after=await rpc(CONFIG,{action:'teacher',teacherPin},{retries:0});
  for(const own of claimed){
   const row=after.rows.find(r=>r.seat===own.seat&&r.claimId===own.claimId);
   if(!row||row.status!=='submitted'||row.answers.some((v,j)=>v!=='連線測試 '+own.seat+' 號 / '+j))throw new Error('作品核對失敗：'+own.seat+' 號。');
  }
  success=true;line('通過：35 個身分的選號、草稿、排隊繳交及教師讀取核對。');
 }catch(e){line('未通過：'+e.message)}
 finally{
  if(claimed.length){line('清理本次建立的測試資料（不會清除其他使用識別的作品）…');const failed=[];for(let i=0;i<claimed.length;i+=5){await Promise.all(claimed.slice(i,i+5).map(async r=>{try{await rpc(CONFIG,{action:'release',seat:r.seat,claimId:r.claimId,teacherPin})}catch{failed.push(r.seat)}}))}if(failed.length){line('這些測試座號尚未清理，請到教師控制台確認：'+failed.join('、'));success=false}else line('測試資料已清理。')}
  line(success?'線上邏輯檢查完成。這不是 35 台實體平板實測；仍請在學校 Wi-Fi 進行多人演練。':'請先修正設定或網路問題，再重試。');
  document.getElementById('test-pin').value='';button.disabled=false;
 }
});

