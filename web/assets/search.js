(() => {
  const cfg = window.NVCHAT_SUPABASE;
  if (!cfg || !window.supabase) return;

  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  const form = document.getElementById('userSearchForm');
  const input = document.getElementById('userSearchInput');
  const button = document.getElementById('userSearchButton');
  const status = document.getElementById('userSearchStatus');
  const dialog = document.getElementById('userResultDialog');
  const resultName = document.getElementById('userResultName');
  const resultId = document.getElementById('userResultId');
  const cancelButton = document.getElementById('cancelUserResultButton');
  const startButton = document.getElementById('startConversationButton');

  let foundUser = null;

  const normalizeId = value => value.trim().toLowerCase().replace(/^@/, '');

  async function currentSession() {
    const { data } = await client.auth.getSession();
    return data?.session || null;
  }

  async function findUser(publicId) {
    const id = normalizeId(publicId);
    const { data, error } = await client
      .from('Usuarios')
      .select('id,id_publico,nome,iniciais')
      .eq('id_publico', id)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function getOrCreateConversation(me, otherId) {
    const { data: existing, error: existingError } = await client
      .from('Conversas')
      .select('id,usuario_a,usuario_b,created_at,updated_at')
      .or(`and(usuario_a.eq.${me},usuario_b.eq.${otherId}),and(usuario_a.eq.${otherId},usuario_b.eq.${me})`)
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.id) return existing.id;

    const { data: created, error: createError } = await client
      .from('Conversas')
      .insert({ usuario_a: me, usuario_b: otherId })
      .select('id')
      .single();

    if (!createError && created?.id) return created.id;

    const { data: retry, error: retryError } = await client
      .from('Conversas')
      .select('id')
      .or(`and(usuario_a.eq.${me},usuario_b.eq.${otherId}),and(usuario_a.eq.${otherId},usuario_b.eq.${me})`)
      .limit(1)
      .maybeSingle();
    if (retryError || !retry?.id) throw createError || retryError || new Error('Não foi possível abrir a conversa.');
    return retry.id;
  }

  function openConversationAfterReload(conversationId) {
    sessionStorage.setItem('nvchat_open_conversation', conversationId);
    window.location.reload();
  }

  function tryOpenPendingConversation() {
    const id = sessionStorage.getItem('nvchat_open_conversation');
    if (!id) return;
    const target = document.querySelector(`.conversation-item[data-id="${CSS.escape(id)}"]`);
    if (target) {
      sessionStorage.removeItem('nvchat_open_conversation');
      target.click();
      return;
    }
    const list = document.getElementById('conversationList');
    if (!list) return;
    const observer = new MutationObserver(() => {
      const item = document.querySelector(`.conversation-item[data-id="${CSS.escape(id)}"]`);
      if (!item) return;
      observer.disconnect();
      sessionStorage.removeItem('nvchat_open_conversation');
      item.click();
    });
    observer.observe(list, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
  }

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const publicId = normalizeId(input.value);
    if (!publicId) return;
    status.textContent = '';
    button.disabled = true;
    button.textContent = 'Buscando…';
    try {
      const session = await currentSession();
      if (!session?.user?.id) throw new Error('Sessão inválida.');
      const user = await findUser(publicId);
      if (!user) {
        status.textContent = 'Usuário não encontrado.';
        return;
      }
      if (user.id === session.user.id) {
        status.textContent = 'Esse é o seu próprio ID.';
        return;
      }
      foundUser = user;
      resultName.textContent = user.nome || 'Usuário NVChat';
      resultId.textContent = `@${user.id_publico}`;
      dialog.showModal();
    } catch (error) {
      status.textContent = error.message || 'Erro ao buscar usuário.';
    } finally {
      button.disabled = false;
      button.textContent = 'Buscar';
    }
  });

  cancelButton?.addEventListener('click', () => {
    foundUser = null;
    dialog.close();
  });

  startButton?.addEventListener('click', async () => {
    if (!foundUser) return;
    startButton.disabled = true;
    startButton.textContent = 'Abrindo…';
    try {
      const session = await currentSession();
      if (!session?.user?.id) throw new Error('Sessão inválida.');
      const id = await getOrCreateConversation(session.user.id, foundUser.id);
      dialog.close();
      openConversationAfterReload(id);
    } catch (error) {
      status.textContent = error.message || 'Não foi possível abrir a conversa.';
      dialog.close();
    } finally {
      startButton.disabled = false;
      startButton.textContent = 'CONVERSAR';
    }
  });

  tryOpenPendingConversation();
})();