(() => {
  const cfg = window.NVCHAT_SUPABASE;
  if (!cfg || !window.supabase) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">Não foi possível iniciar o NVChat Web.</p>';
    return;
  }

  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const el = (id) => document.getElementById(id);
  const authView = el('authView');
  const chatView = el('chatView');
  const loginForm = el('loginForm');
  const registerForm = el('registerForm');
  const recoveryView = el('recoveryView');
  const loginButton = el('loginButton');
  const registerButton = el('registerButton');
  const loginError = el('loginError');
  const registerError = el('registerError');
  const conversationList = el('conversationList');
  const messagesEl = el('messages');
  const messageForm = el('messageForm');
  const messageInput = el('messageInput');
  const conversationName = el('conversationName');
  const conversationStatus = el('conversationStatus');

  let currentUser = null;
  let currentConversation = null;
  let messageChannel = null;
  let conversationsChannel = null;
  let profiles = new Map();
  let lastRegisteredId = '';

  const initials = (name = 'NV') => name.trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || 'NV';
  const formatTime = (date) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(date));

  function parseError(body, fallback) {
    try {
      const data = JSON.parse(body);
      return data.erro || data.message || data.msg || fallback;
    } catch (_) {
      return fallback;
    }
  }

  async function callFunction(name, payload) {
    let response;
    try {
      response = await fetch(`${cfg.url.replace(/\/$/, '')}/functions/v1/${name}`, {
        method: 'POST',
        headers: {
          apikey: cfg.publishableKey,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      throw new Error(`Falha de conexão: ${error.message || 'verifique sua internet.'}`);
    }

    const body = await response.text();
    if (!response.ok) throw new Error(parseError(body, 'Não foi possível concluir a operação.'));
    try {
      return JSON.parse(body);
    } catch (_) {
      throw new Error('Resposta inválida do servidor.');
    }
  }

  function showAuthMode(mode) {
    loginError.textContent = '';
    registerError.textContent = '';
    loginForm.classList.toggle('hidden', mode !== 'login');
    registerForm.classList.toggle('hidden', mode !== 'register');
    recoveryView.classList.toggle('hidden', mode !== 'recovery');
    el('authSubtitle').textContent = mode === 'register'
      ? 'Crie sua conta do NVChat sem e-mail ou telefone.'
      : mode === 'recovery'
        ? 'Sua conta foi criada com sucesso.'
        : 'Entre com o mesmo ID e senha usados no aplicativo.';
  }

  function setSignedIn(signedIn) {
    authView.classList.toggle('hidden', signedIn);
    chatView.classList.toggle('hidden', !signedIn);
    if (!signedIn) showAuthMode('login');
  }

  async function loadCurrentProfile() {
    const { data } = await client.from('Usuarios').select('id,nome,id_publico,iniciais').eq('id', currentUser.id).maybeSingle();
    el('currentUserName').textContent = data?.nome || data?.id_publico || 'Usuário';
  }

  async function loadConversations() {
    const { data, error } = await client
      .from('Conversas')
      .select('id,usuario_a,usuario_b,created_at,updated_at')
      .or(`usuario_a.eq.${currentUser.id},usuario_b.eq.${currentUser.id}`)
      .order('updated_at', { ascending: false });

    if (error) {
      conversationList.textContent = 'Não foi possível carregar as conversas.';
      return;
    }

    const conversations = data || [];
    const otherIds = [...new Set(conversations.map(c => c.usuario_a === currentUser.id ? c.usuario_b : c.usuario_a))];
    profiles = new Map();

    if (otherIds.length) {
      const { data: users } = await client.from('Usuarios').select('id,nome,id_publico,iniciais,ultimo_online').in('id', otherIds);
      (users || []).forEach(user => profiles.set(user.id, user));
    }

    conversationList.replaceChildren();
    if (!conversations.length) {
      const empty = document.createElement('div');
      empty.style.padding = '20px';
      empty.style.color = '#6b7280';
      empty.textContent = 'Nenhuma conversa encontrada.';
      conversationList.append(empty);
      return;
    }

    for (const conversation of conversations) {
      const otherId = conversation.usuario_a === currentUser.id ? conversation.usuario_b : conversation.usuario_a;
      const user = profiles.get(otherId);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'conversation-item';
      button.dataset.id = conversation.id;

      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.textContent = user?.iniciais || initials(user?.nome);

      const meta = document.createElement('span');
      meta.className = 'conversation-meta';
      const name = document.createElement('strong');
      name.textContent = user?.nome || 'Usuário NVChat';
      const detail = document.createElement('small');
      detail.textContent = user?.id_publico ? `ID ${user.id_publico}` : 'Conversa NVChat';
      meta.append(name, detail);
      button.append(avatar, meta);
      button.addEventListener('click', () => openConversation(conversation, user));
      conversationList.append(button);
    }
  }

  function appendMessage(message) {
    if (!message || message.apagada_em) return;
    const box = document.createElement('div');
    box.className = `message${message.remetente_id === currentUser.id ? ' mine' : ''}`;

    const body = document.createElement('span');
    if (message.tipo === 'texto') body.textContent = message.texto || '';
    else if (message.tipo === 'imagem') body.textContent = '📷 Imagem — abra no aplicativo nesta primeira versão web.';
    else if (message.tipo === 'audio') body.textContent = '🎤 Áudio — reprodução web entra na próxima etapa.';
    else if (message.tipo === 'localizacao') body.textContent = '📍 Localização compartilhada.';
    else body.textContent = message.texto || `[${message.tipo}]`;

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatTime(message.created_at);
    box.append(body, time);
    messagesEl.append(box);
  }

  async function openConversation(conversation, user) {
    currentConversation = conversation;
    chatView.classList.add('open-conversation');
    document.querySelectorAll('.conversation-item').forEach(item => item.classList.toggle('active', item.dataset.id === conversation.id));
    conversationName.textContent = user?.nome || 'Usuário NVChat';
    conversationStatus.textContent = user?.id_publico ? `ID ${user.id_publico}` : '';
    messageForm.classList.remove('hidden');
    messagesEl.classList.remove('empty-state');
    messagesEl.textContent = '';

    const { data, error } = await client
      .from('Mensagens')
      .select('id,conversa_id,remetente_id,tipo,texto,arquivo_path,mime_type,duracao_ms,created_at,apagada_em')
      .eq('conversa_id', conversation.id)
      .order('created_at', { ascending: true })
      .limit(500);

    if (error) {
      messagesEl.textContent = 'Não foi possível carregar as mensagens.';
      return;
    }

    (data || []).forEach(appendMessage);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    subscribeToMessages(conversation.id);
    messageInput.focus();
  }

  function subscribeToMessages(conversationId) {
    if (messageChannel) client.removeChannel(messageChannel);
    messageChannel = client
      .channel(`web-messages-${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'Mensagens', filter: `conversa_id=eq.${conversationId}` }, payload => {
        if (payload.new?.conversa_id !== currentConversation?.id) return;
        appendMessage(payload.new);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      })
      .subscribe();
  }

  async function sendMessage(event) {
    event.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !currentConversation) return;

    const submit = messageForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    const { error } = await client.from('Mensagens').insert({
      conversa_id: currentConversation.id,
      remetente_id: currentUser.id,
      tipo: 'texto',
      texto: text
    });
    submit.disabled = false;

    if (!error) {
      messageInput.value = '';
      messageInput.style.height = '';
    } else {
      alert('Não foi possível enviar a mensagem.');
    }
  }

  function subscribeToConversationChanges() {
    if (conversationsChannel) client.removeChannel(conversationsChannel);
    conversationsChannel = client
      .channel('web-conversations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'Conversas' }, () => loadConversations())
      .subscribe();
  }

  async function boot(session) {
    currentUser = session?.user || null;
    setSignedIn(Boolean(currentUser));
    if (!currentUser) return;
    await Promise.all([loadCurrentProfile(), loadConversations()]);
    subscribeToConversationChanges();
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.textContent = '';
    loginButton.disabled = true;
    const id = el('loginId').value.trim();
    const password = el('loginPassword').value;

    try {
      const data = await callFunction('entrar', { id_publico: id, senha: password });
      const session = data?.sessao;
      if (!session?.access_token || !session?.refresh_token) throw new Error('Sessão inválida recebida do servidor.');
      const { error } = await client.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token
      });
      if (error) throw error;
    } catch (error) {
      loginError.textContent = error.message || 'ID ou senha inválidos.';
    } finally {
      loginButton.disabled = false;
    }
  });

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    registerError.textContent = '';
    const name = el('registerName').value.trim();
    const id = el('registerId').value.trim();
    const password = el('registerPassword').value;
    const confirm = el('registerConfirm').value;

    if (password !== confirm) {
      registerError.textContent = 'As senhas não são iguais.';
      return;
    }
    if (password.length < 8) {
      registerError.textContent = 'A senha precisa ter pelo menos 8 caracteres.';
      return;
    }

    registerButton.disabled = true;
    try {
      const data = await callFunction('criar-conta', { nome: name, id_publico: id, senha: password });
      if (!data?.chave_recuperacao) throw new Error('A conta foi criada, mas a chave de recuperação não foi retornada.');
      lastRegisteredId = id;
      el('recoveryKey').textContent = data.chave_recuperacao;
      registerForm.reset();
      showAuthMode('recovery');
    } catch (error) {
      registerError.textContent = error.message || 'Não foi possível criar a conta.';
    } finally {
      registerButton.disabled = false;
    }
  });

  el('showRegisterButton').addEventListener('click', () => showAuthMode('register'));
  el('showLoginButton').addEventListener('click', () => showAuthMode('login'));
  el('finishRecoveryButton').addEventListener('click', () => {
    showAuthMode('login');
    el('loginId').value = lastRegisteredId;
    el('loginPassword').focus();
  });
  el('copyRecoveryButton').addEventListener('click', async () => {
    const key = el('recoveryKey').textContent;
    try {
      await navigator.clipboard.writeText(key);
      el('copyRecoveryButton').textContent = 'Chave copiada';
    } catch (_) {
      alert('Selecione a chave acima e copie manualmente.');
    }
  });

  el('logoutButton').addEventListener('click', async () => {
    await client.auth.signOut();
    currentConversation = null;
    chatView.classList.remove('open-conversation');
  });
  el('backButton').addEventListener('click', () => chatView.classList.remove('open-conversation'));
  messageForm.addEventListener('submit', sendMessage);
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 130)}px`;
  });
  messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      messageForm.requestSubmit();
    }
  });

  client.auth.onAuthStateChange((_event, session) => boot(session));
  client.auth.getSession().then(({ data }) => boot(data.session));

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
})();
