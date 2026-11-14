export class ReliableWriter{
 constructor({send,revision=0,claimId,onState=()=>{}}){this.send=send;this.revision=revision;this.claimId=claimId;this.onState=onState;this.running=false;this.pending=null;this.final=null;this.uncertain=null;this.closed=false;this.conflict=false}
 enqueue(snapshot,submit=false){
  if(this.closed)return Promise.resolve({status:'submitted',revision:this.revision,submittedSnapshot:this.submittedSnapshot});
  if(this.conflict)return Promise.reject(Object.assign(new Error('請重新選取座號以確認最新狀態。'),{status:409}));
  if(this.final&&!submit)return this.final.promise;
  if(this.final&&submit)return this.final.promise;
  let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});
  const waiter={resolve,reject};
  if(submit){const waiters=[...(this.pending?.waiters||[]),waiter];this.pending=null;this.final={snapshot:structuredClone(snapshot),submit:true,waiters,promise};this.onState('submitting')}
  else{const waiters=[...(this.pending?.waiters||[]),waiter];this.pending={snapshot:structuredClone(snapshot),submit:false,waiters,promise}}
  void this.drain();return promise;
 }
 async drain(){
  if(this.running)return;this.running=true;
  try{while(this.uncertain||this.final||this.pending){
   const retry=!!this.uncertain;const job=this.uncertain||this.final||this.pending;
   if(retry)this.uncertain=null;else if(job===this.final)this.final=null;else this.pending=null;
   if(!job.body)job.body={...job.snapshot,claimId:this.claimId,revision:this.revision,requestId:crypto.randomUUID(),action:job.submit?'submit':'save'};
   this.onState(job.submit?'submitting':'saving');
   try{
    const result=await this.send(job.body);this.revision=result.revision;
    const outcome=result.status==='submitted'?{...result,submittedSnapshot:structuredClone(job.snapshot)}:result;
    for(const w of job.waiters)w.resolve(outcome);job.waiters=[];
    if(result.status==='submitted'){this.submittedSnapshot=outcome.submittedSnapshot;this.closed=true;for(const j of [this.pending,this.final])if(j)for(const w of j.waiters)w.resolve(outcome);this.pending=this.final=null;this.onState('submitted');break}
    this.onState('saved');
   }catch(error){
    for(const w of job.waiters)w.reject(error);job.waiters=[];
    if(error.status===409||error.status===401||error.status===400){this.conflict=error.status===409;this.onState('error')}
    else{this.uncertain=job;this.onState('offline')}
    for(const j of [this.pending,this.final])if(j)for(const w of j.waiters)w.reject(error);
    this.pending=this.final=null;break;
   }
  }}finally{this.running=false}
 }
}
export async function requestJSON(url,{body,headers={},timeoutMs=8000,retries=1,signal}={}){
 let last;
 for(let attempt=0;attempt<=retries;attempt++){
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetch(url,{method:body?'POST':'GET',cache:'no-store',headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
   let data;try{data=await response.json()}catch{throw new Error('連線未完整返回，請重試。')}
   if(!response.ok)throw Object.assign(new Error(data.error||'連線失敗。'),{status:response.status});
   return data;
  }catch(error){
   last=error;if(signal?.aborted)throw error;
   if(error.status&&error.status<500)throw error;
   if(attempt===retries)break;
   await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)+Math.random()*300));
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
 }
 throw Object.assign(new Error('暫時無法同步，文字已保留在本機；網路恢復後可按儲存或繳交重試。'),{cause:last});
}

