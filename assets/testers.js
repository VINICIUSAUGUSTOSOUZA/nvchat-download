(() => {
  const form = document.getElementById('tester-form');
  if (!form) return;

  const cfg = window.NVCHAT_SUPABASE;
  const message = document.getElementById('tester-message');
  const submit = document.getElementById('tester-submit');
  const renderedAt = Date.now();
  const COOLDOWN_MS = 20000;
  const STORAGE_KEY = 'nvchatTesterLastSubmit';

  const setMessage = (text, type) => {
    message.textContent = text;
    message.className = `form-message ${type}`;
  };

  const normalizeEmail = (value) => value.trim().toLowerCase();
  const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const getLastSubmit = () => {
    try {
      return Number(localStorage.getItem(STORAGE_KEY) || 0);
    } catch {
      return 0;
    }
  };

  const saveLastSubmit = () => {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // O cadastro deve continuar funcionando mesmo se o navegador bloquear localStorage.
    }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.className = 'form-message';
    message.textContent = '';

    const name = document.getElementById('tester-name').value.trim();
    const email = normalizeEmail(document.getElementById('tester-email').value);
    const consent = document.getElementById('tester-consent').checked;
    const honeypotInput = document.getElementById('company');
    const honeypot = honeypotInput?.value.trim() || '';

    // Alguns navegadores podem preencher automaticamente o campo anti-bot "company".
    // Só bloqueamos quando ele é preenchido e enviado quase imediatamente após abrir a página.
    // Em uso humano normal, limpamos esse preenchimento automático e seguimos com o cadastro.
    if (honeypot) {
      const elapsed = Date.now() - renderedAt;
      if (elapsed < 3000) {
        setMessage('Aguarde alguns segundos e tente novamente.', 'info');
        return;
      }
      honeypotInput.value = '';
    }

    if (!isEmail(email)) {
      setMessage('Digite um e-mail válido.', 'error');
      return;
    }
    if (!consent) {
      setMessage('Para participar, é necessário autorizar o uso do e-mail para contato sobre os testes.', 'error');
      return;
    }
    if (!cfg?.url || !cfg?.publishableKey || !window.supabase) {
      setMessage('O cadastro está temporariamente indisponível. Atualize a página e tente novamente.', 'error');
      return;
    }

    const lastSubmit = getLastSubmit();
    if (Date.now() - lastSubmit < COOLDOWN_MS) {
      setMessage('Aguarde alguns segundos antes de enviar novamente.', 'info');
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Enviando...';

    try {
      const client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      });

      const { error } = await client.from('nvchat_testers').insert({
        name: name || null,
        email,
        consent: true
      });

      if (error) {
        if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) {
          saveLastSubmit();
          setMessage('Este e-mail já está cadastrado na lista de interessados.', 'info');
          return;
        }
        console.error('NVChat tester signup failed:', error.code, error.message);
        setMessage('Não foi possível concluir o cadastro agora. Tente novamente em alguns instantes.', 'error');
        return;
      }

      saveLastSubmit();
      form.reset();
      setMessage('Cadastro realizado com sucesso! Quando houver disponibilidade para novos testadores, você poderá receber o convite para participar dos testes do NVChat.', 'success');
    } catch (error) {
      console.error('NVChat tester signup unavailable:', error);
      setMessage('Não foi possível conectar ao cadastro. Atualize a página e tente novamente.', 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Quero participar dos testes';
    }
  });
})();
