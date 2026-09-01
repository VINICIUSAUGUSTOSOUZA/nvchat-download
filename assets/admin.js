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

  const showMessage = (el, text, type = 'success') => {
    el.textContent = text;
    el.className = `message show ${type}`;
  };
  const clearMessage = (el) => {
    el.textContent = '';
    el.className = 'message';
  };
  const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const formatDate = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

  const filtered = () => {
    const q = searchInput.value.trim().toLowerCase();
    const status = statusFilter.value;
    return testers.filter((t) => {
      const matchesSearch = !q || (t.name || '').toLowerCase().includes(q) || t.email.toLowerCase().includes(q);
      const matchesStatus = status === 'all' || t.status === status;
      return matchesSearch && matchesStatus;
    });
  };

  const updateStats = () => {
    document.getElementById('total-count').textContent = testers.length;
    document.getElementById('interested-count').textContent = testers.filter(t => t.status === 'interessado').length;
    document.getElementById('invited-count').textContent = testers.filter(t => t.status === 'convidado').length;
    document.getElementById('active-count').textContent = testers.filter(t => t.status === 'ativo').length;
  };

  const updateSelectionUi = () => {
    const count = selectedIds.size;
    selectionCount.textContent = `${count} selecionado(s)`;
    ['mark-invited', 'copy-selected', 'export-selected'].forEach(id => document.getElementById(id).disabled = count === 0);
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
        <td>
          <select class="row-status">
            ${['interessado','convidado','ativo','removido'].map(s => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}
          </select>
        </td>
        <td>${formatDate(t.invited_at)}</td>
        <td><textarea class="note-input" maxlength="1000" placeholder="Observação interna">${escapeHtml(t.notes || '')}</textarea></td>
        <td><button class="save-row">Salvar</button></td>
      </tr>`).join('');
    updateSelectionUi();
  };

  const requireAdminSession = async () => {
    const { data: { user } } = await client.auth.getUser();
    const isAdmin = user?.app_metadata?.nvchat_admin === true;
    loginView.hidden = Boolean(isAdmin);
    adminView.hidden = !isAdmin;
    if (isAdmin) await loadTesters();
    else if (user) await client.auth.signOut();
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

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(loginMessage);
    const email = document.getElementById('admin-email').value.trim().toLowerCase();
    const password = document.getElementById('admin-password').value;
    const { error } = await client.auth.signInWithPassword({ email, password });
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
    adminView.hidden = true;
    loginView.hidden = false;
  });

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
    const tr = event.target.closest('tr');
    const id = tr.dataset.id;
    const status = tr.querySelector('.row-status').value;
    const notes = tr.querySelector('.note-input').value.trim() || null;
    const current = testers.find(t => t.id === id);
    const patch = { status, notes };
    if (status === 'convidado' && !current.invited_at) patch.invited_at = new Date().toISOString();
    if (status === 'interessado') patch.invited_at = null;
    const { error } = await client.from('nvchat_testers').update(patch).eq('id', id);
    if (error) showMessage(adminMessage, 'Não foi possível salvar a alteração.', 'error');
    else { showMessage(adminMessage, 'Cadastro atualizado.'); await loadTesters(); }
  });

  const copyEmails = async (list) => {
    if (!list.length) return showMessage(adminMessage, 'Nenhum e-mail disponível para copiar.', 'error');
    await navigator.clipboard.writeText(list.map(t => t.email).join('\n'));
    showMessage(adminMessage, `${list.length} e-mail(s) copiado(s).`);
  };

  const csvEscape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const exportCsv = (list) => {
    if (!list.length) return showMessage(adminMessage, 'Nenhum cadastro disponível para exportar.', 'error');
    const lines = [['Nome','E-mail','Data de cadastro','Status'], ...list.map(t => [t.name || '', t.email, new Date(t.created_at).toISOString(), t.status])];
    const csv = '\uFEFF' + lines.map(row => row.map(csvEscape).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nvchat-testadores-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  document.getElementById('copy-filtered').addEventListener('click', () => copyEmails(filtered()));
  document.getElementById('export-filtered').addEventListener('click', () => exportCsv(filtered()));
  document.getElementById('copy-selected').addEventListener('click', () => copyEmails(testers.filter(t => selectedIds.has(t.id))));
  document.getElementById('export-selected').addEventListener('click', () => exportCsv(testers.filter(t => selectedIds.has(t.id))));
  document.getElementById('mark-invited').addEventListener('click', async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const { error } = await client.from('nvchat_testers').update({ status: 'convidado', invited_at: new Date().toISOString() }).in('id', ids);
    if (error) showMessage(adminMessage, 'Não foi possível atualizar os selecionados.', 'error');
    else { showMessage(adminMessage, `${ids.length} cadastro(s) marcado(s) como convidado.`); await loadTesters(); }
  });

  client.auth.onAuthStateChange(() => setTimeout(requireAdminSession, 0));
  requireAdminSession();
})();
