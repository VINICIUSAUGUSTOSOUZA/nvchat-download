(() => {
  const cfg = window.NVCHAT_SUPABASE;
  if (!cfg || !window.supabase) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">Não foi possível iniciar o NVChat Web.</p>';
    return;
  }

  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  const el = id => document.getElementById(id);
  const authView = el('authView'), chatView = el('chatView');
  const loginForm = el('loginForm'), registerForm = el('registerForm'), recoveryView = el('recoveryView');
  const loginButton = el('loginButton'), registerButton = el('registerButton');
  const loginError = el('loginError'), registerError = el('registerError');
  const conversationList = el('conversationList'), messagesEl = el('messages');
  const messageForm = el('messageForm'), messageInput = el('messageInput');
  const conversationName = el('conversationName'), conversationStatus = el('conversationStatus');
  const photoInput = el('photoInput'), photoButton = el('photoButton'), audioButton = el('audioButton');
  const recordingStatus = el('recordingStatus'), audioPreview = el('audioPreview'), audioPreviewPlayer = el('audioPreviewPlayer');

  let currentUser = null, currentConversation = null, messageChannel = null, conversationsChannel = null;
  let profiles = new Map(), lastRegisteredId = '', bootingUserId = null;
  let mediaRecorder = null, mediaChunks = [], recordingStartedAt = 0, recordingTimer = null;
  let pendingAudioBlob = null, pendingAudioDuration = 0, pendingAudioMime = '';
  const objectUrls = new Set();

  const initials = (name = 'NV') => name.trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || 'NV';
  const formatTime = date => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(date));
  const formatDuration = ms => { const s = Math.max(0, Math.round((ms || 0) / 1000)); return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`; };

  function parseError(body, fallback) {
    try { const data = JSON.parse(body); return data.erro || data.message || data.msg || fallback; }
    catch (_) { return fallback; }
  }
  async function callFunction(name, payload) {
    let response;
    try {
      response = await fetch(`${cfg.url.replace(/\/$/, '')}/functions/v1/${name}`, {
        method: 'POST', headers: { apikey: cfg.publishableKey, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload)
      });
    } catch (error) { throw new Error(`Falha de conexão: ${error.message || 'verifique sua internet.'}`); }
    const body = await response.text();
    if (!response.ok) throw new Error(parseError(body, 'Não foi possível concluir a operação.'));
    try { return JSON.parse(body); } catch (_) { throw new Error('Resposta inválida do servidor.'); }
  }

  function showAuthMode(mode) {
    loginError.textContent = ''; registerError.textContent = '';
    loginForm.classList.toggle('hidden', mode !== 'login');
    registerForm.classList.toggle('hidden', mode !== 'register');
    recoveryView.classList.toggle('hidden', mode !== 'recovery');
    el('authSubtitle').textContent = mode === 'register' ? 'Crie sua conta do NVChat sem e-mail ou telefone.' : mode === 'recovery' ? 'Sua conta foi criada com sucesso.' : 'Entre com o mesmo ID e senha usados no aplicativo.';
  }
  function setSignedIn(signedIn) {
    authView.classList.toggle('hidden', signedIn); chatView.classList.toggle('hidden', !signedIn);
    if (!signedIn) showAuthMode('login');
  }
  function clearObjectUrls() { objectUrls.forEach(URL.revokeObjectURL); objectUrls.clear(); }

  async function loadCurrentProfile() {
    const { data, error } = await client.from('Usuarios').select('id,nome,id_publico,iniciais').eq('id', currentUser.id).maybeSingle();
    if (error) throw error;
    el('currentUserName').textContent = data?.nome || data?.id_publico || 'Usuário';
  }
  async function loadConversations() {
    const { data, error } = await client.from('Conversas').select('id,usuario_a,usuario_b,created_at,updated_at')
      .or(`usuario_a.eq.${currentUser.id},usuario_b.eq.${currentUser.id}`).order('updated_at', { ascending: false });
    if (error) throw error;
    const conversations = data || [];
    const otherIds = [...new Set(conversations.map(c => c.usuario_a === currentUser.id ? c.usuario_b : c.usuario_a))];
    profiles = new Map();
    if (otherIds.length) {
      const { data: users } = await client.from('Usuarios').select('id,nome,id_publico,iniciais,ultimo_online').in('id', otherIds);
      (users || []).forEach(user => profiles.set(user.id, user));
    }
    conversationList.replaceChildren();
    if (!conversations.length) {
      const empty = document.createElement('div'); empty.className = 'list-empty'; empty.textContent = 'Nenhuma conversa encontrada.'; conversationList.append(empty); return;
    }
    for (const conversation of conversations) {
      const otherId = conversation.usuario_a === currentUser.id ? conversation.usuario_b : conversation.usuario_a;
      const user = profiles.get(otherId);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'conversation-item'; button.dataset.id = conversation.id;
      const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = user?.iniciais || initials(user?.nome);
      const meta = document.createElement('span'); meta.className = 'conversation-meta';
      const name = document.createElement('strong'); name.textContent = user?.nome || 'Usuário NVChat';
      const detail = document.createElement('small'); detail.textContent = user?.id_publico ? `@${user.id_publico}` : 'Conversa NVChat';
      meta.append(name, detail); button.append(avatar, meta); button.addEventListener('click', () => openConversation(conversation, user)); conversationList.append(button);
    }
  }

  async function authenticatedMediaUrl(path) {
    const { data, error } = await client.storage.from('mensagens').download(path);
    if (error || !data) throw error || new Error('Arquivo indisponível.');
    const url = URL.createObjectURL(data); objectUrls.add(url); return url;
  }

  function appendMessage(message) {
    if (!message || message.apagada_em) return;
    const box = document.createElement('div'); box.className = `message${message.remetente_id === currentUser.id ? ' mine' : ''}`; box.dataset.messageId = message.id || '';
    const body = document.createElement('div'); body.className = 'message-body';
    if (message.tipo === 'texto') {
      body.textContent = message.texto || '';
    } else if (message.tipo === 'foto' && message.arquivo_path) {
      const placeholder = document.createElement('div'); placeholder.className = 'media-loading'; placeholder.textContent = '📷 Carregando foto…'; body.append(placeholder);
      authenticatedMediaUrl(message.arquivo_path).then(url => {
        const img = document.createElement('img'); img.className = 'chat-photo'; img.src = url; img.alt = 'Foto enviada';
        img.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
        placeholder.replaceWith(img); messagesEl.scrollTop = messagesEl.scrollHeight;
      }).catch(() => { placeholder.textContent = '📷 Não foi possível abrir a foto.'; });
    } else if (message.tipo === 'audio' && message.arquivo_path) {
      const wrap = document.createElement('div'); wrap.className = 'chat-audio';
      const label = document.createElement('span'); label.textContent = `🎤 ${formatDuration(message.duracao_ms)}`;
      const placeholder = document.createElement('span'); placeholder.className = 'media-loading'; placeholder.textContent = 'Carregando áudio…';
      wrap.append(label, placeholder); body.append(wrap);
      authenticatedMediaUrl(message.arquivo_path).then(url => {
        const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = url; placeholder.replaceWith(audio);
      }).catch(() => { placeholder.textContent = 'Áudio indisponível.'; });
    } else if (message.tipo === 'localizacao') {
      if (message.latitude != null && message.longitude != null) {
        const link = document.createElement('a'); link.className = 'location-link'; link.target = '_blank'; link.rel = 'noopener';
        link.href = `https://www.google.com/maps?q=${encodeURIComponent(message.latitude + ',' + message.longitude)}`;
        link.textContent = `📍 ${Number(message.latitude).toFixed(7)}, ${Number(message.longitude).toFixed(7)}`; body.append(link);
      } else body.textContent = '📍 Localização compartilhada.';
    } else body.textContent = message.texto || `[${message.tipo}]`;
    const time = document.createElement('span'); time.className = 'time'; time.textContent = formatTime(message.created_at); box.append(body, time); messagesEl.append(box);
  }

  async function openConversation(conversation, user) {
    currentConversation = conversation; clearObjectUrls(); resetAudioPreview(); chatView.classList.add('open-conversation');
    document.querySelectorAll('.conversation-item').forEach(item => item.classList.toggle('active', item.dataset.id === conversation.id));
    conversationName.textContent = user?.nome || 'Usuário NVChat'; conversationStatus.textContent = user?.id_publico ? `@${user.id_publico}` : '';
    messageForm.classList.remove('hidden'); messagesEl.classList.remove('empty-state'); messagesEl.textContent = 'Carregando…';
    const { data, error } = await client.from('Mensagens')
      .select('id,conversa_id,remetente_id,tipo,texto,arquivo_path,mime_type,duracao_ms,latitude,longitude,precisao_m,created_at,apagada_em')
      .eq('conversa_id', conversation.id).order('created_at', { ascending: true }).limit(500);
    if (error) { messagesEl.textContent = 'Não foi possível carregar as mensagens.'; return; }
    messagesEl.textContent = ''; (data || []).forEach(appendMessage); messagesEl.scrollTop = messagesEl.scrollHeight; subscribeToMessages(conversation.id); messageInput.focus();
  }
  function subscribeToMessages(conversationId) {
    if (messageChannel) client.removeChannel(messageChannel);
    messageChannel = client.channel(`web-messages-${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'Mensagens', filter: `conversa_id=eq.${conversationId}` }, payload => {
        if (payload.new?.conversa_id !== currentConversation?.id) return; appendMessage(payload.new); messagesEl.scrollTop = messagesEl.scrollHeight;
      }).subscribe();
  }

  async function insertMessage(payload) {
    const { error } = await client.from('Mensagens').insert(payload); if (error) throw error;
  }
  async function sendMessage(event) {
    event.preventDefault(); const text = messageInput.value.trim(); if (!text || !currentConversation) return;
    const submit = el('sendTextButton'); submit.disabled = true;
    try { await insertMessage({ conversa_id: currentConversation.id, remetente_id: currentUser.id, tipo: 'texto', texto: text }); messageInput.value = ''; messageInput.style.height = ''; }
    catch (_) { alert('Não foi possível enviar a mensagem.'); }
    finally { submit.disabled = false; }
  }

  async function preparePhoto(file) {
    if (!file.type.startsWith('image/')) throw new Error('Selecione uma imagem.');
    if (file.type === 'image/gif') return { blob: file, mime: file.type, ext: 'gif' };
    const bitmap = await createImageBitmap(file); const max = 1600; const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.();
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Falha ao preparar foto.')), 'image/jpeg', .82));
    return { blob, mime: 'image/jpeg', ext: 'jpg' };
  }
  async function sendPhoto(file) {
    if (!currentConversation) return;
    photoButton.disabled = true; photoButton.textContent = '…';
    try {
      const prepared = await preparePhoto(file); const path = `${currentConversation.id}/${crypto.randomUUID()}.${prepared.ext}`;
      const { error: uploadError } = await client.storage.from('mensagens').upload(path, prepared.blob, { contentType: prepared.mime, upsert: false });
      if (uploadError) throw uploadError;
      await insertMessage({ conversa_id: currentConversation.id, remetente_id: currentUser.id, tipo: 'foto', arquivo_path: path, mime_type: prepared.mime });
    } catch (error) { alert(`Não foi possível enviar a foto. ${error.message || ''}`); }
    finally { photoButton.disabled = false; photoButton.textContent = '📷'; photoInput.value = ''; }
  }

  function supportedAudioMime() {
    if (!window.MediaRecorder) return '';
    return ['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(type => MediaRecorder.isTypeSupported(type)) || '';
  }
  function updateRecordingTimer() {
    const elapsed = Date.now() - recordingStartedAt; recordingStatus.textContent = `● Gravando ${formatDuration(elapsed)}`;
  }
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { alert('Este navegador não oferece gravação de áudio.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const mime = supportedAudioMime();
      mediaChunks = []; recordingStartedAt = Date.now();
      mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 }) : new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => { if (e.data?.size) mediaChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop()); pendingAudioDuration = Date.now() - recordingStartedAt; pendingAudioMime = mediaRecorder.mimeType || mime || 'audio/webm';
        pendingAudioBlob = new Blob(mediaChunks, { type: pendingAudioMime }); mediaRecorder = null; clearInterval(recordingTimer); recordingTimer = null;
        recordingStatus.classList.add('hidden'); audioButton.textContent = '🎤'; showAudioPreview();
      };
      mediaRecorder.start(250); audioButton.textContent = '■'; recordingStatus.classList.remove('hidden'); updateRecordingTimer(); recordingTimer = setInterval(updateRecordingTimer, 250);
    } catch (error) { alert('Não foi possível acessar o microfone.'); }
  }
  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return; if (Date.now() - recordingStartedAt < 500) { cancelLiveRecording(); alert('Áudio muito curto.'); return; } mediaRecorder.stop();
  }
  function cancelLiveRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') { mediaRecorder.stream?.getTracks().forEach(t => t.stop()); try { mediaRecorder.stop(); } catch (_) {} }
    mediaRecorder = null; mediaChunks = []; clearInterval(recordingTimer); recordingTimer = null; recordingStatus.classList.add('hidden'); audioButton.textContent = '🎤';
  }
  function showAudioPreview() {
    resetPreviewUrlOnly(); if (!pendingAudioBlob) return; const url = URL.createObjectURL(pendingAudioBlob); objectUrls.add(url); audioPreviewPlayer.src = url; audioPreview.classList.remove('hidden');
  }
  function resetPreviewUrlOnly() { audioPreviewPlayer.pause(); audioPreviewPlayer.removeAttribute('src'); audioPreviewPlayer.load(); }
  function resetAudioPreview() { resetPreviewUrlOnly(); pendingAudioBlob = null; pendingAudioDuration = 0; pendingAudioMime = ''; audioPreview.classList.add('hidden'); }
  function audioExtension(mime) { return mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'; }
  async function sendPendingAudio() {
    if (!pendingAudioBlob || !currentConversation) return; const send = el('sendAudioButton'); send.disabled = true; send.textContent = 'Enviando…';
    try {
      const path = `${currentConversation.id}/${crypto.randomUUID()}.${audioExtension(pendingAudioMime)}`;
      const { error: uploadError } = await client.storage.from('mensagens').upload(path, pendingAudioBlob, { contentType: pendingAudioMime, upsert: false });
      if (uploadError) throw uploadError;
      await insertMessage({ conversa_id: currentConversation.id, remetente_id: currentUser.id, tipo: 'audio', arquivo_path: path, mime_type: pendingAudioMime, duracao_ms: Math.round(pendingAudioDuration) });
      resetAudioPreview();
    } catch (error) { alert(`Não foi possível enviar o áudio. ${error.message || ''}`); }
    finally { send.disabled = false; send.textContent = 'Enviar áudio'; }
  }

  function subscribeToConversationChanges() {
    if (conversationsChannel) client.removeChannel(conversationsChannel);
    conversationsChannel = client.channel('web-conversations').on('postgres_changes', { event: '*', schema: 'public', table: 'Conversas' }, () => loadConversations().catch(() => {})).subscribe();
  }
  async function boot(session, force = false) {
    const user = session?.user || null;
    if (!user) { currentUser = null; bootingUserId = null; setSignedIn(false); return; }
    if (!force && bootingUserId === user.id && currentUser?.id === user.id) return;
    bootingUserId = user.id; currentUser = user; setSignedIn(true); conversationList.textContent = 'Carregando conversas…';
    try { await loadCurrentProfile(); await loadConversations(); subscribeToConversationChanges(); }
    catch (error) { console.error(error); conversationList.textContent = 'Sessão iniciada, mas não foi possível carregar as conversas.'; }
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault(); loginError.textContent = ''; loginButton.disabled = true; loginButton.textContent = 'Entrando…';
    try {
      const data = await callFunction('entrar', { id_publico: el('loginId').value.trim(), senha: el('loginPassword').value }); const tokenSession = data?.sessao;
      if (!tokenSession?.access_token || !tokenSession?.refresh_token) throw new Error('Sessão inválida recebida do servidor.');
      const { data: sessionData, error } = await client.auth.setSession({ access_token: tokenSession.access_token, refresh_token: tokenSession.refresh_token });
      if (error) throw error; if (!sessionData?.session?.user) throw new Error('Não foi possível confirmar a sessão.'); await boot(sessionData.session, true);
    } catch (error) { loginError.textContent = error.message || 'ID ou senha inválidos.'; setSignedIn(false); }
    finally { loginButton.disabled = false; loginButton.textContent = 'Entrar'; }
  });
  registerForm.addEventListener('submit', async event => {
    event.preventDefault(); registerError.textContent = ''; const name = el('registerName').value.trim(), id = el('registerId').value.trim(), password = el('registerPassword').value, confirm = el('registerConfirm').value;
    if (password !== confirm) { registerError.textContent = 'As senhas não são iguais.'; return; } if (password.length < 8) { registerError.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; return; }
    registerButton.disabled = true;
    try { const data = await callFunction('criar-conta', { nome: name, id_publico: id, senha: password }); if (!data?.chave_recuperacao) throw new Error('A chave de recuperação não foi retornada.'); lastRegisteredId = id; el('recoveryKey').textContent = data.chave_recuperacao; registerForm.reset(); showAuthMode('recovery'); }
    catch (error) { registerError.textContent = error.message || 'Não foi possível criar a conta.'; } finally { registerButton.disabled = false; }
  });

  el('showRegisterButton').addEventListener('click', () => showAuthMode('register')); el('showLoginButton').addEventListener('click', () => showAuthMode('login'));
  el('finishRecoveryButton').addEventListener('click', () => { showAuthMode('login'); el('loginId').value = lastRegisteredId; el('loginPassword').focus(); });
  el('copyRecoveryButton').addEventListener('click', async () => { try { await navigator.clipboard.writeText(el('recoveryKey').textContent); el('copyRecoveryButton').textContent = 'Chave copiada'; } catch (_) { alert('Copie a chave manualmente.'); } });
  el('logoutButton').addEventListener('click', async () => { cancelLiveRecording(); resetAudioPreview(); clearObjectUrls(); await client.auth.signOut(); currentConversation = null; chatView.classList.remove('open-conversation'); });
  el('backButton').addEventListener('click', () => { cancelLiveRecording(); resetAudioPreview(); chatView.classList.remove('open-conversation'); });
  messageForm.addEventListener('submit', sendMessage);
  photoButton.addEventListener('click', () => photoInput.click()); photoInput.addEventListener('change', () => { const file = photoInput.files?.[0]; if (file) sendPhoto(file); });
  audioButton.addEventListener('click', () => mediaRecorder ? stopRecording() : startRecording());
  el('cancelAudioButton').addEventListener('click', resetAudioPreview); el('sendAudioButton').addEventListener('click', sendPendingAudio);
  messageInput.addEventListener('input', () => { messageInput.style.height = 'auto'; messageInput.style.height = `${Math.min(messageInput.scrollHeight, 130)}px`; });
  messageInput.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); messageForm.requestSubmit(); } });

  client.auth.onAuthStateChange((_event, session) => setTimeout(() => boot(session).catch(console.error), 0));
  client.auth.getSession().then(({ data }) => boot(data.session).catch(console.error));
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
})();
