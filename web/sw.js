const CACHE='nvchat-web-v8';
const APP_SHELL=['./','./index.html','./manifest.webmanifest','./icon.svg','./assets/app.css','./assets/app.js','./assets/search.js','./assets/notifications.js','../assets/supabase-config.js'];

self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting())));

self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;
  event.respondWith(fetch(event.request).then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(event.request,copy));
    return response;
  }).catch(()=>caches.match(event.request).then(hit=>hit||caches.match('./index.html'))));
});

self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?event.data.json():{}}catch{payload={body:event.data?.text?.()||'Você recebeu uma nova mensagem.'}}
  const title=payload.title||'NVChat — nova mensagem';
  const options={
    body:payload.body||'Você recebeu uma nova mensagem.',
    icon:payload.icon||'./icon.svg',
    badge:payload.badge||'./icon.svg',
    tag:payload.tag||`nvchat-${payload.conversationId||'message'}`,
    renotify:true,
    vibrate:[180,80,180],
    data:{conversationId:payload.conversationId||payload.data?.conversationId||null,url:payload.url||payload.data?.url||'./'}
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const conversationId=event.notification.data?.conversationId||null;
  const base=new URL('./',self.registration.scope);
  if(conversationId)base.searchParams.set('conversation',conversationId);
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
    for(const client of windows){
      if(new URL(client.url).origin===base.origin){
        await client.focus();
        if(conversationId)client.postMessage({type:'OPEN_CONVERSATION',conversationId});
        return;
      }
    }
    return clients.openWindow(base.href);
  }));
});
