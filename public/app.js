import {CONFIG} from './config.js?v=20261118-display-01';
import {LESSONS} from './lessons.js?v=20261118-display-01';
import {HOLIDAY_ART} from './holiday-art.js?v=20261118-display-01';
import {ReliableWriter} from './reliable-writer.js?v=20261118-display-01';
import {rpc,validateConfig} from './transport.js?v=20261118-display-01';

const app=document.getElementById('app'),globalMessage=document.getElementById('global-message');
const CHECKS=["標點符號使用恰當，沒有錯字","有寫出人物所在的具體位置","有寫出人物正在做的動作","有寫出符合情境與人物心情的對話","有寫出人物心裡的想法","我的補寫與前後文連貫，讀起來通順"];
const GROUPS=[{"id":1,"name":"第一組","seats":[6,20,22,15]},{"id":2,"name":"第二組","seats":[9,13,26,18]},{"id":3,"name":"第三組","seats":[4,25,1,8]},{"id":4,"name":"第四組","seats":[2,3,21,19]},{"id":5,"name":"第五組","seats":[12,10,16,24]},{"id":6,"name":"第六組","seats":[17,14,11,7]},{"id":7,"name":"第七組","seats":[27,5,23]}];
const GUIDANCE=[['位置','人物在哪裡？和其他人或物品有什麼位置關係？'],['動作','人物做了哪些動作？能不能寫出連續的動作？'],['對話','人物會說什麼？怎麼說才能表現當下的情緒？'],['想法','人物心裡在想什麼？有什麼擔心、期待或疑問？']];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const story=s=>esc(s).replace(/小傑|小恩|小可|小娜|小琪/g,n=>'<span class="proper-name">'+n+'</span>');
const namespace='little-writer:'+CONFIG.storageNamespace+':';
let selectedGroup=null,stageMode=null,joinAttempt=0,joinController=null,lastJoinTarget=null,flowReady=false,teacherGroups=[],selectedTeacherGroup=null;
let token='',view='home',session=null,joining=false,teacherPin='',teacherRows=[],selectedTeacherSeat=1,highlight=true;
let autosaveTimer,teacherTimer,teacherController,teacherPromise=null,teacherFingerprint='',loginBusy=false,loginAttempt=0,loginController=null,displayedKey='',teacherPollStarted=0;
const pendingResize=new WeakSet(),localDraftTimers=new WeakMap();let previewPending=false,previewTimer;
try{token=localStorage.getItem(namespace+'device')||crypto.randomUUID();localStorage.setItem(namespace+'device',token)}catch{token=crypto.randomUUID();setGlobal('這台裝置無法保存草稿，請保持畫面開啟並通知老師。')}
function setGlobal(message=''){globalMessage.textContent=message;globalMessage.hidden=!message}
function setSync(text){if(view==='write'){const el=document.getElementById('sync-message');if(el&&el.textContent!==text)el.textContent=text}}
function route(next){if(session?.submitting||joining)return;clearTimeout(previewTimer);clearTimeout(autosaveTimer);if(session?.dirty)persistDraft(session);if(next!=='login'){loginController?.abort();loginController=null;loginBusy=false;loginAttempt++}if(!['dashboard','display'].includes(next))stopTeacherPolling();setGlobal('');view=next}
function getLesson(){return LESSONS[0]}
function scheduleLocalDraft(s){
 if(localDraftTimers.has(s))return;
 localDraftTimers.set(s,setTimeout(()=>persistDraft(s),150));
}
function persistDraft(s){
 clearTimeout(localDraftTimers.get(s));localDraftTimers.delete(s);
 try{localStorage.setItem(draftKey(s),JSON.stringify({token,claimId:s.writer.claimId,baseRevision:s.writer.revision,answers:s.answers}))}
 catch{if(s===session)setGlobal('本機草稿無法儲存，請保持頁面開啟並通知老師。')}
}
function home(){
 if(session?.submitting)return;if(joining){cancelJoin('home');return}route('home');selectedGroup=null;stageMode=null;
 app.innerHTML='<div class="hero"><div class="hero-copy"><span class="eyebrow"><span class="everyday-only">OUR LITTLE WRITING STUDIO</span><span class="holiday-only">第十課・耶誕節 / WRITING STUDIO</span></span><h1>把一句話，<br>寫成<span>有畫面的故事。</span></h1><p>找到自己的座號，讓文字帶著讀者，<br>走進你筆下的那一刻。</p><button class="primary" onclick="stages()">開始寫作 ↗</button><div class="micro">01 小組共作　 /　 02 個人寫作　 /　 03 完整展示</div></div><div class="illustration everyday-art"><div class="orb"></div><div class="paper"><div class="paper-top">STORY NOTE ✦</div><h2>故事，從這裡開始。</h2><p>用位置、動作、對話與想法，<br>寫出有畫面的故事。</p><div class="fake-line"></div><div class="fake-line short"></div><span class="tag tag1">位置</span><span class="tag tag2">動作</span><span class="tag tag3">對話</span><span class="tag tag4">想法</span></div></div>'+HOLIDAY_ART+'</div><section class="bottom-strip">'+GUIDANCE.map(([label,hint])=>'<div><b>'+label+'</b><span>'+hint+'</span></div>').join('')+'</section>';
}
function seatGrid(a,b,teacher=false){return seatList(Array.from({length:b-a+1},(_,i)=>a+i),teacher)}
function seatList(numbers,teacher=false){
 return '<div class="seat-grid">'+numbers.map(n=>{
 const r=teacherRows.find(x=>x.seat===n);
 return '<button class="seat '+(teacher?(r?.status||'waiting'):'')+'" data-seat="'+n+'" '+(!teacher&&joining?'disabled':'')+' onclick="'+(teacher?'displayWork':'selectSeat')+'('+n+')"><strong>'+String(n).padStart(2,'0')+'</strong><span>'+(teacher?(workStatus(r)):n>27?'老師試填':'號')+'</span></button>';
 }).join('')+'</div>';
}
function observerSeats(){return '<h3>觀課老師體驗區 <small>28–40 · 直接試寫完整短文</small></h3>'+seatGrid(28,40)}
function isUpper(s){return s?.stage==='group'||s?.stage==='observer-group'}
function isObserver(s){return s?.stage==='observer'||s?.stage==='observer-group'}
function stageName(s){return s?.stage==='group'?'第一階段・小組共作':s?.stage==='individual'?'第二階段・個人寫作':s?.stage==='observer-group'?'觀課體驗・第一階段':'觀課體驗・第二階段'}
function checkItems(s){return isUpper(s)?[CHECKS[0],CHECKS[1],CHECKS[2],CHECKS[5]]:CHECKS}
function editableFields(s){return isUpper(s)?[0,1]:[2,3]}
function draftKey(s){return namespace+'two-stage:draft:'+s.stage+':'+s.seat}
function unsentKey(s){return namespace+'two-stage:unsent:'+s.stage+':'+s.seat}
function flowPayload(s,payload){return {...payload,flow:'two-stage',stage:s.stage,groupId:s.groupId,seat:s.stage==='group'?undefined:s.seat}}
function isLocalFile(){return globalThis.window?.location?.protocol==='file:'}
async function ensureFlow(signal){
 if(isLocalFile())throw Object.assign(new Error('目前開啟的是電腦中的 HTML 檔案，無法進行多平板同步。請改用正式寫作教室網址。'),{code:'LOCAL_FILE'});
 if(flowReady)return;
 let d;try{d=await rpc(CONFIG,{flow:'two-stage',action:'health'},{signal,retries:0,timeoutMs:15000})}catch(e){
  if(e.status===400||e.status===404)throw Object.assign(new Error('正式網站後端仍是舊版，尚未支援兩階段寫作。請通知老師完成本次完整部署後再開啟。'),{code:'OLD_BACKEND'});
  if(e.code==='REQUEST_TIMEOUT')throw new Error('確認網站的連線較慢，等待已超時。請重新嘗試，或通知老師檢查網路與部署狀態。');
  if(e.code==='NON_JSON_RESPONSE')throw e;
  if(!e.status&&!signal?.aborted)throw new Error('目前無法連上寫作服務。若在本機預覽，請改用正式網站；若已使用正式網址，請通知老師確認部署。');
  throw e;
 }
 if(d?.workflow!=='two-stage-v1')throw new Error('網站前後台版本尚未一致，請通知老師完成本次部署後再重新載入。');
 flowReady=true;
}
function stages(){
 if(session?.submitting||joining)return;route('stages');stageMode=null;selectedGroup=null;
 app.innerHTML='<div class="section-head"><div><span class="eyebrow">OUR WRITING JOURNEY</span><h1>一起開始，接著寫出自己的故事。</h1><p>依照老師的指示，選擇本次寫作階段。</p></div><button class="secondary" onclick="home()">← 返回首頁</button></div><div class="stage-grid"><button class="topic-card" onclick="chooseStage(\'group\')"><span class="eyebrow">第一階段</span><h2>小組共作</h2><p>一組使用一台平板，一起補寫前半段的「位置、動作」。</p><span>選擇小組 ↗</span></button><button class="topic-card" onclick="chooseStage(\'individual\')"><span class="eyebrow">第二階段</span><h2>個人寫作</h2><p>匯入小組共作的前半段，各自接寫「對話、想法」，完成整篇短文。</p><span>選擇組別與座號 ↗</span></button></div>'+observerSeats();
}
function chooseStage(mode){if(joining||session?.submitting||!['group','individual'].includes(mode))return;stageMode=mode;groups()}
function groups(){
 if(session?.submitting||joining)return;if(!['group','individual'].includes(stageMode)){stages();return}route('groups');selectedGroup=null;
 app.innerHTML='<div class="section-head"><div><span class="eyebrow">'+(stageMode==='group'?'第一階段・小組共作':'第二階段・個人寫作')+'</span><h1>請選擇你的組別。</h1><p>'+(stageMode==='group'?'小組共用一台平板，選完組別就開始寫作。':'先選組別，再選自己的座號。')+'</p></div><button class="secondary" onclick="stages()">← 返回階段</button></div><div class="group-grid">'+GROUPS.map(g=>'<button class="group-card secondary" data-group="'+g.id+'" onclick="selectGroup('+g.id+')"><strong>'+g.name+'</strong><span>'+g.seats.length+' 位小作家</span></button>').join('')+'</div>';
}
function selectGroup(id){
 if(joining||session?.submitting||!GROUPS.some(g=>g.id===id))return;selectedGroup=id;
 if(stageMode==='group')return joinTarget({stage:'group',groupId:id});if(stageMode==='individual')seats();
}
function seats(){
 if(session?.submitting||joining)return;const group=GROUPS.find(g=>g.id===selectedGroup);if(stageMode!=='individual'||!group){groups();return}route('seats');
 app.innerHTML='<div class="section-head"><div><span class="eyebrow">第二階段・個人寫作</span><h1>'+group.name+'，請選擇你的座號。</h1><p>匯入本組已繳交的前半段，再完成自己的後半段。</p></div><button class="secondary" onclick="groups()">← 返回組別</button></div><div id="student-group-seats">'+seatList(group.seats)+'</div>';
}
function selectSeat(n){
 if(joining||session?.submitting||!Number.isInteger(n))return;
 if(n>=28&&n<=40&&view==='stages')return joinTarget({stage:'observer-group',seat:n,groupId:-1});
 if(view==='seats'&&stageMode==='individual'&&GROUPS.find(g=>g.id===selectedGroup)?.seats.includes(n))return joinTarget({stage:'individual',seat:n,groupId:selectedGroup});
}
function showJoin(error=''){
 const local=isLocalFile();const t=lastJoinTarget,name=t.stage==='group'?GROUPS[t.groupId-1].name:t.seat+' 號';
 app.innerHTML='<div class="section-head"><div><span class="eyebrow">'+esc(name)+' · '+stageName(t)+'</span><h1>'+esc(getLesson().title)+'</h1></div></div><div class="connection-status" role="status">'+(error?esc(error):'文章已顯示，正在確認作品狀態；完成後即可填寫。')+'</div><div class="actions">'+(local?'<a class="primary" href="https://writers-classroom2.sn175970.workers.dev/">開啟正式寫作教室 ↗</a>':error?'<button class="primary" onclick="retryJoin()">重新嘗試</button>':'')+'<button class="secondary" onclick="cancelJoin()">← '+(error?'返回選擇':'取消並返回')+'</button></div>'+(!error&&!local?'<article class="display-paper join-preview" aria-label="文章預覽，確認後開放填寫">'+storyBlock(getLesson(),['＿＿＿＿','＿＿＿＿','＿＿＿＿','＿＿＿＿'],true,true)+'</article>':'');
}
async function joinTarget(target){
 if(joining||session?.submitting)return;
 route('loading');lastJoinTarget={...target};joining=true;showJoin();
 const attempt=++joinAttempt,controller=new AbortController();joinController=controller;
 const slow=setTimeout(()=>{if(attempt===joinAttempt&&joining){const el=document.querySelector('.connection-status');if(el)el.textContent='連線確認較慢，仍在處理中；你可以取消並返回。'}},4000);
 const deadline=setTimeout(()=>controller.abort(),25000);
 try{
  if(isLocalFile())await ensureFlow(controller.signal);
  const d=await rpc(CONFIG,{flow:'two-stage',action:'join',...target,token},{signal:controller.signal,retries:0,timeoutMs:12000});
  if(attempt!==joinAttempt||controller.signal.aborted)return;
  if(d.workflow!=='two-stage-v1')throw new Error('正式網站前後端版本尚未一致，請通知老師確認最新部署。');
  flowReady=true;
  if((isObserver(target)?!isObserver(d):d.stage!==target.stage||d.groupId!==target.groupId)||(target.stage!=='group'&&d.seat!==target.seat)||!['writing','submitted'].includes(d.status)||!Array.isArray(d.answers)||d.answers.length!==4||!Number.isInteger(d.revision)||typeof d.claimId!=='string')throw new Error('作品確認資料不完整，請重試；若仍無法進入，請通知老師檢查本次部署。');
  const s={stage:d.stage,seat:d.stage==='group'?d.groupId:d.seat,groupId:d.groupId,key:d.key,topic:3,answers:[...d.answers],checks:Array(checkItems(d).length).fill(false),submitted:d.status==='submitted',revising:!!d.isRevision,submitting:false,dirty:false,version:0,composing:false,pending:null,recovery:null,unsentBackup:null,retryAt:0,failures:0};
  s.writer=makeWriter(s,d);
  try{
   const old=JSON.parse(localStorage.getItem(draftKey(s))||'null');
   if(old?.token===token&&old.answers?.length===4&&JSON.stringify(old.answers)!==JSON.stringify(s.answers)){
    if(!s.submitted&&old.claimId===d.claimId&&old.baseRevision===d.revision){for(const i of editableFields(s))s.answers[i]=old.answers[i];s.dirty=true;s.version++}
    else if(!s.submitted)s.recovery=old;
    else if(old.claimId===d.claimId)s.unsentBackup=old;
   }
   const backup=JSON.parse(localStorage.getItem(unsentKey(s))||'null');if(backup?.token===token&&backup.claimId===d.claimId)s.unsentBackup=backup;
  }catch{}
  session=s;stageMode=d.stage;selectedGroup=d.groupId||null;joining=false;openWriting();
 }catch(e){
  if(attempt===joinAttempt){joining=false;showJoin(e.status?e.message:controller.signal.aborted?'連線等待超過時間，請檢查網路後重試，或先返回。':e.message)}
 }finally{
  clearTimeout(deadline);clearTimeout(slow);if(joinController===controller)joinController=null;
  if(attempt===joinAttempt&&joining){joining=false;showJoin('目前尚未確認連線，請重新嘗試。')}
 }
}
function retryJoin(){if(lastJoinTarget)return joinTarget(lastJoinTarget)}
function cancelJoin(destination='selection'){
 const t=lastJoinTarget;++joinAttempt;joinController?.abort();joinController=null;joining=false;
 if(destination==='home'){home();return}
 if(!t||isObserver(t)){stages();return}
 stageMode=t.stage;selectedGroup=t.groupId;
 if(t.stage==='individual')seats();else groups();
}
function makeWriter(s,row){return new ReliableWriter({claimId:row.claimId,revision:row.revision,send:body=>rpc(CONFIG,flowPayload(s,{...body,token}),{timeoutMs:12000}),onState:state=>{if(s!==session)return;if(state==='saving')setSync('正在同步草稿…');if(state==='submitting')setSync('正在繳交，請稍候…');if(state==='offline')setSync('尚未同步，文字保留在這台裝置。')}})}
function workStatus(r){const text=!r?'尚未進入':r.status==='submitted'?'已繳交':r.isRevision?'修改中':'寫作中';return r&&isObserver(r)?(isUpper(r)?'第一階段・':'第二階段・')+text:text}
function workDetail(r){return !r?'尚未進入':r.status==='submitted'?'✓ 已繳交':r.isRevision?'✎ 修改中（草稿）':'✎ 尚未繳交（草稿）'}
async function reopenWork(){
 const s=session;if(!s?.submitted||s.submitting||view!=='write')return;
 s.submitting=true;setWritingLocked(true);setGlobal('');
 const button=document.querySelector('.edit-button');if(button)button.textContent='正在開放修改…';
 s.reopenRequest ||= {action:'reopen',seat:s.seat,token,claimId:s.writer.claimId,revision:s.writer.revision,requestId:crypto.randomUUID()};
 try{
  const row=await rpc(CONFIG,flowPayload(s,s.reopenRequest));
  s.writer=makeWriter(s,row);s.answers=[...row.answers];s.topic=row.topic;s.submitted=false;s.revising=true;s.checks=Array(checkItems(s).length).fill(false);s.submitting=false;s.pending=null;s.reopenRequest=null;s.version=0;s.dirty=false;s.composing=false;s.recovery=null;s.retryAt=0;s.failures=0;
  persistDraft(s);openWriting(s.topic);setSync('修改中，完成後請重新檢核並更新繳交。');
 }catch(e){setGlobal(e.status?e.message:'尚未確認是否已開放修改，請保留本頁，再按一次「修改作品」重試。')}
 finally{s.submitting=false;if(s===session&&view==='write'){if(!s.submitted)setWritingLocked(false);const b=document.querySelector('.edit-button');if(b){b.disabled=false;b.textContent='修改作品'}}}
}
async function advanceObserver(){
 const s=session;if(!s||s.stage!=='observer-group'||!s.submitted||s.submitting||view!=='write')return;
 s.submitting=true;setWritingLocked(true);const button=document.querySelector('.advance-button');if(button){button.disabled=true;button.textContent='正在匯入前文…'}
 s.advanceRequest||={action:'advance',token,claimId:s.writer.claimId,revision:s.writer.revision,requestId:crypto.randomUUID()};
 try{const r=await rpc(CONFIG,flowPayload(s,s.advanceRequest));s.stage=r.stage;s.groupId=r.groupId;s.answers=[...r.answers];s.writer=makeWriter(s,r);s.submitted=false;s.submitting=false;s.revising=false;s.checks=Array(6).fill(false);s.pending=null;s.advanceRequest=null;s.version=0;s.dirty=false;s.recovery=null;s.unsentBackup=null;s.retryAt=0;s.failures=0;persistDraft(s);openWriting();}
 catch(e){setGlobal(e.status?e.message:'尚未確認第二階段是否已開啟，請保留本頁再試一次。')}
 finally{s.submitting=false;if(button&&s.stage==='observer-group'){button.disabled=false;button.textContent='匯入前文，進入第二階段 ↗'}}
}
function answerMark(label,text,plain=false){return '<mark class="answer-highlight'+(plain?' plain':'')+'" data-kind="'+esc(label)+'">'+story(text)+'</mark>'}
function displayAnswer(label,value,show=highlight){const text=value||'＿＿＿＿';const name=text.match(/^(小傑|小恩|小可|小娜|小琪)/);const first=name?name[0]:(Array.from(text)[0]||'');const rest=text.slice(first.length);return '<span class="display-answer" data-kind="'+esc(label)+'"><span class="display-answer-start"><span class="display-label" '+(show?'':'hidden')+'>'+esc(label)+'</span>'+answerMark(label,first,!show)+'</span>'+answerMark(label,rest,!show)+'</span>'}
function paragraph(lesson,answers,withLabels=false,show=highlight){return lesson.parts.map((p,i)=>story(p)+(i<4?(withLabels?displayAnswer(lesson.labels[i],answers[i],show):answerMark(lesson.labels[i],answers[i]||'＿＿＿＿')):'')).join('')}
function storyBlock(lesson,answers,withLabels=false,show=highlight){
 const count=Array.from(lesson.parts.map((p,i)=>p+(i<4?(answers[i]||''):'' )).join('')).length;
 const size=count>1600?24:count>1000?28:count>650?32:count>350?36:40;
 return '<div class="reading story-auto" data-story-length="'+count+'" style="--story-size:'+size+'px">'+paragraph(lesson,answers,withLabels,show)+'</div>';
}
function openWriting(){
 const s=session;if(!s||s.submitting||joining)return;route('write');const lesson=getLesson(),editable=editableFields(s),checks=checkItems(s),who=s.stage==='group'?GROUPS[s.groupId-1].name:s.seat+' 號';
 const back=s.stage==='group'?'groups()':s.stage==='individual'?'seats()':'stages()';
 const tip=s.stage==='observer-group'?'觀課體驗第一階段：先補寫「位置、動作」，下半段先閱讀。繳交後按「進入第二階段」，前文會自動保留。':s.stage==='observer'?'觀課體驗第二階段：已匯入你完成的前半段，請接著補寫「對話、想法」。':s.stage==='group'?'本階段共同填寫「位置、動作」。後半段先閱讀，第二階段再由每位同學填寫。':s.stage==='individual'?'前半段已匯入小組共作。本階段請各自補寫「對話、想法」，完成全文。':'觀課試寫可直接填寫四個欄位，不限字數。';
 app.innerHTML='<div class="section-head"><div><span class="eyebrow">'+esc(who)+' · '+stageName(s)+'</span><h1>'+esc(lesson.title)+'</h1></div><button class="secondary writing-back" onclick="'+back+'">← 返回'+(s.stage==='individual'?'座號':s.stage==='group'?'組別':'階段')+'</button></div>'+
 (s.recovery?'<div class="alert">找到這台裝置的未同步草稿。<button class="secondary" onclick="restoreDraft()">確認復原可編輯部分</button></div>':'')+
 '<div class="writing-tip">'+(s.submitted&&!isUpper(s)?(isObserver(s)?'已完成兩階段體驗，以下是你補寫的完整作品。':'已完成一篇完整短文，以下是小組共作與個人續寫合併後的作品。'):tip)+'</div>'+(s.submitted&&s.stage!=='group'?'<article class="display-paper">'+storyBlock(lesson,s.answers,true,true)+'</article>':'<article class="writing-paper">'+lesson.parts.map((p,i)=>story(p)+(i<4?'<label class="blank '+(!editable.includes(i)?'locked-blank':'')+'" data-kind="'+lesson.labels[i]+'"><span>'+lesson.labels[i]+'</span><textarea rows="1" data-index="'+i+'" aria-label="'+lesson.labels[i]+(!editable.includes(i)?'，本階段僅供閱讀':'')+'" '+(!editable.includes(i)?'aria-readonly="true" ':'')+'placeholder="'+esc(!editable.includes(i)&&isUpper(s)?'第二階段由每位同學填寫':lesson.hints[i])+'" '+(s.submitted||!editable.includes(i)?'disabled':'')+' oninput="editAnswer('+i+',this)" oncompositionstart="setComposing(true)" oncompositionend="finishComposing('+i+',this)">'+esc(s.answers[i])+'</textarea></label>':'')).join('')+'</article>')+
 (!s.submitted?'<fieldset class="self-check"><legend>自我檢核 <small>修改文字後，請重新檢查</small></legend><div class="check-grid">'+checks.map((label,i)=>'<label><input type="checkbox" '+(s.checks[i]?'checked':'')+' onchange="checkWork('+i+',this.checked)"><span>'+label+'</span></label>').join('')+'</div></fieldset>':'')+
 '<div class="submit-reminder" id="submit-reminder" role="alert" hidden></div><div class="actions writing-actions"><span class="save-note" id="sync-message" role="status">'+(s.submitted?'✓ 已成功繳交':s.dirty?'草稿保留中…':'已載入目前草稿')+'</span>'+
 (s.submitted?'<span class="success">✓ 已繳交</span><button class="secondary edit-button" onclick="reopenWork()">修改作品</button>':'<button class="secondary save-button" onclick="saveDraft()">儲存草稿</button><button class="primary submit-button" onclick="submitWork()">'+(s.revising?'更新繳交':isUpper(s)?(s.stage==='group'?'完成小組共作 ↗':'完成第一階段 ↗'):'完成，繳交作品 ↗')+'</button>')+'</div>'+
 (s.stage==='observer-group'&&s.submitted?'<div class="actions"><button class="primary advance-button" onclick="advanceObserver()">匯入前文，進入第二階段 ↗</button></div>':'')+
 (s.stage==='group'&&s.submitted?'<div class="actions"><button class="primary" onclick="chooseStage(\'individual\')">前往第二階段・個人寫作 ↗</button></div>':'')+
 (s.unsentBackup?'<details class="writing-preview"><summary>查看尚未成功繳交的修改</summary><div class="reading">'+paragraph(lesson,s.unsentBackup.answers,true,true)+'</div></details>':'')+
 (s.submitted&&s.stage!=='group'?'':'<details class="writing-preview" id="story-preview" ontoggle="refreshParagraph()"><summary>看看完整段落</summary><div class="reading" id="live-story"></div></details>');
 requestAnimationFrame(()=>document.querySelectorAll('.writing-paper textarea').forEach(fitWritingField));refreshParagraph();if(s.dirty)scheduleSave();
}
function fitWritingField(field){if(pendingResize.has(field))return;pendingResize.add(field);requestAnimationFrame(()=>{pendingResize.delete(field);if(field.isConnected===false)return;field.style.height='auto';field.style.height=Math.max(44,field.scrollHeight+2)+'px'})}
function editAnswer(i,field){
 const s=session;if(!s||s.submitted||s.submitting||!editableFields(s).includes(i))return;
 if(s.answers[i]===field.value){fitWritingField(field);return}
 const hadChecks=s.checks.some(Boolean);s.answers[i]=field.value;s.checks=Array(checkItems(s).length).fill(false);s.version++;s.dirty=true;
 if(hadChecks)document.querySelectorAll('.self-check input').forEach(el=>el.checked=false);document.getElementById('submit-reminder').hidden=true;
 fitWritingField(field);scheduleLocalDraft(s);setSync('草稿保留中…');scheduleSave();clearTimeout(previewTimer);previewTimer=setTimeout(refreshParagraph,120);
}
function finishComposing(i,field){if(session){session.composing=false;editAnswer(i,field);scheduleSave()}}
function setComposing(value){if(session){session.composing=value;if(!value)scheduleSave()}}
function checkWork(i,value){if(session&&!session.submitting){session.checks[i]=value;if(session.checks.every(Boolean))document.getElementById('submit-reminder').hidden=true}}
function refreshParagraph(){
 const preview=document.getElementById('story-preview');if(view!=='write'||!session||!preview?.open||previewPending)return;
 previewPending=true;requestAnimationFrame(()=>{previewPending=false;const current=document.getElementById('story-preview');if(view==='write'&&session&&current?.open)document.getElementById('live-story').innerHTML=paragraph(getLesson(session.topic),session.answers,true,true)});
}
function scheduleSave(){clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>{if(view==='write'&&session?.dirty&&!session.composing&&!session.submitting)void saveProgress(false,{automatic:true})},1800+Math.random()*1000)}
function reminder(text){const el=document.getElementById('submit-reminder');el.textContent=text;el.hidden=false;el.scrollIntoView({block:'nearest',behavior:'smooth'})}
function setWritingLocked(value){
 const s=session;document.querySelectorAll('.writing-paper textarea').forEach(el=>el.disabled=value||!!s?.submitted||!editableFields(s).includes(Number(el.dataset.index)));
 document.querySelectorAll('.self-check input,.writing-back,.save-button,.submit-button,.edit-button').forEach(el=>el.disabled=value);
 const b=document.querySelector('.submit-button');if(b)b.textContent=value?'正在繳交，請稍候…':s?.revising?'更新繳交':s?.stage==='group'?'完成小組共作 ↗':'完成，繳交作品 ↗';
}
async function saveProgress(submit=false,{automatic=false}={}){
 const s=session;if(!s||s.submitted)return;if(automatic&&(!s.dirty||s.retryAt>Date.now()||s.writer.conflict||globalThis.navigator?.onLine===false))return;if(s.composing){if(submit)reminder('請先完成目前的輸入，再按繳交。');return}
 if(submit&&!s.checks.every(Boolean)){reminder('請先完成本階段全部 '+checkItems(s).length+' 項自我檢核，勾選後再繳交喔。');return}
 if(submit&&editableFields(s).some(i=>!s.answers[i].trim())){reminder('還有空格沒有完成，請填好後再重新檢查喔。');return}
 const signature=s.version+':'+submit;if(s.pending?.signature===signature)return s.pending.promise;
 const snapshot={seat:s.seat,topic:s.topic,answers:[...s.answers],checks:[...s.checks]},version=s.version;
 if(submit){s.submitting=true;clearTimeout(autosaveTimer);setWritingLocked(true)}setGlobal('');
 persistDraft(s);
 const promise=s.writer.enqueue(snapshot,submit).then(result=>{
  s.retryAt=0;s.failures=0;
  if(version===s.version)s.dirty=false;
  if(result.status==='submitted'){
   if(!s.submitted){const confirmed=result.submittedSnapshot||snapshot;const different=confirmed.topic!==s.topic||JSON.stringify(confirmed.answers)!==JSON.stringify(s.answers);if(different){s.unsentBackup={token,claimId:s.writer.claimId,topic:s.topic,answers:[...s.answers]};persistDraft(s);try{localStorage.setItem(unsentKey(s),JSON.stringify(s.unsentBackup))}catch{}}else{try{localStorage.removeItem(draftKey(s))}catch{}}s.answers=[...confirmed.answers];s.topic=confirmed.topic;s.submitted=true;s.submitting=false;s.dirty=false;if(s===session&&view==='write'){openWriting(s.topic);if(different)setGlobal('先前的繳交已成功；較晚修改的內容仍保留在本機，下方可展開查看，請通知老師協助。')}}
  }else{persistDraft(s);if(s===session)setSync(s.dirty?'新內容保留中…':'✓ 草稿已同步')}
 }).catch(error=>{s.pending=null;s.failures++;s.retryAt=Date.now()+Math.min(30000,1500*2**Math.min(s.failures,5))+Math.random()*1000;if(s===session){setGlobal(error.message);setSync('尚未同步，文字保留在這台裝置。')}}).finally(()=>{
  if(submit){s.submitting=false;if(s===session&&view==='write'&&!s.submitted)setWritingLocked(false)}
 });
 s.pending={signature,promise};return promise;
}
function saveDraft(){return saveProgress(false)}
function submitWork(){return saveProgress(true)}
function restoreDraft(){
 const s=session;if(!s?.recovery||!confirm('要以這台裝置保留的草稿，取代目前這一題的內容嗎？'))return;
 for(const i of editableFields(s))s.answers[i]=s.recovery.answers[i];s.recovery=null;s.version++;s.dirty=true;s.checks=Array(checkItems(s).length).fill(false);persistDraft(s);openWriting(s.topic);
}
function teacherEntry(){
 if(session?.submitting||joining||view==='login')return;if(teacherPin){dashboard();return}route('login');
 app.innerHTML='<div class="login"><span class="eyebrow">TEACHER’S DESK</span><h1>教師控制台</h1><p>掌握小組共作與個人寫作進度，展示完整作品。</p><form onsubmit="loginTeacher(event)"><label>教師密碼<input id="teacher-pin" type="password" autocomplete="current-password" required></label><button class="primary" id="teacher-login-button">進入控制台 ↗</button></form><button class="text-btn" onclick="home()">← 返回首頁</button></div>';
}
async function loginTeacher(event){
 event.preventDefault();if(loginBusy)return;loginBusy=true;setGlobal('');const attempt=++loginAttempt,controller=new AbortController();loginController=controller;
 const button=document.getElementById('teacher-login-button');button.disabled=true;button.textContent='正在確認…';const pin=document.getElementById('teacher-pin').value;
 try{if(isLocalFile())await ensureFlow(controller.signal);const d=await rpc(CONFIG,{flow:'two-stage',action:'teacher',teacherPin:pin},{signal:controller.signal,retries:0});if(controller.signal.aborted||attempt!==loginAttempt||view!=='login')return;if(d.workflow!=='two-stage-v1')throw new Error('請先完成最新版本部署。');teacherPin=pin;teacherRows=d.rows;teacherGroups=d.groups;teacherFingerprint='';dashboard()}
 catch(e){if(!controller.signal.aborted&&attempt===loginAttempt&&view==='login'){setGlobal(e.message);button.disabled=false;button.textContent='進入控制台 ↗'}}
 finally{if(loginController===controller){loginController=null;loginBusy=false}}
}
function teacherGroupGrid(){return '<div class="group-grid">'+GROUPS.map(g=>{const r=teacherGroups.find(r=>r.groupId===g.id);return '<button class="group-card secondary seat '+(r?.status||'waiting')+'" data-teacher-group="'+g.id+'" onclick="displayGroup('+g.id+')"><strong>'+g.name+'</strong><span>'+workStatus(r)+'</span></button>'}).join('')+'</div>'}
function dashboard(){
 if(!teacherPin){teacherEntry();return}route('dashboard');
 const done=teacherRows.filter(r=>r.seat<=27&&r.status==='submitted').length,writing=teacherRows.filter(r=>r.seat<=27&&r.status!=='submitted').length;
 app.innerHTML='<div class="dashboard-heading"><div><span class="eyebrow">TEACHER’S DESK</span><h1>每一個故事，正在發生。</h1><p>點選小組或座號展示作品，約每 4 秒同步。</p></div><div class="header-actions"><button class="secondary" onclick="home()">← 返回首頁</button><button class="secondary" onclick="refreshTeacher()">↻ 更新</button><button class="secondary" onclick="downloadWorks()">下載作品備份</button></div></div><div id="teacher-status" class="teacher-status" role="status"></div><h3>第一階段・小組共作 <small><span id="count-groups">'+teacherGroups.filter(r=>r.status==='submitted').length+'</span> / 7 已繳交</small></h3>'+teacherGroupGrid()+
 '<h3>第二階段・個人寫作</h3><div class="stats"><div><strong><span id="count-submitted">'+done+'</span><small> / 27</small></strong><span>學生已繳交</span></div><div><strong id="count-writing">'+writing+'</strong><span>學生寫作中</span></div><div><strong id="count-waiting">'+(27-done-writing)+'</strong><span>尚未進入</span></div><div><strong><span id="count-observers">'+teacherRows.filter(r=>r.stage==='observer'&&r.status==='submitted').length+'</span><small> / 13</small></strong><span>觀課老師已繳交</span></div></div>'+seatGrid(1,27,true)+'<h3>觀課老師體驗區</h3>'+seatGrid(28,40,true);
 startTeacherPolling();
}
function selectedRecord(){return selectedTeacherGroup?teacherGroups.find(r=>r.groupId===selectedTeacherGroup):teacherRows.find(r=>r.seat===selectedTeacherSeat)}
function displayWork(n){if(!teacherPin){teacherEntry();return}selectedTeacherSeat=n;selectedTeacherGroup=null;renderTeacherDisplay()}
function displayGroup(id){if(!teacherPin){teacherEntry();return}selectedTeacherGroup=id;renderTeacherDisplay()}
function renderTeacherDisplay(){
 route('display');const r=selectedRecord(),isGroup=!!selectedTeacherGroup,n=isGroup?selectedTeacherGroup:selectedTeacherSeat,who=isGroup?GROUPS[n-1].name:String(n).padStart(2,'0')+' 號';displayedKey=teacherRowKey(r);
 app.innerHTML='<div class="section-head"><div><span class="eyebrow">'+(isGroup?'第一階段・小組共作':n>27?'觀課老師作品':'小作家的完整作品')+'</span><h1 id="teacher-work-title"><span class="seat-badge">'+who+'</span> '+esc(getLesson().title)+'</h1></div><button class="secondary" onclick="dashboard()">返回控制台</button></div><div class="display-tools"><span id="teacher-work-status">'+workDetail(r)+'</span><label><input type="checkbox" '+(highlight?'checked':'')+' onchange="toggleHighlight(this.checked)"> 標示填寫內容</label><button class="text-btn" onclick="toggleFullScreen()">⤢ 全螢幕</button></div><div id="teacher-status" class="teacher-status" role="status"></div><article class="display-paper" id="teacher-story">'+(r?storyBlock(getLesson(),r.answers,true):'<div class="empty">還沒有開始寫作。</div>')+'</article><div class="actions"><button class="secondary" '+(n===1?'disabled':'')+' onclick="'+(isGroup?'displayGroup':'displayWork')+'('+(n-1)+')">← 上一'+(isGroup?'組':'號')+'</button><span>'+n+' / '+(isGroup?7:40)+'</span><button class="primary" '+(n===(isGroup?7:40)?'disabled':'')+' onclick="'+(isGroup?'displayGroup':'displayWork')+'('+(n+1)+')">下一'+(isGroup?'組':'號')+' →</button></div><button id="release-seat" class="text-btn release" '+(r?'':'hidden')+' onclick="'+(isGroup?'releaseGroup':'releaseSeat')+'('+n+')">'+(isGroup?'清除此組共作':n>27?'清除此份觀課作品':'解除裝置並清除此份作品')+'</button>';
 startTeacherPolling();
}
function teacherRowKey(r){return r?[r.key,r.claimId,r.revision,r.status].join(':'):'none'}
function updateTeacherUI(){
 if(view==='dashboard'){
  const done=teacherRows.filter(r=>r.seat<=27&&r.status==='submitted').length,writing=teacherRows.filter(r=>r.seat<=27&&r.status!=='submitted').length;
  const values={'count-submitted':done,'count-writing':writing,'count-waiting':27-done-writing,'count-observers':teacherRows.filter(r=>r.seat>27&&r.status==='submitted').length,'count-groups':teacherGroups.filter(r=>r.status==='submitted').length};
  for(const [id,value] of Object.entries(values)){const el=document.getElementById(id);if(el)el.textContent=String(value)}
  document.querySelectorAll('.seat[data-seat],.seat[data-teacher-group]').forEach(button=>{
   const r=button.dataset.teacherGroup?teacherGroups.find(row=>row.groupId===Number(button.dataset.teacherGroup)):teacherRows.find(row=>row.seat===Number(button.dataset.seat));
   button.classList.toggle('submitted',r?.status==='submitted');button.classList.toggle('writing',!!r&&r.status!=='submitted');button.classList.toggle('waiting',!r);const label=button.querySelector('span');if(label)label.textContent=workStatus(r);
  });
 }else if(view==='display'){
  const r=selectedRecord(),key=teacherRowKey(r);if(key===displayedKey)return;displayedKey=key;
  const status=document.getElementById('teacher-work-status'),paper=document.getElementById('teacher-story'),release=document.getElementById('release-seat');if(status)status.textContent=workDetail(r);if(paper)paper.innerHTML=r?storyBlock(getLesson(),r.answers,true):'<div class="empty">還沒有開始寫作。</div>';if(release)release.hidden=!r;
 }
}
function toggleHighlight(value){highlight=value;document.querySelectorAll('.reading mark').forEach(el=>el.classList.toggle('plain',!value));document.querySelectorAll('.display-label').forEach(el=>el.hidden=!value)}
async function toggleFullScreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{setGlobal('此裝置不支援全螢幕，可直接使用目前展示畫面。')}}
function stopTeacherPolling(){clearTimeout(teacherTimer);teacherController?.abort();teacherController=null}
function startTeacherPolling(){clearTimeout(teacherTimer);if(!teacherPin||!['dashboard','display'].includes(view))return;teacherTimer=setTimeout(async()=>{if(!document.hidden)await refreshTeacher();else startTeacherPolling()},document.hidden?4000:Math.max(300,3900+Math.random()*400-(teacherPollStarted?Date.now()-teacherPollStarted:0)))}
async function refreshTeacher(){
 if(!teacherPin||!['dashboard','display'].includes(view))return;if(teacherPromise)return teacherPromise;
 const controller=new AbortController();teacherController=controller;teacherPollStarted=Date.now();
 teacherPromise=(async()=>{
  try{
   const knownRecords=[...teacherRows,...teacherGroups].map(r=>({key:r.key,claimId:r.claimId,revision:r.revision,status:r.status}));
   const d=await rpc(CONFIG,{flow:'two-stage',action:'teacher',teacherPin,knownRecords},{signal:controller.signal,retries:0});
   if(controller.signal.aborted||!['dashboard','display'].includes(view))return;
   const merged=d.delta?new Map([...teacherRows,...teacherGroups].filter(r=>d.keys.includes(r.key)).map(r=>[r.key,r])):new Map();for(const r of [...d.rows,...d.groups])merged.set(r.key,r);
   teacherRows=[...merged.values()].filter(r=>r.stage!=='group').sort((a,b)=>a.seat-b.seat);teacherGroups=[...merged.values()].filter(r=>r.stage==='group').sort((a,b)=>a.groupId-b.groupId);
   const fingerprint=JSON.stringify([...teacherRows,...teacherGroups].map(teacherRowKey));if(fingerprint!==teacherFingerprint){teacherFingerprint=fingerprint;updateTeacherUI()}
   const status=document.getElementById('teacher-status');if(status)status.textContent='✓ 最近同步 '+new Date().toLocaleTimeString('zh-TW',{hour12:false,timeZone:'Asia/Taipei'});
  }catch(e){if(!controller.signal.aborted){const status=document.getElementById('teacher-status');if(status)status.textContent='更新暫時失敗，保留上次資料。可按更新重試。'}}
  finally{teacherPromise=null;startTeacherPolling()}
 })();return teacherPromise;
}
async function releaseRecord(r){
 if(!r)return;const text=r.stage==='group'?'這會清除此組的共作紀錄，但不會刪除已匯入的個人作品。確定繼續？':'解除會清除此份作品，讓另一台裝置重新進入。確定繼續？';if(!confirm(text))return;
 try{await rpc(CONFIG,flowPayload(r,{action:'release',claimId:r.claimId,teacherPin}));await refreshTeacher()}catch(e){setGlobal(e.message)}
}
function releaseSeat(n){return releaseRecord(teacherRows.find(r=>r.seat===n))}
function releaseGroup(id){return releaseRecord(teacherGroups.find(r=>r.groupId===id))}
function toggleChristmas(){const value=document.body.classList.toggle('christmas');document.getElementById('theme-toggle').textContent=value?'切回原版':'試試耶誕風'}
window.addEventListener('beforeunload',e=>{if(session?.dirty){persistDraft(session);e.preventDefault();e.returnValue=''}});
window.addEventListener('pagehide',()=>{if(session?.dirty)persistDraft(session)});
window.addEventListener('online',()=>{if(session)session.retryAt=0;setTimeout(()=>{if(view==='write'&&session?.dirty&&!session.composing&&!session.submitting)void saveProgress(false,{automatic:true})},Math.random()*1500);if(['dashboard','display'].includes(view))void refreshTeacher()});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&session?.dirty)persistDraft(session);if(!document.hidden&&['dashboard','display'].includes(view))void refreshTeacher()});
setInterval(()=>{if(view==='write'&&session?.dirty&&!session.composing&&!session.submitting)void saveProgress(false,{automatic:true})},6500+Math.random()*2500);

