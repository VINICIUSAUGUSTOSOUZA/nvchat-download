(() => {
  const cfg = window.NVCHAT_SUPABASE;
  const button = document.getElementById('notificationButton');
  const list = document.getElementById('conversationList');
  const prompt = document.getElementById('notificationPrompt');
  const enableButton = document.getElementById('enableNotificationsButton');
  const dismissButton = document.getElementById('dismissNotificationsButton');
  const promptTitle = prompt?.querySelector('.notification-prompt-copy strong');
  const promptText = prompt?.querySelector('.notification-prompt-copy span');
  const DISMISS_KEY = 'nvchat-notification-prompt-dismissed-v2';

  if (!cfg || !window.supabase || !('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) {
    if (button) { button.disabled = true; button.title = 'Notificações não suportadas neste navegador'; }
    if (prompt) {
      prompt.classList.remove('hidden');
      if (promptTitle) promptTitle.textContent = 'Notificações indisponíveis';
      if (promptText) promptText.textContent = 'Este navegador não oferece suporte completo a notificações do NVChat. Abra pelo Chrome atualizado.';
      enableButton?.classList.add('hidden');
      dismissButton?.classList.remove('hidden');
    }
    return;
  }

  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  let registration = null, channel = null, currentUserId = null;

  const bodyFor = message => {
    if (message.tipo === 'texto') return (message.texto || 'Nova mensagem').trim().slice(0, 120);
    if (message.tipo === 'foto') return '📷 Enviou uma foto';
    if (message.tipo === 'audio') return '🎤 Enviou um áudio';
    if (message.tipo === 'localizacao') return '📍 Enviou uma localização';
    return 'Você recebeu uma nova mensagem.';
  };

  function updateButton() {
    if (!button) return;
    if (Notification.permission === 'granted') { button.textContent='🔔'; button.classList.add('enabled'); button.title='Notificações ativadas'; }
    else if (Notification.permission === 'denied') { button.textContent='🔕'; button.classList.remove('enabled'); button.title='Notificações bloqueadas — toque para ver como liberar'; }
    else { button.textContent='🔔'; button.classList.remove('enabled'); button.title='Ativar notificações'; }
  }

  function updatePrompt(session) {
    if (!prompt) return;
    if (!session?.user?.id || Notification.permission === 'granted') { prompt.classList.add('hidden'); return; }

    if (Notification.permission === 'denied') {
      prompt.classList.remove('hidden');
      if (promptTitle) promptTitle.textContent = 'Notificações estão bloqueadas';
      if (promptText) promptText.textContent = 'No Android, abra as informações deste site/app e permita Notificações. Depois volte ao NVChat.';
      if (enableButton) enableButton.textContent = 'Ver como liberar';
      dismissButton?.classList.remove('hidden');
      return;
    }

    const dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    prompt.classList.toggle('hidden', dismissed);
    if (promptTitle) promptTitle.textContent = 'Não perca nenhuma mensagem';
    if (promptText) promptText.textContent = 'Ative as notificações para receber novas mensagens mesmo com o NVChat fechado.';
    if (enableButton) enableButton.textContent = 'Ativar notificações';
    dismissButton?.classList.remove('hidden');
  }

  function urlBase64ToUint8Array(value) {
    const padding='='.repeat((4-value.length%4)%4), base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/'), raw=atob(base64);
    return Uint8Array.from([...raw].map(ch=>ch.charCodeAt(0)));
  }

  async function ensureRegistration() {
    if (registration) return registration;
    registration=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
    registration=await navigator.serviceWorker.ready;
    return registration;
  }

  async function syncPushSubscription({allowCreate=false}={}) {
    if (Notification.permission !== 'granted') return false;
    const {data:sessionData}=await client.auth.getSession();
    if (!sessionData?.session?.user?.id) return false;
    const reg=await ensureRegistration(); let subscription=await reg.pushManager.getSubscription();
    if (!subscription && allowCreate) {
      const {data,error}=await client.functions.invoke('push-config',{body:{}}); if(error)throw error;
      if(!data?.publicKey)throw new Error('Chave pública de notificação indisponível.');
      subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(data.publicKey)});
    }
    if(!subscription)return false;
    const json=subscription.toJSON();
    const {error}=await client.functions.invoke('push-register',{body:{endpoint:subscription.endpoint,keys:json.keys||{},userAgent:navigator.userAgent}}); if(error)throw error;
    return true;
  }

  async function dispatchPush(message){if(!message?.id)return;const{error}=await client.functions.invoke('push-message',{body:{message_id:message.id}});if(error)throw error;}
  async function showNotification(message){
    if(Notification.permission!=='granted'||(document.visibilityState==='visible'&&document.hasFocus()))return;
    const{data:sender}=await client.from('Usuarios').select('nome,id_publico').eq('id',message.remetente_id).maybeSingle();
    const reg=await ensureRegistration(); await reg.showNotification(sender?.nome?`NVChat — ${sender.nome}`:'NVChat — nova mensagem',{body:bodyFor(message),icon:'./icon.svg',badge:'./icon.svg',tag:`nvchat-${message.conversa_id}`,renotify:true,vibrate:[180,80,180],data:{conversationId:message.conversa_id,url:'./'}});
  }

  async function subscribeRealtime(){
    const{data}=await client.auth.getSession(),session=data?.session;if(!session?.user?.id)return;
    if(channel&&currentUserId===session.user.id)return;if(channel)await client.removeChannel(channel);currentUserId=session.user.id;
    channel=client.channel(`nvchat-web-notifications-${currentUserId}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'Mensagens'},payload=>{const message=payload.new;if(!message)return;if(message.remetente_id===currentUserId){dispatchPush(message).catch(error=>console.warn('Falha ao disparar push:',error));return;}showNotification(message).catch(()=>{});}).subscribe();
  }

  function clickConversation(conversationId){if(!conversationId)return false;const safe=window.CSS?.escape?CSS.escape(conversationId):conversationId.replace(/[^a-zA-Z0-9_-]/g,'');const item=document.querySelector(`.conversation-item[data-id="${safe}"]`);if(!item)return false;item.click();return true;}
  function openConversationWhenReady(conversationId){if(!conversationId||clickConversation(conversationId)||!list)return;const observer=new MutationObserver(()=>{if(!clickConversation(conversationId))return;observer.disconnect();});observer.observe(list,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),10000);}

  async function activateNotifications(){
    if (Notification.permission === 'denied') {
      alert('As notificações estão bloqueadas. No Android: abra as informações do site/app NVChat > Notificações > Permitir. Se estiver no Chrome, toque no cadeado/ícone do site ou em ⋮ > Configurações do site > Notificações.');
      return false;
    }
    try{
      await ensureRegistration();const permission=await Notification.requestPermission();updateButton();
      const{data}=await client.auth.getSession();updatePrompt(data?.session);
      if(permission!=='granted')return false;
      localStorage.removeItem(DISMISS_KEY);prompt?.classList.add('hidden');
      const ready=await syncPushSubscription({allowCreate:true});await subscribeRealtime();
      await registration.showNotification('NVChat',{body:ready?'Notificações ativadas neste celular, inclusive com o NVChat fechado.':'Notificações ativadas neste celular.',icon:'./icon.svg',badge:'./icon.svg',tag:'nvchat-notifications-enabled',data:{url:'./'}});return true;
    }catch(error){console.warn('Falha ao ativar notificações do NVChat:',error);if(button)button.title='Não foi possível ativar as notificações. Toque para tentar novamente.';alert('Não foi possível concluir a ativação das notificações. Atualize o Chrome e tente novamente pelo botão de notificações.');return false;}
  }

  button?.addEventListener('click',activateNotifications);
  enableButton?.addEventListener('click',activateNotifications);
  dismissButton?.addEventListener('click',()=>{localStorage.setItem(DISMISS_KEY,'1');prompt?.classList.add('hidden');});

  navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='OPEN_CONVERSATION')openConversationWhenReady(event.data.conversationId);});
  client.auth.onAuthStateChange((_event,session)=>{updatePrompt(session);if(!session){currentUserId=null;if(channel)client.removeChannel(channel);channel=null;return;}subscribeRealtime().catch(()=>{});syncPushSubscription({allowCreate:false}).catch(()=>{});});

  ensureRegistration().catch(()=>{});updateButton();subscribeRealtime().catch(()=>{});syncPushSubscription({allowCreate:false}).catch(()=>{});
  client.auth.getSession().then(({data})=>updatePrompt(data?.session)).catch(()=>{});
  const fromNotification=new URL(location.href).searchParams.get('conversation');if(fromNotification){openConversationWhenReady(fromNotification);history.replaceState(null,'',location.pathname+location.hash);}
})();