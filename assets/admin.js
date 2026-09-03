(() => {
  const cfg = window.NVCHAT_SUPABASE;
  if (!cfg?.url || !cfg?.publishableKey || !window.supabase) return;

  const client = window.supabase.createClient(cfg.url, cfg.publishableKey);
  const loginView = document.getElementById('login-view');
  const adminView = document.getElementById('admin-view');
  const loginForm = document.getElementById('login-form');
  const loginMessage = document.getElementById('login-message');
  const adminMessage = document.getElementById('admin-message');
  const rowsEl = document.getElementById('tester-rows');
  const searchInput = document.getElementById('search-input');
  const statusFilter = document.getElementById('status-filter');
  const selectAll = document.getElementById('select-all');
  const selectionCount = document.getElementById('selection-count');
  const selectedIds = new Set();
  let testers = [];
  let shortLinks = [];

  const showMessage = (el, text, type = 'success') => {
    if (!el) return;
    el.textContent = text;
    el.className = `message show ${type}`;
  };
  const clearMessage = (el) => {
    if (!el) return;
    el.textContent = '';
    el.className = 'message';
  };
  const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const formatDate = (value) => value
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
    : '—';
  const formatCsvDate = (value) => value ? formatDate(value) : '';

  const filtered = () => {
    const q = searchInput.value.trim().toLowerCase();
    const status = statusFilter.value;
    return testers.filter((t) => {
      const matchesSearch = !q || (t.name || '').toLowerCase().includes(q) || t.email.toLowerCase().includes(q);
      const matchesStatus = status === 'all' || t.status === status;
      return matchesSearch && matchesStatus;
    });
  };
  const selected = () => testers.filter((t) => selectedIds.has(t.id));

  const updateStats = () => {
    document.getElementById('total-count').textContent = testers.length;
    document.getElementById('interested-count').textContent = testers.filter(t => t.status === 'interessado').length;
    document.getElementById('invited-count').textContent = testers.filter(t => t.status === 'convidado').length;
    document.getElementById('active-count').textContent = testers.filter(t => t.status === 'ativo').length;
  };

  const updateSelectionUi = () => {
    const count = selectedIds.size;
    selectionCount.textContent = `${count} selecionado(s)`;
    ['mark-invited', 'copy-selected', 'export-selected'].forEach((id) => {
      document.getElementById(id).disabled = count === 0;
    });
    const visible = filtered();
    selectAll.checked = visible.length > 0 && visible.every(t => selectedIds.has(t.id));
    selectAll.indeterminate = visible.some(t => selectedIds.has(t.id)) && !selectAll.checked;
  };

  const render = () => {
    const list = filtered();
    if (!list.length) {
      rowsEl.innerHTML = '<tr><td colspan="8" class="empty">Nenhum cadastro encontrado.</td></tr>';
      updateSelectionUi();
      return;
    }
    rowsEl.innerHTML = list.map(t => `
      <tr data-id="${t.id}">
        <td><input class="row-check" type="checkbox" ${selectedIds.has(t.id) ? 'checked' : ''} aria-label="Selecionar ${escapeHtml(t.email)}"></td>
        <td>${escapeHtml(t.name || '—')}</td>
        <td>${escapeHtml(t.email)}</td>
        <td>${formatDate(t.created_at)}</td>
        <td><select class="row-status" aria-label="Status de ${escapeHtml(t.email)}">${['interessado','convidado','ativo','removido'].map(s => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}</select></td>
        <td>${formatDate(t.invited_at)}</td>
        <td><textarea class="note-input" maxlength="1000" placeholder="Observação interna" aria-label="Observações de ${escapeHtml(t.email)}">${escapeHtml(t.notes || '')}</textarea></td>
        <td><button class="save-row">Salvar</button></td>
      </tr>`).join('');
    updateSelectionUi();
  };

  const loadTesters = async () => {
    clearMessage(adminMessage);
    const { data, error } = await client.from('nvchat_testers')
      .select('id,name,email,created_at,consent,status,invited_at,notes')
      .order('created_at', { ascending: false });
    if (error) {
      showMessage(adminMessage, 'Não foi possível carregar os cadastros. Verifique a autorização administrativa.', 'error');
      return;
    }
    testers = data || [];
    selectedIds.clear();
    updateStats();
    render();
  };

  const baseUrl = () => new URL('.', window.location.href);
  const shortUrlFor = (code) => new URL(code, baseUrl()).href;
  const randomCode = () => Math.random().toString(36).slice(2, 8);

  const updateLinkStats = () => {
    document.getElementById('links-total').textContent = shortLinks.length;
    document.getElementById('links-active').textContent = shortLinks.filter(l => l.active).length;
    document.getElementById('links-clicks').textContent = shortLinks.reduce((sum, l) => sum + Number(l.click_count || 0), 0);
  };

  const renderShortLinks = () => {
    const body = document.getElementById('short-link-rows');
    if (!shortLinks.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">Nenhum link curto criado ainda.</td></tr>';
      updateLinkStats();
      return;
    }
    body.innerHTML = shortLinks.map(link => {
      const shortUrl = shortUrlFor(link.code);
      return `
        <tr data-link-id="${link.id}">
          <td>${escapeHtml(link.title || '—')}</td>
          <td><a class="short-url" href="${escapeHtml(shortUrl)}" target="_blank" rel="noopener">${escapeHtml(shortUrl)}</a></td>
          <td class="destination-cell"><a href="${escapeHtml(link.destination_url)}" target="_blank" rel="noopener">${escapeHtml(link.destination_url)}</a></td>
          <td>${Number(link.click_count || 0)}</td>
          <td><span class="status-pill ${link.active ? 'on' : 'off'}">${link.active ? 'Ativo' : 'Pausado'}</span></td>
          <td class="link-actions">
            <button type="button" class="copy-short secondary">Copiar</button>
            <button type="button" class="edit-short secondary">Editar</button>
            <button type="button" class="toggle-short secondary">${link.active ? 'Pausar' : 'Ativar'}</button>
            <button type="button" class="delete-short danger">Excluir</button>
          </td>
        </tr>`;
    }).join('');
    updateLinkStats();
  };

  const loadShortLinks = async () => {
    const message = document.getElementById('short-link-message');
    const { data, error } = await client.from('nvchat_short_links')
      .select('id,code,destination_url,title,active,click_count,created_at,updated_at')
      .order('created_at', { ascending: false });
    if (error) {
      showMessage(message, 'Não foi possível carregar os links curtos.', 'error');
      return;
    }
    shortLinks = data || [];
    renderShortLinks();
  };

  const requireAdminSession = async () => {
    const { data: { user } } = await client.auth.getUser();
    const isAdmin = user?.app_metadata?.nvchat_admin === true;
    loginView.hidden = Boolean(isAdmin);
    adminView.hidden = !isAdmin;
    if (isAdmin) await Promise.all([loadTesters(), loadShortLinks()]);
    else if (user) await client.auth.signOut();
  };

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(loginMessage);
    const email = document.getElementById('admin-email').value.trim().toLowerCase();
    const password = document.getElementById('admin-password').value;
    const submitButton = loginForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Entrando...';
    const { error } = await client.auth.signInWithPassword({ email, password });
    submitButton.disabled = false;
    submitButton.textContent = 'Entrar';
    if (error) {
      showMessage(loginMessage, 'E-mail ou senha inválidos.', 'error');
      return;
    }
    await requireAdminSession();
    if (adminView.hidden) showMessage(loginMessage, 'Esta conta não possui permissão administrativa.', 'error');
  });

  document.getElementById('logout-button').addEventListener('click', async () => {
    await client.auth.signOut();
    testers = [];
    shortLinks = [];
    selectedIds.clear();
    adminView.hidden = true;
    loginView.hidden = false;
    loginForm.reset();
  });

  document.querySelectorAll('.tab-button').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.tab-button').forEach(b => b.classList.toggle('active', b === button));
    document.querySelectorAll('.admin-section').forEach(section => { section.hidden = section.id !== button.dataset.tab; });
  }));

  searchInput.addEventListener('input', render);
  statusFilter.addEventListener('change', render);
  selectAll.addEventListener('change', () => {
    filtered().forEach(t => selectAll.checked ? selectedIds.add(t.id) : selectedIds.delete(t.id));
    render();
  });

  rowsEl.addEventListener('change', (event) => {
    if (!event.target.classList.contains('row-check')) return;
    const id = event.target.closest('tr').dataset.id;
    event.target.checked ? selectedIds.add(id) : selectedIds.delete(id);
    updateSelectionUi();
  });

  rowsEl.addEventListener('click', async (event) => {
    if (!event.target.classList.contains('save-row')) return;
    const button = event.target;
    const tr = button.closest('tr');
    const id = tr.dataset.id;
    const status = tr.querySelector('.row-status').value;
    const notes = tr.querySelector('.note-input').value.trim() || null;
    const current = testers.find(t => t.id === id);
    const patch = { status, notes };
    if (status === 'convidado' && !current.invited_at) patch.invited_at = new Date().toISOString();
    if (status === 'interessado') patch.invited_at = null;
    button.disabled = true;
    button.textContent = 'Salvando...';
    const { error } = await client.from('nvchat_testers').update(patch).eq('id', id);
    button.disabled = false;
    button.textContent = 'Salvar';
    if (error) showMessage(adminMessage, 'Não foi possível salvar a alteração.', 'error');
    else { showMessage(adminMessage, 'Cadastro atualizado.'); await loadTesters(); }
  });

  const copyText = async (text) => {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const fallback = document.createElement('textarea');
    fallback.value = text;
    fallback.setAttribute('readonly', '');
    fallback.style.position = 'fixed';
    fallback.style.opacity = '0';
    document.body.appendChild(fallback);
    fallback.select();
    const copied = document.execCommand('copy');
    fallback.remove();
    if (!copied) throw new Error('copy_failed');
  };

  const copyEmails = async (list) => {
    if (!list.length) return showMessage(adminMessage, 'Nenhum e-mail disponível para copiar.', 'error');
    try { await copyText(list.map(t => t.email).join('\n')); showMessage(adminMessage, `${list.length} e-mail(s) copiado(s).`); }
    catch { showMessage(adminMessage, 'Não foi possível copiar automaticamente.', 'error'); }
  };

  const csvEscape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const exportCsv = (list) => {
    if (!list.length) return showMessage(adminMessage, 'Nenhum cadastro disponível para exportar.', 'error');
    const lines = [['Nome','E-mail','Data do cadastro','Status','Data do convite','Observações'], ...list.map(t => [t.name || '', t.email, formatCsvDate(t.created_at), t.status, formatCsvDate(t.invited_at), t.notes || ''])];
    const csv = '\uFEFF' + lines.map(row => row.map(csvEscape).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nvchat-testadores-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  document.getElementById('copy-filtered').addEventListener('click', () => copyEmails(filtered()));
  document.getElementById('export-filtered').addEventListener('click', () => exportCsv(filtered()));
  document.getElementById('copy-selected').addEventListener('click', () => copyEmails(selected()));
  document.getElementById('export-selected').addEventListener('click', () => exportCsv(selected()));

  document.getElementById('mark-invited').addEventListener('click', async () => {
    const list = selected();
    if (!list.length) return;
    const invitedAt = new Date().toISOString();
    const withoutInvitation = list.filter(t => !t.invited_at).map(t => t.id);
    const withInvitation = list.filter(t => t.invited_at).map(t => t.id);
    const button = document.getElementById('mark-invited');
    button.disabled = true;
    let error = null;
    if (withoutInvitation.length) error = (await client.from('nvchat_testers').update({ status: 'convidado', invited_at: invitedAt }).in('id', withoutInvitation)).error;
    if (!error && withInvitation.length) error = (await client.from('nvchat_testers').update({ status: 'convidado' }).in('id', withInvitation)).error;
    if (error) { showMessage(adminMessage, 'Não foi possível atualizar todos os selecionados.', 'error'); button.disabled = false; }
    else { showMessage(adminMessage, `${list.length} cadastro(s) marcado(s) como convidado.`); await loadTesters(); }
  });

  document.getElementById('short-link-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('short-link-message');
    clearMessage(message);
    const urlInput = document.getElementById('short-url');
    const codeInput = document.getElementById('short-code');
    const titleInput = document.getElementById('short-title');
    const button = document.getElementById('create-short-link');
    let destination;
    try {
      destination = new URL(urlInput.value.trim());
      if (!['http:', 'https:'].includes(destination.protocol)) throw new Error('bad_protocol');
    } catch {
      return showMessage(message, 'Digite um link válido começando com http:// ou https://.', 'error');
    }
    const code = (codeInput.value.trim().toLowerCase() || randomCode()).replace(/[^a-z0-9_-]/g, '');
    if (code.length < 3 || code.length > 32) return showMessage(message, 'O apelido precisa ter entre 3 e 32 caracteres.', 'error');
    button.disabled = true;
    button.textContent = 'Criando...';
    const { data, error } = await client.from('nvchat_short_links').insert({
      code,
      destination_url: destination.href,
      title: titleInput.value.trim() || null
    }).select('id,code,destination_url,title,active,click_count,created_at,updated_at').single();
    button.disabled = false;
    button.textContent = 'Criar link curto';
    if (error) {
      const text = error.code === '23505' ? 'Esse apelido já está sendo usado. Escolha outro.' : 'Não foi possível criar o link curto.';
      return showMessage(message, text, 'error');
    }
    event.target.reset();
    shortLinks.unshift(data);
    renderShortLinks();
    try { await copyText(shortUrlFor(data.code)); showMessage(message, `Link criado e copiado: ${shortUrlFor(data.code)}`); }
    catch { showMessage(message, `Link criado: ${shortUrlFor(data.code)}`); }
  });

  document.getElementById('short-link-rows').addEventListener('click', async (event) => {
    const tr = event.target.closest('tr[data-link-id]');
    if (!tr) return;
    const link = shortLinks.find(l => l.id === tr.dataset.linkId);
    if (!link) return;
    const message = document.getElementById('short-link-message');

    if (event.target.classList.contains('copy-short')) {
      try { await copyText(shortUrlFor(link.code)); showMessage(message, 'Link curto copiado.'); }
      catch { showMessage(message, 'Não foi possível copiar o link.', 'error'); }
      return;
    }

    if (event.target.classList.contains('edit-short')) {
      const next = window.prompt('Novo endereço de destino:', link.destination_url);
      if (next === null) return;
      let parsed;
      try { parsed = new URL(next.trim()); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); }
      catch { return showMessage(message, 'O novo destino precisa ser um link http/https válido.', 'error'); }
      const { error } = await client.from('nvchat_short_links').update({ destination_url: parsed.href, updated_at: new Date().toISOString() }).eq('id', link.id);
      if (error) showMessage(message, 'Não foi possível editar o destino.', 'error');
      else { showMessage(message, 'Destino atualizado. O link curto continua o mesmo.'); await loadShortLinks(); }
      return;
    }

    if (event.target.classList.contains('toggle-short')) {
      const { error } = await client.from('nvchat_short_links').update({ active: !link.active, updated_at: new Date().toISOString() }).eq('id', link.id);
      if (error) showMessage(message, 'Não foi possível alterar o status.', 'error');
      else { showMessage(message, link.active ? 'Link pausado.' : 'Link ativado.'); await loadShortLinks(); }
      return;
    }

    if (event.target.classList.contains('delete-short')) {
      if (!window.confirm(`Excluir o link ${shortUrlFor(link.code)}?`)) return;
      const { error } = await client.from('nvchat_short_links').delete().eq('id', link.id);
      if (error) showMessage(message, 'Não foi possível excluir o link.', 'error');
      else { showMessage(message, 'Link excluído.'); await loadShortLinks(); }
    }
  });

  client.auth.onAuthStateChange(() => setTimeout(requireAdminSession, 0));
  requireAdminSession();
})();
