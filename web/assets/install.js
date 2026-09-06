(() => {
  const cfg = window.NVCHAT_SUPABASE;
  if (!cfg || !window.supabase) return;

  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  const sidebar = document.querySelector('.sidebar');
  const notificationPrompt = document.getElementById('notificationPrompt');
  const DISMISS_KEY = 'nvchat-install-prompt-dismissed-v1';
  let deferredPrompt = null;

  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  const card = document.createElement('section');
  card.id = 'installPrompt';
  card.className = 'install-prompt hidden';
  card.innerHTML = `
    <div class="install-prompt-icon">📲</div>
    <div class="install-prompt-copy">
      <strong>Deixe o NVChat como um aplicativo</strong>
      <span>Instale ou fixe o NVChat na tela inicial para abrir pelo ícone, sem precisar procurar o link no navegador.</span>
    </div>
    <button id="installNvchatButton" type="button">Instalar NVChat</button>
    <button id="dismissInstallPromptButton" class="install-prompt-dismiss" type="button" aria-label="Agora não">×</button>`;

  if (notificationPrompt?.parentNode) notificationPrompt.insertAdjacentElement('afterend', card);
  else sidebar?.prepend(card);

  const installButton = card.querySelector('#installNvchatButton');
  const dismissButton = card.querySelector('#dismissInstallPromptButton');

  function updateInstallPrompt(session) {
    if (isStandalone() || !session?.user?.id || localStorage.getItem(DISMISS_KEY) === '1') {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    installButton.textContent = deferredPrompt ? 'Instalar NVChat' : 'Como fixar o ícone';
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    client.auth.getSession().then(({ data }) => updateInstallPrompt(data?.session)).catch(() => {});
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    localStorage.removeItem(DISMISS_KEY);
    card.classList.add('hidden');
  });

  installButton?.addEventListener('click', async () => {
    if (deferredPrompt) {
      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      await promptEvent.prompt();
      try { await promptEvent.userChoice; } catch {}
      card.classList.add('hidden');
      return;
    }

    alert('Para colocar o NVChat na tela inicial: abra esta página no Google Chrome, toque em ⋮ no canto superior direito e escolha “Instalar app” ou “Adicionar à tela inicial”. Confirme e o ícone NVChat aparecerá junto dos seus aplicativos.');
  });

  dismissButton?.addEventListener('click', () => {
    localStorage.setItem(DISMISS_KEY, '1');
    card.classList.add('hidden');
  });

  client.auth.onAuthStateChange((_event, session) => updateInstallPrompt(session));
  client.auth.getSession().then(({ data }) => updateInstallPrompt(data?.session)).catch(() => {});
})();