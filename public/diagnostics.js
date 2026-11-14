const output=document.getElementById('diagnostic-results'),sqlBox=document.getElementById('repair-section'),sql=document.getElementById('repair-sql');
async function load(){
 document.getElementById('run-diagnostic').disabled=true;output.textContent='檢查中…';sqlBox.hidden=true;
 try{
  const response=await fetch('/api/diagnostics',{cache:'no-store'});const data=await response.json();
  if(!response.ok||!Array.isArray(data.checks))throw new Error('尚未取得新版診斷。請先確認修正包已部署成功，再重新整理此頁。');
  output.textContent='';
  for(const item of data.checks){const row=document.createElement('p');row.textContent=(item.ok?'✓ ':'✕ ')+item.message;row.style.color=item.ok?'#45633a':'#a34c31';output.appendChild(row)}
  const message=document.createElement('p');message.textContent=data.ok?'基本連線設定檢查通過。請回首頁測試選號與教師登入。':'請先處理上方標示 ✕ 的項目。';message.style.fontWeight='bold';output.appendChild(message);
  if(data.repairSql){sql.value=data.repairSql;sqlBox.hidden=false}
 }catch(error){output.textContent=error.message}
 finally{document.getElementById('run-diagnostic').disabled=false}
}
document.getElementById('run-diagnostic').addEventListener('click',load);
load();

