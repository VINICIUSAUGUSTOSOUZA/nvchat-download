(() => {
  const cfg = window.NVCHAT_SUPABASE;
  if (!cfg || !window.supabase) return;

  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  const el = id => document.getElementById(id);
  const authView = el('authView'), chatView = el('chatView');
  const loginForm = el('loginForm'), registerForm = el('registerForm'), recoveryView = el('recoveryView');
  const loginButton = el('loginButton'), registerButton = el('registerButton');
  const loginError = el('loginError'), registerError = el('registerError');
  const conversationList = el('conversationList'), messagesEl = el('messages');
  const composerWrap = el('composerWrap'), messageForm = el('messageForm'), messageInput = el('messageInput');
  const conversationName = el('conversationName'), conversationStatus = el('conversationStatus');
  const photoButton = el('photoButton'), locationButton = el('locationButton'), audioButton = el('audioButton');
  const galleryInput = el('galleryInput'), cameraInput = el('cameraInput');
  const photoSourceDialog = el('photoSourceDialog'), photoPreviewDialog = el('photoPreviewDialog'), photoPreviewImage = el('photoPreviewImage');
  const recordingStatus = el('recordingStatus'), audioPreview = el('audioPreview'), audioPreviewPlayer = el('audioPreviewPlayer');
  const locationDialog = el('locationDialog');

  let currentUser = null, currentConversation = null, messageChannel = null, conversationsChannel = null;
  let profiles = new Map(), lastRegisteredId = '', bootingUserId = null;
  let pendingPhotoFile = null, pendingPhotoUrl = null;
  let mediaRecorder = null, mediaChunks = [], recordingStartedAt = 0, recordingTimer = null, discardRecording = false;
  let pendingAudioBlob = null, pendingAudioDuration = 0, pendingAudioMime = '';
  let locationWatchId = null, bestLocation = null;
  const objectUrls = new Set();

  const initials = (name='NV') => name.trim().split(/\s+/).slice(0,2).map(p=>p[0]||'').join('').toUpperCase() || 'NV';
  const formatTime = d => new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(d));
  const formatDuration = ms => { const s=Math.max(0,Math.round((ms||0)/1000)); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };

  function parseError(body,fallback){ try{const d=JSON.parse(body);return d.erro||d.message||d.msg||fallback}catch{return fallback} }
  async function callFunction(name,payload){
    const res=await fetch(`${cfg.url.replace(/\/$/,'')}/functions/v1/${name}`,{method:'POST',headers:{apikey:cfg.publishableKey,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)});
    const body=await res.text(); if(!res.ok) throw new Error(parseError(body,'Não foi possível concluir a operação.')); return JSON.parse(body);
  }
  function showAuthMode(mode){
    loginError.textContent='';registerError.textContent='';loginForm.classList.toggle('hidden',mode!=='login');registerForm.classList.toggle('hidden',mode!=='register');recoveryView.classList.toggle('hidden',mode!=='recovery');
    el('authSubtitle').textContent=mode==='register'?'Crie sua conta do NVChat sem e-mail ou telefone.':mode==='recovery'?'Sua conta foi criada com sucesso.':'Entre com o mesmo ID e senha usados no aplicativo.';
  }
  function setSignedIn(v){authView.classList.toggle('hidden',v);chatView.classList.toggle('hidden',!v);if(!v)showAuthMode('login')}
  function clearObjectUrls(){objectUrls.forEach(URL.revokeObjectURL);objectUrls.clear()}

  async function loadCurrentProfile(){const {data,error}=await client.from('Usuarios').select('id,nome,id_publico,iniciais').eq('id',currentUser.id).maybeSingle();if(error)throw error;el('currentUserName').textContent=data?.nome||data?.id_publico||'Usuário'}
  async function loadConversations(){
    const {data,error}=await client.from('Conversas').select('id,usuario_a,usuario_b,created_at,updated_at').or(`usuario_a.eq.${currentUser.id},usuario_b.eq.${currentUser.id}`).order('updated_at',{ascending:false}); if(error)throw error;
    const conversations=data||[], otherIds=[...new Set(conversations.map(c=>c.usuario_a===currentUser.id?c.usuario_b:c.usuario_a))]; profiles=new Map();
    if(otherIds.length){const {data:users}=await client.from('Usuarios').select('id,nome,id_publico,iniciais,ultimo_online').in('id',otherIds);(users||[]).forEach(u=>profiles.set(u.id,u))}
    conversationList.replaceChildren();
    if(!conversations.length){const x=document.createElement('div');x.className='list-empty';x.textContent='Nenhuma conversa encontrada.';conversationList.append(x);return}
    conversations.forEach(c=>{const other=c.usuario_a===currentUser.id?c.usuario_b:c.usuario_a,u=profiles.get(other),b=document.createElement('button');b.type='button';b.className='conversation-item';b.dataset.id=c.id;const a=document.createElement('span');a.className='avatar';a.textContent=u?.iniciais||initials(u?.nome);const m=document.createElement('span');m.className='conversation-meta';const n=document.createElement('strong');n.textContent=u?.nome||'Usuário NVChat';const d=document.createElement('small');d.textContent=u?.id_publico?`@${u.id_publico}`:'Conversa NVChat';m.append(n,d);b.append(a,m);b.onclick=()=>openConversation(c,u);conversationList.append(b)})
  }

  async function authenticatedMediaUrl(path){const {data,error}=await client.storage.from('mensagens').download(path);if(error||!data)throw error||new Error('Arquivo indisponível.');const url=URL.createObjectURL(data);objectUrls.add(url);return url}
  function appendMessage(m){
    if(!m||m.apagada_em)return;const box=document.createElement('div');box.className=`message${m.remetente_id===currentUser.id?' mine':''}`;const body=document.createElement('div');body.className='message-body';
    if(m.tipo==='texto')body.textContent=m.texto||'';
    else if(m.tipo==='foto'&&m.arquivo_path){const p=document.createElement('div');p.className='media-loading';p.textContent='📷 Carregando foto…';body.append(p);authenticatedMediaUrl(m.arquivo_path).then(url=>{const img=document.createElement('img');img.className='chat-photo';img.src=url;img.alt='Foto';img.onclick=()=>window.open(url,'_blank','noopener');p.replaceWith(img)}).catch(()=>p.textContent='📷 Não foi possível abrir a foto.')}
    else if(m.tipo==='audio'&&m.arquivo_path){const w=document.createElement('div');w.className='chat-audio';const p=document.createElement('span');p.className='media-loading';p.textContent='Carregando áudio…';w.append(p);body.append(w);authenticatedMediaUrl(m.arquivo_path).then(url=>{const a=document.createElement('audio');a.controls=true;a.preload='metadata';a.src=url;p.replaceWith(a)}).catch(()=>p.textContent='Áudio indisponível.')}
    else if(m.tipo==='localizacao'&&m.latitude!=null&&m.longitude!=null){const link=document.createElement('a');link.className='location-link';link.target='_blank';link.rel='noopener';link.href=`https://www.google.com/maps?q=${encodeURIComponent(`${m.latitude},${m.longitude}`)}`;link.innerHTML=`📍 Localização<br><small>${m.precisao_m!=null?`Precisão: ±${Number(m.precisao_m).toFixed(1)} m<br>`:''}${Number(m.latitude).toFixed(7)}, ${Number(m.longitude).toFixed(7)}<br><b>Toque para abrir no mapa</b></small>`;body.append(link)}
    else body.textContent=m.texto||`[${m.tipo}]`;
    const time=document.createElement('span');time.className='time';let status='';if(m.remetente_id===currentUser.id)status=m.lida_em?' ✓✓':m.entregue_em?' ✓✓':' ✓';time.textContent=`${formatTime(m.created_at)}${status}`;box.append(body,time);messagesEl.append(box)
  }
  async function openConversation(c,u){
    currentConversation=c;clearObjectUrls();resetAudioPreview();stopLocationWatch();chatView.classList.add('open-conversation');document.querySelectorAll('.conversation-item').forEach(i=>i.classList.toggle('active',i.dataset.id===c.id));conversationName.textContent=u?.nome||'Usuário NVChat';conversationStatus.textContent=u?.id_publico?`@${u.id_publico}`:'';composerWrap.classList.remove('hidden');messagesEl.classList.remove('empty-state');messagesEl.textContent='Carregando…';
    const {data,error}=await client.from('Mensagens').select('id,conversa_id,remetente_id,tipo,texto,arquivo_path,mime_type,duracao_ms,latitude,longitude,precisao_m,created_at,entregue_em,lida_em,apagada_em').eq('conversa_id',c.id).order('created_at',{ascending:true}).limit(500);if(error){messagesEl.textContent='Não foi possível carregar as mensagens.';return}messagesEl.textContent='';(data||[]).forEach(appendMessage);messagesEl.scrollTop=messagesEl.scrollHeight;subscribeToMessages(c.id)
  }
  function subscribeToMessages(id){if(messageChannel)client.removeChannel(messageChannel);messageChannel=client.channel(`web-messages-${id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'Mensagens',filter:`conversa_id=eq.${id}`},p=>{if(p.new?.conversa_id!==currentConversation?.id)return;appendMessage(p.new);messagesEl.scrollTop=messagesEl.scrollHeight}).subscribe()}
  async function insertMessage(payload){const {error}=await client.from('Mensagens').insert(payload);if(error)throw error}
  async function sendText(e){e.preventDefault();const text=messageInput.value.trim();if(!text||!currentConversation)return;const b=el('sendTextButton');b.disabled=true;try{await insertMessage({conversa_id:currentConversation.id,remetente_id:currentUser.id,tipo:'texto',texto:text});messageInput.value=''}catch(err){alert(`Não foi possível enviar. ${err.message||''}`)}finally{b.disabled=false}}

  function choosePhoto(file){if(!file)return;pendingPhotoFile=file;if(pendingPhotoUrl)URL.revokeObjectURL(pendingPhotoUrl);pendingPhotoUrl=URL.createObjectURL(file);photoPreviewImage.src=pendingPhotoUrl;el('photoSendError').textContent='';photoPreviewDialog.showModal()}
  async function preparePhoto(file){
    if(!file.type.startsWith('image/'))throw new Error('Selecione uma imagem.');
    const img=await new Promise((resolve,reject)=>{const u=URL.createObjectURL(file),i=new Image();i.onload=()=>{URL.revokeObjectURL(u);resolve(i)};i.onerror=()=>{URL.revokeObjectURL(u);reject(new Error('Não foi possível abrir a foto.'))};i.src=u});
    const max=1600,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);const blob=await new Promise((r,j)=>canvas.toBlob(b=>b?r(b):j(new Error('Falha ao preparar foto.')),'image/jpeg',.82));return {blob,mime:'image/jpeg',ext:'jpg'}
  }
  async function sendPendingPhoto(){if(!pendingPhotoFile||!currentConversation)return;const b=el('sendPhotoButton');b.disabled=true;b.textContent='Enviando…';el('photoSendError').textContent='';try{const p=await preparePhoto(pendingPhotoFile),path=`${currentConversation.id}/${crypto.randomUUID()}.${p.ext}`;const {error}=await client.storage.from('mensagens').upload(path,p.blob,{contentType:p.mime,upsert:false});if(error)throw error;await insertMessage({conversa_id:currentConversation.id,remetente_id:currentUser.id,tipo:'foto',arquivo_path:path,mime_type:p.mime});closePhotoPreview()}catch(err){el('photoSendError').textContent=`Falha no envio — ${err.message||'tente novamente.'}`}finally{b.disabled=false;b.textContent='Enviar'}}
  function closePhotoPreview(){photoPreviewDialog.close();pendingPhotoFile=null;photoPreviewImage.removeAttribute('src');if(pendingPhotoUrl){URL.revokeObjectURL(pendingPhotoUrl);pendingPhotoUrl=null}galleryInput.value='';cameraInput.value=''}

  function supportedAudioMime(){if(!window.MediaRecorder)return'';return ['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t))||''}
  async function startRecording(){if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){alert('Este navegador não oferece gravação de áudio.');return}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true}),mime=supportedAudioMime();discardRecording=false;mediaChunks=[];recordingStartedAt=Date.now();mediaRecorder=mime?new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:64000}):new MediaRecorder(stream);mediaRecorder.ondataavailable=e=>{if(e.data?.size)mediaChunks.push(e.data)};mediaRecorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());clearInterval(recordingTimer);recordingTimer=null;recordingStatus.classList.add('hidden');audioButton.textContent='🎤';const rec=mediaRecorder;mediaRecorder=null;if(discardRecording){discardRecording=false;mediaChunks=[];return}pendingAudioDuration=Date.now()-recordingStartedAt;pendingAudioMime=rec?.mimeType||mime||'audio/webm';pendingAudioBlob=new Blob(mediaChunks,{type:pendingAudioMime});showAudioPreview()};mediaRecorder.start(250);audioButton.textContent='■';recordingStatus.classList.remove('hidden');recordingTimer=setInterval(()=>recordingStatus.textContent=`● Gravando ${formatDuration(Date.now()-recordingStartedAt)}`,250)}catch(err){alert(`Não foi possível acessar o microfone. ${err.message||''}`)}}
  function stopRecording(){if(!mediaRecorder)return;if(Date.now()-recordingStartedAt<500){cancelLiveRecording();alert('Áudio muito curto.');return}mediaRecorder.stop()}
  function cancelLiveRecording(){if(!mediaRecorder)return;discardRecording=true;try{mediaRecorder.stop()}catch{}clearInterval(recordingTimer);recordingTimer=null;recordingStatus.classList.add('hidden');audioButton.textContent='🎤'}
  function showAudioPreview(){if(!pendingAudioBlob)return;const url=URL.createObjectURL(pendingAudioBlob);objectUrls.add(url);audioPreviewPlayer.src=url;audioPreview.classList.remove('hidden')}
  function resetAudioPreview(){audioPreviewPlayer.pause();audioPreviewPlayer.removeAttribute('src');audioPreviewPlayer.load();pendingAudioBlob=null;pendingAudioDuration=0;pendingAudioMime='';audioPreview.classList.add('hidden')}
  function audioExt(m){return m.includes('mp4')?'m4a':m.includes('ogg')?'ogg':'webm'}
  async function sendPendingAudio(){if(!pendingAudioBlob||!currentConversation)return;const b=el('sendAudioButton');b.disabled=true;b.textContent='Enviando…';try{const path=`${currentConversation.id}/${crypto.randomUUID()}.${audioExt(pendingAudioMime)}`;const {error}=await client.storage.from('mensagens').upload(path,pendingAudioBlob,{contentType:pendingAudioMime,upsert:false});if(error)throw error;await insertMessage({conversa_id:currentConversation.id,remetente_id:currentUser.id,tipo:'audio',arquivo_path:path,mime_type:pendingAudioMime,duracao_ms:Math.round(pendingAudioDuration)});resetAudioPreview()}catch(err){alert(`Não foi possível enviar o áudio. ${err.message||''}`)}finally{b.disabled=false;b.textContent='Enviar áudio'}}

  function qualityFor(acc){if(!Number.isFinite(acc))return'Aguardando melhorar o sinal';if(acc<=2)return'Excelente — precisão de levantamento';if(acc<=5)return'Muito boa';if(acc<=10)return'Boa';return'Aguardando melhorar o sinal do GPS'}
  function stopLocationWatch(){if(locationWatchId!==null&&navigator.geolocation)navigator.geolocation.clearWatch(locationWatchId);locationWatchId=null;bestLocation=null}
  function openLocation(){if(!navigator.geolocation){alert('Este navegador não oferece localização.');return}bestLocation=null;el('locationAccuracy').textContent='Precisão: calculando...';el('locationQuality').textContent='Aguardando melhorar o sinal';el('locationCoords').textContent='Latitude: —\nLongitude: —';el('sendLocationButton').disabled=true;locationDialog.showModal();locationWatchId=navigator.geolocation.watchPosition(pos=>{const c=pos.coords;if(!bestLocation||c.accuracy<bestLocation.accuracy+3)bestLocation={latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy};const b=bestLocation;el('locationAccuracy').textContent=`Precisão: ±${Number(b.accuracy).toFixed(1)} m`;el('locationQuality').textContent=qualityFor(b.accuracy);el('locationCoords').textContent=`Latitude: ${b.latitude.toFixed(7)}\nLongitude: ${b.longitude.toFixed(7)}`;el('sendLocationButton').disabled=false},err=>{el('locationQuality').textContent=err.code===1?'Permissão de localização negada.':'Não foi possível obter a localização.'},{enableHighAccuracy:true,maximumAge:0,timeout:15000})}
  async function sendLocation(){if(!bestLocation||!currentConversation)return;const b=el('sendLocationButton');b.disabled=true;try{await insertMessage({conversa_id:currentConversation.id,remetente_id:currentUser.id,tipo:'localizacao',latitude:bestLocation.latitude,longitude:bestLocation.longitude,precisao_m:bestLocation.accuracy});stopLocationWatch();locationDialog.close()}catch(err){alert(`Não foi possível enviar a localização. ${err.message||''}`);b.disabled=false}}

  function subscribeToConversationChanges(){if(conversationsChannel)client.removeChannel(conversationsChannel);conversationsChannel=client.channel('web-conversations').on('postgres_changes',{event:'*',schema:'public',table:'Conversas'},()=>loadConversations().catch(()=>{})).subscribe()}
  async function boot(session,force=false){const u=session?.user||null;if(!u){currentUser=null;bootingUserId=null;setSignedIn(false);return}if(!force&&bootingUserId===u.id&&currentUser?.id===u.id)return;bootingUserId=u.id;currentUser=u;setSignedIn(true);conversationList.textContent='Carregando conversas…';try{await loadCurrentProfile();await loadConversations();subscribeToConversationChanges()}catch(err){conversationList.textContent='Sessão iniciada, mas não foi possível carregar as conversas.'}}

  loginForm.onsubmit=async e=>{e.preventDefault();loginError.textContent='';loginButton.disabled=true;loginButton.textContent='Entrando…';try{const data=await callFunction('entrar',{id_publico:el('loginId').value.trim(),senha:el('loginPassword').value}),s=data?.sessao;if(!s?.access_token||!s?.refresh_token)throw new Error('Sessão inválida.');const {data:sd,error}=await client.auth.setSession({access_token:s.access_token,refresh_token:s.refresh_token});if(error)throw error;await boot(sd.session,true)}catch(err){loginError.textContent=err.message||'ID ou senha inválidos.';setSignedIn(false)}finally{loginButton.disabled=false;loginButton.textContent='Entrar'}};
  registerForm.onsubmit=async e=>{e.preventDefault();registerError.textContent='';const name=el('registerName').value.trim(),id=el('registerId').value.trim(),pass=el('registerPassword').value,conf=el('registerConfirm').value;if(pass!==conf){registerError.textContent='As senhas não são iguais.';return}if(pass.length<8){registerError.textContent='A senha precisa ter pelo menos 8 caracteres.';return}registerButton.disabled=true;try{const d=await callFunction('criar-conta',{nome:name,id_publico:id,senha:pass});lastRegisteredId=id;el('recoveryKey').textContent=d.chave_recuperacao;registerForm.reset();showAuthMode('recovery')}catch(err){registerError.textContent=err.message||'Não foi possível criar a conta.'}finally{registerButton.disabled=false}};

  el('showRegisterButton').onclick=()=>showAuthMode('register');el('showLoginButton').onclick=()=>showAuthMode('login');el('finishRecoveryButton').onclick=()=>{showAuthMode('login');el('loginId').value=lastRegisteredId};el('copyRecoveryButton').onclick=()=>navigator.clipboard?.writeText(el('recoveryKey').textContent);
  el('logoutButton').onclick=async()=>{cancelLiveRecording();resetAudioPreview();stopLocationWatch();clearObjectUrls();await client.auth.signOut();currentConversation=null;chatView.classList.remove('open-conversation')};
  el('backButton').onclick=()=>{cancelLiveRecording();resetAudioPreview();stopLocationWatch();chatView.classList.remove('open-conversation')};
  messageForm.addEventListener('submit',sendText);
  photoButton.onclick=()=>photoSourceDialog.showModal();el('cancelPhotoSourceButton').onclick=()=>photoSourceDialog.close();el('useCameraButton').onclick=()=>{photoSourceDialog.close();cameraInput.click()};el('useGalleryButton').onclick=()=>{photoSourceDialog.close();galleryInput.click()};cameraInput.onchange=()=>choosePhoto(cameraInput.files?.[0]);galleryInput.onchange=()=>choosePhoto(galleryInput.files?.[0]);el('cancelPhotoButton').onclick=closePhotoPreview;el('sendPhotoButton').onclick=sendPendingPhoto;
  audioButton.onclick=()=>mediaRecorder?stopRecording():startRecording();el('cancelAudioButton').onclick=resetAudioPreview;el('sendAudioButton').onclick=sendPendingAudio;
  locationButton.onclick=openLocation;el('cancelLocationButton').onclick=()=>{stopLocationWatch();locationDialog.close()};el('sendLocationButton').onclick=sendLocation;
  messageInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();messageForm.requestSubmit()}});

  client.auth.onAuthStateChange((_e,s)=>setTimeout(()=>boot(s).catch(console.error),0));client.auth.getSession().then(({data})=>boot(data.session).catch(console.error));
  if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
})();
