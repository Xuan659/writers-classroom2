export function validateConfig(config){
 if(config.apiPath!=='/api/classroom')throw new Error('網站連線設定有誤，請通知老師。');
}
export async function rpc(config,payload,{signal,retries=1,timeoutMs=8000}={}){
 validateConfig(config);const body=JSON.stringify(payload);let last;
 for(let i=0;i<=retries;i++){
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,timeoutMs);
  try{
   const r=await fetch(config.apiPath,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:controller.signal,cache:'no-store'});
   let data;try{data=JSON.parse(await r.text())}catch{
    throw Object.assign(new Error('網站服務回應不是有效資料，請通知老師確認更新是否完成。'),{status:r.status,code:'NON_JSON_RESPONSE',retryable:false});
   }
   if(!r.ok||data?.ok===false)throw Object.assign(new Error(data?.error||'連線暫時有狀況，請重新嘗試。'),{status:typeof data?.status==='number'?data.status:r.status,code:data?.code,retryable:data?.retryable!==false});
   return data;
  }catch(error){
   if(signal?.aborted)throw error;
   if(controller.signal.aborted&&!error.status)error=Object.assign(new Error('連線等待超過時間，請稍後再試。'),{code:'REQUEST_TIMEOUT',retryable:true});
   last=error;if(error.retryable===false||(error.status&&error.status<500))throw error;if(i===retries)break;
   await new Promise(r=>setTimeout(r,400+i*350+Math.random()*250));
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
 }
 if(last?.status)throw last;
 const message=payload.action==='health'?'目前無法確認網站服務，請檢查網路或通知老師。':payload.action==='join'?'暫時無法載入作品，請重新嘗試。':payload.action==='teacher'?'暫時無法讀取作品，請稍後重新整理。':payload.action==='release'?'尚未確認清除結果，請更新控制台再確認。':'尚未同步成功，文字保留在本機，請檢查網路後重試。';
 throw Object.assign(new Error(message),{code:last?.code||'NETWORK_ERROR',cause:last});
}
