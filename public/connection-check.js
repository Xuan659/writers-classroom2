import {CONFIG} from './config.js?v=20261118-two-stage-04';
import {rpc} from './transport.js?v=20261118-two-stage-04';
const form=document.getElementById('test-form'),log=document.getElementById('test-log'),button=document.getElementById('run-test');
const line=text=>{const p=document.createElement('p');p.textContent=text;log.appendChild(p)};
form.addEventListener('submit',async event=>{
 event.preventDefault();if(button.disabled)return;button.disabled=true;log.textContent='';
 const teacherPin=document.getElementById('test-pin').value;
 try{
  const health=await rpc(CONFIG,{flow:'two-stage',action:'health'},{retries:0,timeoutMs:6000});
  if(health.workflow!=='two-stage-v1')throw new Error('伺服器版本尚未更新。');
  const before=await rpc(CONFIG,{flow:'two-stage',action:'teacher',teacherPin},{retries:0});
  line('兩階段儲存與教師讀取正常：'+before.groups.length+' 組、'+before.rows.length+' 份作答紀錄。');
  const started=performance.now();let completed=0;
  const results=await Promise.allSettled(Array.from({length:35},async()=>{
   const r=await rpc(CONFIG,{flow:'two-stage',action:'health'},{retries:0,timeoutMs:8000});
   if(r.workflow!=='two-stage-v1')throw new Error('版本不一致');completed++;
  }));
  const errors=results.filter(r=>r.status==='rejected');line('35 個同時唯讀請求：'+completed+' 個成功，耗時約 '+((performance.now()-started)/1000).toFixed(1)+' 秒。');
  if(errors.length)throw new Error('有 '+errors.length+' 個連線未完成，請檢查網路後重試。');
  line('唯讀連線檢查完成，沒有建立、修改或清除作答紀錄。');
 }catch(e){line('檢查未完成：'+e.message)}
 finally{line('這不是 35 台實體平板的寫入測試，仍需在學校 Wi-Fi 彩排。');document.getElementById('test-pin').value='';button.disabled=false}
});
