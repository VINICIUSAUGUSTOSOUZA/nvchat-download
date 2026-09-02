(function () {
  var form = document.getElementById('tester-form');
  if (!form) return;

  var cfg = window.NVCHAT_SUPABASE || {};
  var message = document.getElementById('tester-message');
  var submit = document.getElementById('tester-submit');
  var renderedAt = Date.now();
  var COOLDOWN_MS = 20000;
  var STORAGE_KEY = 'nvchatTesterLastSubmit';

  function setMessage(text, type) {
    message.textContent = text;
    message.className = 'form-message ' + type;
  }

  function clearMessage() {
    message.textContent = '';
    message.className = 'form-message';
  }

  function normalizeEmail(value) {
    return String(value || '').replace(/^\s+|\s+$/g, '').toLowerCase();
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function getLastSubmit() {
    try {
      return Number(window.localStorage.getItem(STORAGE_KEY) || 0);
    } catch (error) {
      return 0;
    }
  }

  function saveLastSubmit() {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch (error) {
      // O cadastro continua funcionando mesmo se o navegador bloquear localStorage.
    }
  }

  function resetButton() {
    submit.disabled = false;
    submit.textContent = 'Quero participar dos testes';
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    clearMessage();

    var nameInput = document.getElementById('tester-name');
    var emailInput = document.getElementById('tester-email');
    var consentInput = document.getElementById('tester-consent');
    var honeypotInput = document.getElementById('nvchat-website-check');

    var name = String(nameInput.value || '').replace(/^\s+|\s+$/g, '');
    var email = normalizeEmail(emailInput.value);
    var consent = Boolean(consentInput.checked);
    var honeypot = honeypotInput ? String(honeypotInput.value || '').replace(/^\s+|\s+$/g, '') : '';

    if (Date.now() - renderedAt < 1200) {
      setMessage('Aguarde um instante e tente novamente.', 'info');
      return;
    }

    if (honeypot) {
      setMessage('Não foi possível enviar este cadastro. Atualize a página e tente novamente.', 'error');
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

    if (!cfg.url || !cfg.publishableKey || !window.XMLHttpRequest) {
      setMessage('O cadastro está temporariamente indisponível. Atualize a página e tente novamente.', 'error');
      return;
    }

    var lastSubmit = getLastSubmit();
    if (Date.now() - lastSubmit < COOLDOWN_MS) {
      setMessage('Aguarde alguns segundos antes de enviar novamente.', 'info');
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Enviando...';

    var xhr = new XMLHttpRequest();
    var finished = false;

    function finish() {
      if (finished) return false;
      finished = true;
      resetButton();
      return true;
    }

    xhr.open('POST', cfg.url + '/rest/v1/nvchat_testers', true);
    xhr.setRequestHeader('apikey', cfg.publishableKey);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Prefer', 'return=minimal');
    xhr.timeout = 15000;

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || finished) return;

      var status = xhr.status;
      var response = {};
      try {
        response = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch (error) {
        response = {};
      }

      if (!finish()) return;

      if (status >= 200 && status < 300) {
        saveLastSubmit();
        form.reset();
        setMessage('Cadastro realizado com sucesso! Quando houver disponibilidade para novos testadores, você poderá receber o convite para participar dos testes do NVChat.', 'success');
        return;
      }

      if (status === 409 || response.code === '23505' || /duplicate|unique/i.test(String(response.message || ''))) {
        saveLastSubmit();
        setMessage('Este e-mail já está cadastrado na lista de interessados.', 'info');
        return;
      }

      setMessage('Não foi possível concluir o cadastro agora. Atualize a página e tente novamente.', 'error');
    };

    xhr.onerror = function () {
      if (!finish()) return;
      setMessage('Não foi possível conectar ao cadastro. Verifique sua internet e tente novamente.', 'error');
    };

    xhr.ontimeout = function () {
      if (!finish()) return;
      setMessage('O cadastro demorou para responder. Tente novamente.', 'error');
    };

    xhr.send(JSON.stringify({
      name: name || null,
      email: email,
      consent: true
    }));
  });
})();
