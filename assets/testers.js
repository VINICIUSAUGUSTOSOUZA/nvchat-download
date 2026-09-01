(() => {
  const form = document.getElementById('tester-form');
  if (!form) return;

  const cfg = window.NVCHAT_SUPABASE;
  const message = document.getElementById('tester-message');
  const submit = document.getElementById('tester-submit');
  const renderedAt = Date.now();
  const COOLDOWN_MS = 20000;

  const setMessage = (text, type) => {
    message.textContent = text;
    message.className = `form-message ${type}`;
  };

  const normalizeEmail = (value) => value.trim().toLowerCase();
  const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.className = 'form-message';
    message.textContent = '';

    const name = document.getElementById('tester-name').value.trim();
    const email = normalizeEmail(document.getElementById('tester-email').value);
    const consent = document.getElementById('tester-consent').checked;
    const honeypot = document.getElementById('company').value.trim();

    if (honeypot) return;
    if (Date.now() - renderedAt < 1800) {
      setMessage('Aguarde um instante e tente novamente.', 'info');
      return;
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
      setMessage('O cadastro está temporariamente indisponível. Tente novamente mais tarde.', 'error');
      return;
    }

    const lastSubmit = Number(localStorage.getItem('nvchatTesterLastSubmit') || 0);
    if (Date.now() - lastSubmit < COOLDOWN_MS) {
      setMessage('Aguarde alguns segundos antes de enviar novamente.', 'info');
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Enviando...';

    try {
      const client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });

      const { error } = await client.from('nvchat_testers').insert({
        name: name || null,
        email,
        consent: true
      });

      localStorage.setItem('nvchatTesterLastSubmit', String(Date.now()));

      if (error) {
        if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) {
          setMessage('Este e-mail já está cadastrado na lista de interessados.', 'info');
          return;
        }
        console.error('NVChat tester signup failed:', error.code);
        setMessage('Não foi possível concluir o cadastro agora. Tente novamente mais tarde.', 'error');
        return;
      }

      form.reset();
      setMessage('Cadastro realizado com sucesso! Quando houver disponibilidade para novos testadores, você poderá receber o convite para participar dos testes do NVChat.', 'success');
    } catch (error) {
      console.error('NVChat tester signup unavailable.');
      setMessage('Não foi possível concluir o cadastro agora. Tente novamente mais tarde.', 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Quero participar dos testes';
    }
  });
})();
