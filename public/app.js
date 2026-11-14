import {CONFIG} from './config.js';
import {LESSONS} from './lessons.js';
import {HOLIDAY_ART} from './holiday-art.js';
import {ReliableWriter} from './reliable-writer.js';
import {rpc,validateConfig} from './transport.js';

const app=document.getElementById('app'),globalMessage=document.getElementById('global-message');
const CHECKS=['確認沒有錯字','文句通順','句子和前後句連接通順','符合題目'];
const GUIDANCE=[['位置','人物在哪裡？和其他人或物品有什麼位置關係？'],['動作','人物做了哪些動作？能不能寫出連續的動作？'],['對話','人物會說什麼？怎麼說才能表現當下的情緒？'],['想法','人物心裡在想什麼？有什麼擔心、期待或疑問？']];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const story=s=>esc(s).replace(/小傑|小恩|小可|小娜|小琪/g,n=>'<span class="proper-name">'+n+'</span>');
const namespace='little-writer:'+CONFIG.storageNamespace+':';
let token='',view='home',session=null,joining=false,teacherPin='',teacherRows=[],selectedTeacherSeat=1,highlight=true;
let autosaveTimer,teacherTimer,teacherController,teacherPromise=null,teacherFingerprint='',loginBusy=false;
try{token=localStorage.getItem(namespace+'device')||crypto.randomUUID();localStorage.setItem(namespace+'device',token)}catch{token=crypto.randomUUID();setGlobal('這台裝置無法保存草稿，請保持畫面開啟並通知老師。')}
function setGlobal(message=''){globalMessage.textContent=message;globalMessage.hidden=!message}
function setSync(text){if(view==='write'){const el=document.getElementById('sync-message');if(el)el.textContent=text}}
function route(next){if(session?.submitting||joining)return;clearTimeout(autosaveTimer);if(!['dashboard','display'].includes(next))stopTeacherPolling();setGlobal('');view=next}
function getLesson(id){return LESSONS.find(x=>x.id===id)||LESSONS[0]}
function persistDraft(s){
 try{localStorage.setItem(namespace+'draft:'+s.seat+':'+s.topic,JSON.stringify({token,claimId:s.writer.claimId,baseRevision:s.writer.revision,answers:s.answers}))}
 catch{if(s===session)setGlobal('本機草稿無法儲存，請保持頁面開啟並通知老師。')}
}
function cachedDraft(seat,topic){try{return JSON.parse(localStorage.getItem(namespace+'draft:'+seat+':'+topic)||'null')}catch{return null}}
function home(){
 if(session?.submitting||joining)return;route('home');
 app.innerHTML='<div class="hero"><div class="hero-copy"><span class="eyebrow"><span class="everyday-only">OUR LITTLE WRITING STUDIO</span><span class="holiday-only">第十課・耶誕節 / WRITING STUDIO</span></span><h1>把一句話，<br>寫成<span>有畫面的故事。</span></h1><p>找到自己的座號，讓文字帶著讀者，<br>走進你筆下的那一刻。</p><button class="primary" onclick="seats()">開始寫作 ↗</button><div class="micro">01 選擇座號　 /　 02 選擇題目　 /　 03 完成並繳交</div></div><div class="illustration everyday-art"><div class="orb"></div><div class="paper"><div class="paper-top">STORY NOTE ✦</div><h2>故事，從這裡開始。</h2><p>用位置、動作、對話與想法，<br>寫出有畫面的故事。</p><div class="fake-line"></div><div class="fake-line short"></div><span class="tag tag1">位置</span><span class="tag tag2">動作</span><span class="tag tag3">對話</span><span class="tag tag4">想法</span></div></div>'+HOLIDAY_ART+'</div><section class="bottom-strip">'+GUIDANCE.map(([label,hint])=>'<div><b>'+label+'</b><span>'+hint+'</span></div>').join('')+'</section>';
}
function seatGrid(a,b,teacher=false){
 return '<div class="seat-grid">'+Array.from({length:b-a+1},(_,i)=>a+i).map(n=>{
 const r=teacherRows.find(x=>x.seat===n);
 return '<button class="seat '+(teacher?(r?.status||'waiting'):'')+'" '+(!teacher&&joining?'disabled':'')+' onclick="'+(teacher?'displayWork':'selectSeat')+'('+n+')"><strong>'+String(n).padStart(2,'0')+'</strong><span>'+(teacher?(r?.status==='submitted'?'已繳交':r?'寫作中':'尚未進入'):n>27?'老師試填':'號')+'</span></button>';
 }).join('')+'</div>';
}
function seats(){
 if(session?.submitting||joining)return;route('seats');
 app.innerHTML='<div class="section-head"><div><span class="eyebrow">STEP 01 · FIND YOUR SEAT</span><h1>今天，你是幾號作家？</h1><p>請選擇自己的座號，一起開始寫故事。</p></div><button class="secondary" onclick="home()">← 返回首頁</button></div><div id="joining-status" class="connection-status" role="status" hidden></div><h3>同學座號 <small>01–27</small></h3>'+seatGrid(1,27)+'<h3>觀課老師體驗區 <small>28–35 · 不列入學生統計</small></h3>'+seatGrid(28,35);
}
async function selectSeat(n){
 if(joining)return;
 try{validateConfig(CONFIG)}catch(e){setGlobal(e.message);return}
 joining=true;setGlobal('');document.querySelectorAll('.seat').forEach(el=>el.disabled=true);const status=document.getElementById('joining-status');status.hidden=false;status.textContent='正在確認座號，請稍候…';
 try{
  const d=await rpc(CONFIG,{action:'join',seat:n,token});
  const s={seat:n,topic:d.topic,answers:d.answers.length===4?d.answers:['','','',''],checks:[false,false,false,false],submitted:d.status==='submitted',submitting:false,dirty:false,version:0,composing:false,pending:null,recovery:null,unsentBackup:null};
  s.writer=new ReliableWriter({claimId:d.claimId,revision:d.revision,send:body=>rpc(CONFIG,{...body,seat:n,token}),onState:state=>{if(s!==session)return;if(state==='saving')setSync('正在同步草稿…');if(state==='submitting')setSync('正在繳交，請稍候…');if(state==='offline')setSync('尚未同步，文字保留在這台裝置。')}});
  const old=cachedDraft(n,d.topic);
  if(!s.submitted&&old?.token===token&&Array.isArray(old.answers)&&old.answers.length===4&&JSON.stringify(old.answers)!==JSON.stringify(s.answers)){
   if(old.claimId===d.claimId&&old.baseRevision===d.revision){s.answers=old.answers;s.dirty=true;s.version++}else s.recovery=old;
  }
  if(s.submitted&&old?.token===token&&old.claimId===d.claimId&&old.answers?.length===4&&JSON.stringify(old.answers)!==JSON.stringify(s.answers))s.unsentBackup=old;
  try{const backup=JSON.parse(localStorage.getItem(namespace+'unsent:'+n)||'null');if(s.submitted&&backup?.token===token&&backup.claimId===d.claimId)s.unsentBackup=backup}catch{}
  session=s;joining=false;if(s.submitted)openWriting(d.topic);else chooseTopic();
 }catch(e){joining=false;setGlobal(e.message);document.querySelectorAll('.seat').forEach(el=>el.disabled=false);status.hidden=true}
}
function chooseTopic(){
 if(!session||session.submitting)return;
 route('topics');if(session.submitted){openWriting(session.topic);return}
 app.innerHTML='<div class="section-head"><div><span class="eyebrow">'+session.seat+' 號 · STEP 02</span><h1>選一個故事，開始寫作。</h1><p>選擇一個題目，完成位置、動作、對話與想法。填空字數不限。</p></div><button class="secondary" onclick="seats()">← 返回座號</button></div><div class="topic-grid">'+LESSONS.map(l=>'<button class="topic-card" onclick="openWriting('+l.id+')"><span class="eyebrow">題目 0'+l.id+'</span><h2>'+esc(l.title)+'</h2><p>'+story(l.parts[0])+'……</p><span>選擇這個故事 ↗</span></button>').join('')+'</div>';
}
function paragraph(lesson,answers){return lesson.parts.map((p,i)=>story(p)+(i<4?'<mark class="'+(highlight?'':'plain')+'">'+story(answers[i]||'＿＿＿＿')+'</mark>':'')).join('')}
function openWriting(topic){
 const s=session;if(!s||s.submitting)return;
 if(s.submitted)topic=s.topic;
 if(topic!==s.topic){
  persistDraft(s);const c=cachedDraft(s.seat,topic);
  s.topic=topic;s.answers=c?.token===token&&c.claimId===s.writer.claimId&&c.answers?.length===4?c.answers:['','','',''];s.checks=[false,false,false,false];s.dirty=true;s.version++;s.recovery=null;
 }
 route('write');const lesson=getLesson(s.topic);
 app.innerHTML='<div class="section-head"><div><span class="eyebrow">'+s.seat+' 號 · '+(s.seat>27?'觀課老師體驗':'我的寫作練習')+'</span><h1>'+esc(lesson.title)+'</h1></div><button class="secondary writing-back" onclick="'+(s.submitted?'seats()':'chooseTopic()')+'">← '+(s.submitted?'返回座號':'返回題目選擇')+'</button></div>'+
 (s.recovery?'<div class="alert">找到版本不同的本機草稿，尚未覆蓋目前作品。<button class="secondary" onclick="restoreDraft()">確認復原本機草稿</button></div>':'')+
 '<div class="writing-tip">依序完成四個空格，字數不限。</div><article class="writing-paper">'+lesson.parts.map((p,i)=>story(p)+(i<4?'<label class="blank" data-kind="'+lesson.labels[i]+'"><span>'+lesson.labels[i]+'</span><textarea rows="1" aria-label="'+lesson.labels[i]+'" placeholder="'+esc(lesson.hints[i])+'" '+(s.submitted?'disabled':'')+' oninput="editAnswer('+i+',this)" oncompositionstart="setComposing(true)" oncompositionend="setComposing(false)">'+esc(s.answers[i])+'</textarea></label>':'')).join('')+'</article>'+
 (!s.submitted?'<fieldset class="self-check"><legend>自我檢核 <small>修改文字後，請重新檢查</small></legend><div class="check-grid">'+CHECKS.map((label,i)=>'<label><input type="checkbox" '+(s.checks[i]?'checked':'')+' onchange="checkWork('+i+',this.checked)"><span>'+label+'</span></label>').join('')+'</div></fieldset>':'')+
 '<div class="submit-reminder" id="submit-reminder" role="alert" hidden></div><div class="actions writing-actions"><span class="save-note" id="sync-message" role="status">'+(s.submitted?'✓ 已成功繳交':s.dirty?'草稿保留中…':'草稿已同步')+'</span>'+
 (s.submitted?'<span class="success">✓ 已繳交</span>':'<button class="secondary save-button" onclick="saveDraft()">儲存草稿</button><button class="primary submit-button" onclick="submitWork()">完成，繳交作品 ↗</button>')+
 '</div>'+(s.unsentBackup?'<details class="writing-preview"><summary>查看本機未繳交的修改</summary><div class="reading">'+paragraph(getLesson(s.unsentBackup.topic||s.topic),s.unsentBackup.answers)+'</div></details>':'')+'<details class="writing-preview" id="story-preview" ontoggle="refreshParagraph()"><summary>看看我的完整段落</summary><div class="reading" id="live-story"></div></details>';
 requestAnimationFrame(()=>document.querySelectorAll('.writing-paper textarea').forEach(fitWritingField));refreshParagraph();if(s.dirty)scheduleSave();
}
function fitWritingField(field){field.style.height='auto';field.style.height=Math.max(44,field.scrollHeight+2)+'px'}
function editAnswer(i,field){
 const s=session;if(!s||s.submitted||s.submitting)return;
 s.answers[i]=field.value;s.checks=[false,false,false,false];s.version++;s.dirty=true;
 document.querySelectorAll('.self-check input').forEach(el=>el.checked=false);document.getElementById('submit-reminder').hidden=true;
 fitWritingField(field);persistDraft(s);setSync('草稿保留中…');scheduleSave();refreshParagraph();
}
function setComposing(value){if(session){session.composing=value;if(!value)scheduleSave()}}
function checkWork(i,value){if(session&&!session.submitting){session.checks[i]=value;if(session.checks.every(Boolean))document.getElementById('submit-reminder').hidden=true}}
function refreshParagraph(){const preview=document.getElementById('story-preview');if(view==='write'&&session&&preview?.open)document.getElementById('live-story').innerHTML=paragraph(getLesson(session.topic),session.answers)}
function scheduleSave(){clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>{if(view==='write'&&session?.dirty&&!session.composing&&!session.submitting)void saveProgress(false)},1800+Math.random()*350)}
function reminder(text){const el=document.getElementById('submit-reminder');el.textContent=text;el.hidden=false;el.scrollIntoView({block:'nearest',behavior:'smooth'})}
function setWritingLocked(value){
 document.querySelectorAll('.writing-paper textarea,.self-check input,.writing-back,.save-button,.submit-button').forEach(el=>el.disabled=value);
 const b=document.querySelector('.submit-button');if(b)b.textContent=value?'正在繳交，請稍候…':'完成，繳交作品 ↗';
}
async function saveProgress(submit=false){
 const s=session;if(!s||s.submitted)return;if(s.composing){if(submit)reminder('請先完成目前的輸入，再按繳交。');return}
 if(submit&&!s.checks.every(Boolean)){reminder('請先完成上方四項自我檢核，全部勾選後再繳交喔。');return}
 if(submit&&s.answers.some(x=>!x.trim())){reminder('還有空格沒有完成，請填好後再重新檢查喔。');return}
 const signature=s.version+':'+submit;if(s.pending?.signature===signature)return s.pending.promise;
 const snapshot={seat:s.seat,topic:s.topic,answers:[...s.answers],checks:[...s.checks]},version=s.version;
 if(submit){s.submitting=true;clearTimeout(autosaveTimer);setWritingLocked(true)}setGlobal('');
 const promise=s.writer.enqueue(snapshot,submit).then(result=>{
  if(version===s.version)s.dirty=false;
  if(result.status==='submitted'){
   if(!s.submitted){const confirmed=result.submittedSnapshot||snapshot;const different=confirmed.topic!==s.topic||JSON.stringify(confirmed.answers)!==JSON.stringify(s.answers);if(different){s.unsentBackup={token,claimId:s.writer.claimId,topic:s.topic,answers:[...s.answers]};persistDraft(s);try{localStorage.setItem(namespace+'unsent:'+s.seat,JSON.stringify(s.unsentBackup))}catch{}}else{try{localStorage.removeItem(namespace+'draft:'+s.seat+':'+snapshot.topic)}catch{}}s.answers=[...confirmed.answers];s.topic=confirmed.topic;s.submitted=true;s.submitting=false;s.dirty=false;if(s===session&&view==='write'){openWriting(s.topic);if(different)setGlobal('先前的繳交已成功；較晚修改的內容仍保留在本機，下方可展開查看，請通知老師協助。')}}
  }else{persistDraft(s);if(s===session)setSync(s.dirty?'新內容保留中…':'✓ 草稿已同步')}
 }).catch(error=>{s.pending=null;if(s===session){setGlobal(error.message);setSync('尚未同步，文字保留在這台裝置。')}}).finally(()=>{
  if(submit){s.submitting=false;if(s===session&&view==='write'&&!s.submitted)setWritingLocked(false)}
 });
 s.pending={signature,promise};return promise;
}
function saveDraft(){return saveProgress(false)}
function submitWork(){return saveProgress(true)}
function restoreDraft(){
 const s=session;if(!s?.recovery||!confirm('要以這台裝置保留的草稿，取代目前這一題的內容嗎？'))return;
 s.answers=s.recovery.answers;s.recovery=null;s.version++;s.dirty=true;s.checks=[false,false,false,false];persistDraft(s);openWriting(s.topic);
}
function teacherEntry(){
 if(session?.submitting||joining)return;if(teacherPin){dashboard();return}route('login');
 app.innerHTML='<div class="login"><span class="eyebrow">TEACHER’S DESK</span><h1>教師控制台</h1><p>掌握寫作進度，展示學生的完整作品。</p><form onsubmit="loginTeacher(event)"><label>教師密碼<input id="teacher-pin" type="password" autocomplete="current-password" required></label><button class="primary" id="teacher-login-button">進入控制台 ↗</button></form><button class="text-btn" onclick="home()">← 返回首頁</button></div>';
}
async function loginTeacher(event){
 event.preventDefault();if(loginBusy)return;loginBusy=true;setGlobal('');const button=document.getElementById('teacher-login-button');button.disabled=true;button.textContent='正在確認…';
 const pin=document.getElementById('teacher-pin').value;
 try{const data=await rpc(CONFIG,{action:'teacher',teacherPin:pin},{retries:0});teacherPin=pin;teacherRows=data.rows;teacherFingerprint='';dashboard()}catch(e){setGlobal(e.message);button.disabled=false;button.textContent='進入控制台 ↗'}finally{loginBusy=false}
}
function dashboard(){
 if(!teacherPin){teacherEntry();return}route('dashboard');
 const done=teacherRows.filter(r=>r.seat<=27&&r.status==='submitted').length,writing=teacherRows.filter(r=>r.seat<=27&&r.status!=='submitted').length;
 app.innerHTML='<div class="dashboard-heading"><div><span class="eyebrow">TEACHER’S DESK</span><h1>每一個故事，都在發生。</h1><p>點選座號展示作品。連線正常時約每 4 秒更新。</p></div><div class="header-actions"><button class="secondary" onclick="home()">← 返回首頁</button><button class="secondary" onclick="refreshTeacher()">↻ 更新</button><button class="secondary" onclick="downloadWorks()">下載作品備份</button></div></div><div id="teacher-status" class="teacher-status" role="status"></div><div class="stats"><div><strong>'+done+'<small> / 27</small></strong><span>學生已繳交</span></div><div><strong>'+writing+'</strong><span>學生寫作中</span></div><div><strong>'+(27-done-writing)+'</strong><span>尚未進入</span></div><div><strong>'+teacherRows.filter(r=>r.seat>27&&r.status==='submitted').length+'<small> / 8</small></strong><span>觀課老師已繳交</span></div></div>'+seatGrid(1,27,true)+'<h3>觀課老師體驗區</h3>'+seatGrid(28,35,true);
 startTeacherPolling();
}
function displayWork(n){
 if(!teacherPin){teacherEntry();return}selectedTeacherSeat=n;route('display');const r=teacherRows.find(x=>x.seat===n),lesson=getLesson(r?.topic);
 app.innerHTML='<div class="section-head"><div><span class="eyebrow">'+(n>27?'觀課老師作品':'小小作家的作品')+'</span><h1><span class="seat-badge">'+String(n).padStart(2,'0')+' 號</span> '+(r?esc(lesson.title):'等待選擇題目')+'</h1></div><button class="secondary" onclick="dashboard()">返回座號總覽</button></div><div class="display-tools"><span>'+(r?(r.status==='submitted'?'✓ 已繳交':'✎ 尚未繳交（草稿）'):'尚未進入')+'</span><label><input type="checkbox" '+(highlight?'checked':'')+' onchange="toggleHighlight(this.checked)"> 標示填寫內容</label><button class="text-btn" onclick="toggleFullScreen()">⛶ 全螢幕</button></div><div id="teacher-status" class="teacher-status" role="status"></div><article class="display-paper">'+(r?'<div class="reading">'+paragraph(lesson,r.answers)+'</div>':'<div class="empty">這位作家還沒有開始寫作。</div>')+'</article><div class="actions"><button class="secondary" '+(n===1?'disabled':'')+' onclick="displayWork('+(n-1)+')">← 上一號</button><span>'+n+' / 35</span><button class="primary" '+(n===35?'disabled':'')+' onclick="displayWork('+(n+1)+')">下一號 →</button></div>'+(r?'<button class="text-btn release" onclick="releaseSeat('+n+')">解除此座號並清除作答</button>':'');
 startTeacherPolling();
}
function toggleHighlight(value){highlight=value;document.querySelectorAll('.reading mark').forEach(el=>el.classList.toggle('plain',!value))}
async function toggleFullScreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{setGlobal('此裝置不支援全螢幕，可以直接使用目前展示畫面。')}}
function stopTeacherPolling(){clearTimeout(teacherTimer);teacherController?.abort();teacherController=null}
function startTeacherPolling(){clearTimeout(teacherTimer);if(!teacherPin||!['dashboard','display'].includes(view))return;teacherTimer=setTimeout(async()=>{if(!document.hidden)await refreshTeacher();else startTeacherPolling()},3900+Math.random()*400)}
async function refreshTeacher(){
 if(!teacherPin||!['dashboard','display'].includes(view))return;if(teacherPromise)return teacherPromise;
 teacherController=new AbortController();const controller=teacherController;
 teacherPromise=(async()=>{
  try{
   const result=await rpc(CONFIG,{action:'teacher',teacherPin},{signal:controller.signal,retries:0});
   if(controller.signal.aborted||!['dashboard','display'].includes(view))return;
   const fingerprint=JSON.stringify(result.rows.map(r=>[r.seat,r.claimId,r.revision,r.status]));
   teacherRows=result.rows;
   if(fingerprint!==teacherFingerprint){teacherFingerprint=fingerprint;if(view==='dashboard')dashboard();else displayWork(selectedTeacherSeat)}
   const status=document.getElementById('teacher-status');if(status)status.textContent='✓ 最近同步 '+new Date().toLocaleTimeString('zh-TW',{hour12:false,timeZone:'Asia/Taipei'});
  }catch(e){if(!controller.signal.aborted){const status=document.getElementById('teacher-status');if(status)status.textContent='更新暫時失敗，保留上次成功資料。可按更新重試。'}}
  finally{teacherPromise=null;startTeacherPolling()}
 })();return teacherPromise;
}
async function releaseSeat(n){
 const row=teacherRows.find(x=>x.seat===n);if(!row||!confirm('解除 '+n+' 號會清除這份作答，讓另一台裝置重新選取。確定繼續？'))return;
 try{await rpc(CONFIG,{action:'release',seat:n,claimId:row.claimId,teacherPin});await refreshTeacher()}catch(e){setGlobal(e.message)}
}
function toggleChristmas(){const value=document.body.classList.toggle('christmas');document.getElementById('theme-toggle').textContent=value?'切回原版':'試試耶誕風'}
window.addEventListener('beforeunload',e=>{if(session?.dirty){persistDraft(session);e.preventDefault();e.returnValue=''}});
window.addEventListener('pagehide',()=>{if(session?.dirty)persistDraft(session)});
window.addEventListener('online',()=>{if(session?.dirty&&!session.composing&&!session.submitting)void saveProgress(false);if(['dashboard','display'].includes(view))void refreshTeacher()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&['dashboard','display'].includes(view))void refreshTeacher()});
setInterval(()=>{if(view==='write'&&session?.dirty&&!session.composing&&!session.submitting)void saveProgress(false)},6000);

async function downloadWorks(){try{const data=await rpc(CONFIG,{action:'teacher',teacherPin},{retries:0});const text=data.rows.map(r=>'【'+String(r.seat).padStart(2,'0')+' 號】'+getLesson(r.topic).title+'\n'+(r.status==='submitted'?'已繳交':'草稿')+'\n'+getLesson(r.topic).parts.map((p,i)=>p+(i<4?(r.answers[i]||'＿＿＿＿'):'')).join('')).join('\n\n--------------------\n\n');const link=document.createElement('a');const url=URL.createObjectURL(new Blob(['國語寫作作品備份\n下載時間：'+new Date().toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})+'\n\n'+text],{type:'text/plain;charset=utf-8'}));link.href=url;link.download='國語寫作作品_'+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date())+'.txt';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){setGlobal(e.message)}}
Object.assign(window,{downloadWorks,home,seats,selectSeat,chooseTopic,openWriting,editAnswer,setComposing,checkWork,refreshParagraph,saveDraft,submitWork,restoreDraft,teacherEntry,loginTeacher,dashboard,displayWork,toggleHighlight,toggleFullScreen,refreshTeacher,releaseSeat,toggleChristmas});
home();

