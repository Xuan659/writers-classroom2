export function validateConfig(config){
 if(config.apiPath!=='/api/classroom')throw new Error('網站連線設定有誤，請通知老師。');
}
export async function rpc(config,payload,{signal,retries=1,timeoutMs=8000}={}){
 validateConfig(config);const body=JSON.stringify(payload);let last;
 for(let i=0;i<=retries;i++){
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const controller=new AbortController(),abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,timeoutMs);
  try{
   const r=await fetch(config.apiPath,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:controller.signal,cache:'no-store'});
   const data=await r.json();
   if(!r.ok||data?.ok===false){const message=data.error||(r.status===404?'網站尚未準備好，請通知老師完成設定。':'連線暫時忙碌，請重試。');throw Object.assign(new Error(message),{status:data.status||r.status})}
   return data;
  }catch(error){
   last=error;if(signal?.aborted)throw error;if(error.status&&error.status<500)throw error;if(i===retries)break;
   await new Promise(r=>setTimeout(r,400+i*350+Math.random()*250));
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
 }
 const message=payload.action==='join'?'暫時無法確認座號，請檢查網路後重試。':payload.action==='teacher'?'暫時無法讀取作品，請檢查網路與設定後重試。':payload.action==='release'?'尚未確認解除結果，請更新控制台後再確認。':'尚未同步成功，文字已保留在本機。請檢查網路後重試。';
 throw Object.assign(new Error(message),{cause:last});
}