async function downloadWorks(){
 try{
  const d=await rpc(CONFIG,{flow:'two-stage',action:'teacher',teacherPin,includeLegacy:true},{retries:0});
  const complete=r=>getLesson().parts.map((p,i)=>p+(i<4?(r.answers[i]||'＿＿＿＿'):'')).join('');
  const blocks=[...d.groups.map(r=>'【'+GROUPS[r.groupId-1].name+'・小組共作】\n'+workDetail(r)+'\n'+complete(r)),...d.rows.map(r=>'【'+String(r.seat).padStart(2,'0')+' 號・'+(isObserver(r)?stageName(r):GROUPS[r.groupId-1].name+'・個人寫作')+'】\n'+workDetail(r)+'\n'+complete(r))];
  if(d.legacyRows?.length)blocks.push('【先前版本作品保留區】\n'+d.legacyRows.map(r=>'【'+r.seat+' 號】'+r.title+'\n'+r.parts.map((p,i)=>p+(i<4?(r.answers[i]||'＿＿＿＿'):'')).join('')).join('\n\n'));
  const text='小作家・兩階段寫作備份\n下載時間：'+new Date().toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})+'\n\n'+blocks.join('\n\n--------------------\n\n');
  const link=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));link.href=url;link.download='小作家_兩階段寫作_'+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date())+'.txt';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(e){setGlobal(e.message)}
}
Object.assign(window,{advanceObserver,downloadWorks,home,stages,chooseStage,groups,selectGroup,seats,selectSeat,retryJoin,cancelJoin,openWriting,editAnswer,setComposing,finishComposing,checkWork,refreshParagraph,saveDraft,submitWork,reopenWork,restoreDraft,teacherEntry,loginTeacher,dashboard,displayWork,displayGroup,toggleHighlight,toggleFullScreen,refreshTeacher,releaseSeat,releaseGroup,toggleChristmas});
home();

