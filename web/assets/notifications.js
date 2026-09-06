(() => {
  const cfg = window.NVCHAT_SUPABASE;
  const button = document.getElementById('notificationButton');
  const list = document.getElementById('conversationList');

  if (!cfg || !window.supabase || !('serviceWorker' in navigator) || !('Notification' in window)) {
    if (button) {
      button.disabled = true;
      button.title = 'Notificações não suportadas neste navegador';
    }
    return;
  }

  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  let registration = null;
  let channel = null;
  let currentUserId = null;

  const bodyFor = message => {
    if (message.tipo === 'texto') return (message.texto || 'Nova mensagem').trim().slice(0, 120);
    if (message.tipo === 'foto') return '📷 Enviou uma foto';
    if (message.tipo === 'audio') return '🎤 Enviou um áudio';
    if (message.tipo === 'localizacao') return '📍 Enviou uma localização';
    return 'Você recebeu uma nova mensagem.';
  };

  function updateButton() {
    if (!button) return;
    if (Notification.permission === 'granted') {
      button.textContent = '🔔';
      button.classList.add('enabled');
      button.title = 'Notificações ativadas';
    } else if (Notification.permission === 'denied') {
      button.textContent = '🔕';
      button.classList.remove('enabled');
      button.title = 'Notificações bloqueadas no navegador';
    } else {
      button.textContent = '🔔';
      button.classList.remove('enabled');
      button.title = 'Ativar notificações';
    }
  }

  async function ensureRegistration() {
    if (registration) return registration;
    registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    registration = await navigator.serviceWorker.ready;
    return registration;
  }

  async function showNotification(message) {
    if (Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;

    const { data: sender } = await client
      .from('Usuarios')
      .select('nome,id_publico')
      .eq('id', message.remetente_id)
      .maybeSingle();

    const reg = await ensureRegistration();
    await reg.showNotification(sender?.nome ? `NVChat — ${sender.nome}` : 'NVChat — nova mensagem', {
      body: bodyFor(message),
      icon: './icon.svg',
      badge: './icon.svg',
      tag: `nvchat-${message.conversa_id}`,
      renotify: true,
      vibrate: [180, 80, 180],
      data: { conversationId: message.conversa_id, url: './' }
    });
  }

  async function subscribeRealtime() {
    if (Notification.permission !== 'granted') return;
    const { data } = await client.auth.getSession();
    const session = data?.session;
    if (!session?.user?.id) return;

    if (channel && currentUserId === session.user.id) return;
    if (channel) await client.removeChannel(channel);

    currentUserId = session.user.id;
    channel = client
      .channel(`nvchat-web-notifications-${currentUserId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'Mensagens' }, payload => {
        const message = payload.new;
        if (!message || message.remetente_id === currentUserId) return;
        showNotification(message).catch(() => {});
      })
      .subscribe();
  }

  function clickConversation(conversationId) {
    if (!conversationId) return false;
    const safe = window.CSS?.escape ? CSS.escape(conversationId) : conversationId.replace(/[^a-zA-Z0-9_-]/g, '');
    const item = document.querySelector(`.conversation-item[data-id="${safe}"]`);
    if (!item) return false;
    item.click();
    return true;
  }

  function openConversationWhenReady(conversationId) {
    if (!conversationId || clickConversation(conversationId)) return;
    if (!list) return;
    const observer = new MutationObserver(() => {
      if (!clickConversation(conversationId)) return;
      observer.disconnect();
    });
    observer.observe(list, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
  }

  button?.addEventListener('click', async () => {
    try {
      await ensureRegistration();
      const permission = await Notification.requestPermission();
      updateButton();
      if (permission !== 'granted') return;
      await subscribeRealtime();
      await registration.showNotification('NVChat', {
        body: 'Notificações ativadas neste celular.',
        icon: './icon.svg',
        badge: './icon.svg',
        tag: 'nvchat-notifications-enabled',
        data: { url: './' }
      });
    } catch (error) {
      console.warn('Falha ao ativar notificações do NVChat:', error);
    }
  });

  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'OPEN_CONVERSATION') {
      openConversationWhenReady(event.data.conversationId);
    }
  });

  client.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      currentUserId = null;
      if (channel) client.removeChannel(channel);
      channel = null;
      return;
    }
    subscribeRealtime().catch(() => {});
  });

  ensureRegistration().catch(() => {});
  updateButton();
  subscribeRealtime().catch(() => {});

  const fromNotification = new URL(location.href).searchParams.get('conversation');
  if (fromNotification) {
    openConversationWhenReady(fromNotification);
    history.replaceState(null, '', location.pathname + location.hash);
  }
})();