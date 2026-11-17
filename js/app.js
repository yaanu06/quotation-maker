/* QuoteCraft app logic — plain JS, no build step. */
(() => {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const BRAND = 'QuoteCraft';

  const CURRENCIES = [
    ['INR', '₹'], ['USD', '$'], ['EUR', '€'], ['GBP', '£'], ['AED', 'د.إ'], ['SAR', '﷼'],
    ['KES', 'KSh'], ['NGN', '₦'], ['PKR', '₨'], ['BDT', '৳'], ['LKR', 'Rs'], ['NPR', 'Rs'],
    ['AUD', 'A$'], ['CAD', 'C$'], ['SGD', 'S$'], ['MYR', 'RM'], ['ZAR', 'R'], ['JPY', '¥']
  ];

  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmt = (n, currency) => {
    const cur = currency || Store.getSettings().currency || 'INR';
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n || 0); }
    catch { return (n || 0).toFixed(2) + ' ' + cur; }
  };
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const addDaysISO = d => { const t = new Date(); t.setDate(t.getDate() + d); return t.toISOString().slice(0, 10); };
  const fmtDate = iso => { if (!iso) return '—'; const d = new Date(iso + 'T00:00:00'); return isNaN(d) ? esc(iso) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
  const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2600); };

  /* ============ NAVIGATION ============ */
  const VIEW_IDS = ['view-dashboard', 'view-editor', 'view-clients', 'view-items', 'view-settings'];
  function showView(id) {
    VIEW_IDS.forEach(v => $('#' + v).classList.toggle('view-active', v === id));
    $$('.nav-btn').forEach(b => b.classList.toggle('nav-active', b.dataset.view === id));
    window.scrollTo(0, 0);
  }
  $$('.nav-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

  /* ============ TOTALS ============ */
  function computeTotals(doc) {
    const items = (doc.items || []).map(i => {
      const qty = Number(i.qty) || 0, rate = Number(i.rate) || 0, taxRate = Number(i.taxRate) || 0;
      const line = qty * rate;
      return { ...i, qty, rate, taxRate, line, tax: line * taxRate / 100 };
    });
    const subtotal = items.reduce((s, i) => s + i.line, 0);
    const discountPct = Number(doc.discountPct) || 0;
    const discount = subtotal * discountPct / 100;
    const tax = items.reduce((s, i) => s + i.tax, 0);
    const total = subtotal - discount + tax;
    return { items, subtotal, discountPct, discount, tax, total };
  }

  /* ============ DASHBOARD ============ */
  let currentFilter = 'all';
  let currentSearch = '';

  function renderStats() {
    const docs = Store.listDocuments('all');
    const outstanding = docs.filter(d => d.type === 'invoice' && ['sent', 'unpaid'].includes(d.status))
      .reduce((s, d) => s + computeTotals(d).total, 0);
    const month = new Date().toISOString().slice(0, 7);
    const paidThisMonth = docs.filter(d => d.status === 'paid' && (d.issueDate || '').startsWith(month))
      .reduce((s, d) => s + computeTotals(d).total, 0);
    const openQuotes = docs.filter(d => d.type === 'quote' && ['draft', 'sent'].includes(d.status)).length;
    $('#stats-row').innerHTML = `
      <div class="stat"><div class="stat-label">Outstanding</div><div class="stat-value amber">${fmt(outstanding)}</div></div>
      <div class="stat"><div class="stat-label">Paid (month)</div><div class="stat-value green">${fmt(paidThisMonth)}</div></div>
      <div class="stat"><div class="stat-label">Open quotes</div><div class="stat-value">${openQuotes}</div></div>`;
  }

  function statusBadge(status) {
    const s = esc(status || 'draft');
    return `<span class="badge badge-${s}">${s}</span>`;
  }

  function renderDocList() {
    renderStats();
    const docs = Store.listDocuments(currentFilter, currentSearch);
    const list = $('#doc-list');
    $('#doc-empty').hidden = docs.length !== 0;
    list.innerHTML = docs.map(d => {
      const { total } = computeTotals(d);
      const client = d.clientSnapshot?.name || 'No client';
      const icon = d.type === 'quote' ? '📝' : d.type === 'invoice' ? '🧾' : '🧾';
      return `<button class="doc-card" data-id="${esc(d.id)}">
        <span class="doc-icon ${esc(d.type)}">${icon}</span>
        <span class="doc-main">
          <span class="doc-top"><span class="doc-number-sm">${esc(d.number)} · ${fmtDate(d.issueDate)}</span><span class="doc-total">${fmt(total, d.currency)}</span></span>
          <span class="doc-client">${esc(client)}</span>
          <span class="doc-meta">${statusBadge(d.status)}<span>${esc((d.items || []).length)} item(s)</span></span>
        </span>
      </button>`;
    }).join('');
  }

  $('#doc-filter').addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn'); if (!btn) return;
    currentFilter = btn.dataset.filter;
    $$('#doc-filter .seg-btn').forEach(b => b.classList.toggle('seg-active', b === btn));
    renderDocList();
  });
  $('#doc-search').addEventListener('input', e => { currentSearch = e.target.value.trim(); renderDocList(); });
  $('#empty-create').addEventListener('click', () => openEditor(null));
  $('#btn-new-doc').addEventListener('click', () => openEditor(null));

  $('#doc-list').addEventListener('click', e => {
    const card = e.target.closest('.doc-card'); if (!card) return;
    openDocActions(card.dataset.id);
  });

  /* ============ EDITOR ============ */
  let editingId = null;
  let editorType = 'quote';

  function itemRowHTML(i = {}) {
    return `<div class="item-row">
      <div class="item-desc">
        <input class="input c-name" list="saved-items" placeholder="Item / service" value="${esc(i.name || '')}" required>
        <input class="input c-desc" placeholder="Description (optional)" value="${esc(i.description || '')}">
      </div>
      <input class="input num c-qty" type="number" min="0" step="any" placeholder="Qty" value="${i.qty ?? 1}" required>
      <input class="input num c-rate" type="number" min="0" step="any" placeholder="Rate" value="${i.rate ?? ''}" required>
      <input class="input num c-tax" type="number" min="0" step="any" placeholder="0" value="${i.taxRate ?? 0}">
      <button type="button" class="item-remove" aria-label="Remove item">✕</button>
    </div>`;
  }

  function readItemsFromForm() {
    return $$('#items-rows .item-row').map(row => ({
      name: $('.c-name', row).value.trim(),
      description: $('.c-desc', row).value.trim(),
      qty: parseFloat($('.c-qty', row).value) || 0,
      rate: parseFloat($('.c-rate', row).value) || 0,
      taxRate: parseFloat($('.c-tax', row).value) || 0
    })).filter(i => i.name);
  }

  function currentDocFromForm() {
    const clientId = $('#f-client').value;
    const client = Store.getClient(clientId);
    return {
      type: editorType,
      clientId: clientId || null,
      clientSnapshot: client ? { name: client.name, phone: client.phone, email: client.email, address: client.address, taxId: client.taxId } : null,
      issueDate: $('#f-issue').value || todayISO(),
      dueDate: $('#f-due').value || '',
      currency: $('#f-currency').value,
      status: $('#f-status').value,
      discountPct: parseFloat($('#f-discount').value) || 0,
      items: readItemsFromForm(),
      notes: $('#f-notes').value.trim(),
      terms: $('#f-terms').value.trim(),
      includeSignature: $('#f-signature').checked
    };
  }

  function refreshTotals() {
    const { subtotal, discount, tax, total } = computeTotals(currentDocFromForm());
    const cur = $('#f-currency').value;
    $('#t-subtotal').textContent = fmt(subtotal, cur);
    $('#t-tax').textContent = fmt(tax, cur);
    $('#t-total').textContent = fmt(total, cur);
    return total;
  }

  function refreshItemDatalist() {
    $('#saved-items').innerHTML = Store.listItems().map(i => `<option value="${esc(i.name)}">${esc(i.name)} — ${fmt(i.rate)}</option>`).join('');
  }

  function refreshClientSelect(selectedId) {
    const sel = $('#f-client');
    sel.innerHTML = '<option value="">— Select client —</option>' +
      Store.listClients().map(c => `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    renderClientSnapshot();
  }

  function renderClientSnapshot() {
    const c = Store.getClient($('#f-client').value);
    $('#client-snapshot').textContent = c ? [c.phone, c.email, c.address, c.taxId && 'GSTIN: ' + c.taxId].filter(Boolean).join('\n') : '';
  }

  function setEditorType(type) {
    editorType = type;
    $$('#doc-type-seg .seg-btn').forEach(b => b.classList.toggle('seg-active', b.dataset.type === type));
    $('#due-label').textContent = type === 'quote' ? 'Valid until' : type === 'invoice' ? 'Due date' : 'Receipt date';
    const existing = editingId ? Store.getDocument(editingId) : null;
    $('#doc-number').textContent = existing ? existing.number : Store.nextNumber(type);
    const help = { quote: 'sent', invoice: 'unpaid', receipt: 'paid' };
    if (!editingId) $('#f-status').value = help[type];
  }

  function openEditor(docId) {
    editingId = docId;
    const doc = docId ? Store.getDocument(docId) : null;
    editorType = doc ? doc.type : 'quote';
    $('#f-issue').value = doc?.issueDate || todayISO();
    $('#f-due').value = doc?.dueDate || (doc ? '' : addDaysISO(14));
    $('#f-currency').value = doc?.currency || Store.getSettings().currency;
    $('#f-status').value = doc?.status || 'sent';
    $('#f-discount').value = doc?.discountPct ?? 0;
    $('#f-notes').value = doc?.notes || '';
    $('#f-terms').value = doc?.terms || '';
    $('#f-signature').checked = doc?.includeSignature ?? false;
    $('#items-rows').innerHTML = (doc?.items?.length ? doc.items : [{ qty: 1, taxRate: 0 }]).map(itemRowHTML).join('');
    refreshItemDatalist();
    refreshClientSelect(doc?.clientId || '');
    setEditorType(editorType);
    $('#delete-doc').style.visibility = doc ? 'visible' : 'hidden';
    showView('view-editor');
    refreshTotals();
  }

  $('#doc-type-seg').addEventListener('click', e => { const b = e.target.closest('.seg-btn'); if (b) { setEditorType(b.dataset.type); refreshTotals(); } });
  $('#editor-back').addEventListener('click', () => { renderDocList(); showView('view-dashboard'); });
  $('#add-item-row').addEventListener('click', () => { $('#items-rows').insertAdjacentHTML('beforeend', itemRowHTML({ qty: 1, taxRate: 0 })); refreshTotals(); });
  $('#items-rows').addEventListener('click', e => { if (e.target.closest('.item-remove')) { e.target.closest('.item-row').remove(); refreshTotals(); } });
  $('#items-rows').addEventListener('input', e => {
    const row = e.target.closest('.item-row');
    if (row && e.target.classList.contains('c-name')) {
      const saved = Store.listItems().find(i => i.name === e.target.value);
      if (saved) {
        $('.c-desc', row).value = saved.description || '';
        $('.c-rate', row).value = saved.rate;
        $('.c-tax', row).value = saved.taxRate;
      }
    }
    refreshTotals();
  });
  $('#f-client').addEventListener('change', renderClientSnapshot);
  $('#f-currency').addEventListener('change', refreshTotals);
  $('#f-discount').addEventListener('input', refreshTotals);

  $('#doc-form').addEventListener('submit', e => {
    e.preventDefault();
    const data = currentDocFromForm();
    if (!data.items.length) { toast('Add at least one item'); return; }
    if (editingId) {
      Store.updateDocument(editingId, data);
      toast('Document updated');
    } else {
      const created = Store.addDocument(data);
      editingId = created.id;
    }
    renderDocList(); showView('view-dashboard');
  });

  $('#delete-doc').addEventListener('click', () => {
    if (!editingId) return;
    if (confirm('Delete this document?')) { Store.deleteDocument(editingId); renderDocList(); showView('view-dashboard'); toast('Deleted'); }
  });

  /* ============ DOC ACTIONS SHEET ============ */
  let actionsDocId = null;
  const actionsSheet = $('#doc-actions');

  function openDocActions(id) {
    actionsDocId = id;
    const d = Store.getDocument(id); if (!d) return;
    $('#da-title').textContent = `${d.number} — ${d.clientSnapshot?.name || 'No client'}`;
    $('#da-convert').style.display = d.type === 'quote' ? 'flex' : 'none';
    actionsSheet.showModal();
  }
  $('#da-close').addEventListener('click', () => actionsSheet.close());
  $('#da-open').addEventListener('click', () => { actionsSheet.close(); openEditor(actionsDocId); });
  $('#da-delete').addEventListener('click', () => {
    if (confirm('Delete this document?')) { Store.deleteDocument(actionsDocId); actionsSheet.close(); renderDocList(); toast('Deleted'); }
  });
  $('#da-paid').addEventListener('click', () => { Store.setStatus(actionsDocId, 'paid'); actionsSheet.close(); renderDocList(); toast('Marked as paid'); });
  $('#da-convert').addEventListener('click', () => {
    const inv = Store.convertQuoteToInvoice(actionsDocId);
    actionsSheet.close(); renderDocList();
    toast(inv ? `Converted to ${inv.number}` : 'Conversion failed');
    if (inv) openEditor(inv.id);
  });
  $('#da-pdf').addEventListener('click', () => { actionsSheet.close(); printDocument(actionsDocId); });
  $('#da-share').addEventListener('click', () => { actionsSheet.close(); shareDocument(actionsDocId); });

  /* ============ PRINT / PDF ============ */
  function printDocument(id) {
    const d = Store.getDocument(id); if (!d) return;
    const s = Store.getSettings();
    const b = s.business;
    const { items, subtotal, discount, tax, total, discountPct } = computeTotals(d);
    const typeLabel = d.type === 'quote' ? 'Quotation' : d.type === 'invoice' ? 'Invoice' : 'Receipt';
    const cur = d.currency;

    $('#print-area').innerHTML = `<div class="print-doc">
      <div class="pd-head">
        <div class="pd-brand">
          ${b.logo ? `<img class="pd-logo" src="${b.logo}" alt="Logo">` : ''}
          <div><div class="pd-biz-name">${esc(b.name || BRAND)}</div>
            <div class="pd-biz-meta">${esc([b.address, b.phone, b.email, b.taxId && 'GSTIN: ' + b.taxId, b.website].filter(Boolean).join('\n'))}</div>
          </div>
        </div>
        <div><div class="pd-doc-type">${typeLabel}</div><div class="pd-doc-number">${esc(d.number)}<br>${fmtDate(d.issueDate)}</div></div>
      </div>
      <div class="pd-two-col">
        <div class="pd-box"><h4>Bill to</h4>${esc(d.clientSnapshot?.name || '—')}<br>${esc([d.clientSnapshot?.address, d.clientSnapshot?.phone, d.clientSnapshot?.email, d.clientSnapshot?.taxId && 'GSTIN: ' + d.clientSnapshot.taxId].filter(Boolean).join('\n'))}</div>
        <div class="pd-box"><h4>${d.type === 'quote' ? 'Valid until' : d.type === 'invoice' ? 'Due date' : 'Date'}</h4>${fmtDate(d.dueDate || d.issueDate)}<br><h4 style="margin-top:6px">Status</h4>${esc((d.status || 'draft').toUpperCase())}${d.convertedFrom ? `<br><h4 style="margin-top:6px">Converted from</h4>${esc(d.convertedFrom)}` : ''}</div>
      </div>
      <table class="pd-table"><thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Tax %</th><th class="r">Amount</th></tr></thead>
        <tbody>${items.map((i, idx) => `<tr><td>${idx + 1}</td><td>${esc(i.name)}${i.description ? '<br><small>' + esc(i.description) + '</small>' : ''}</td><td class="r">${i.qty}</td><td class="r">${fmt(i.rate, cur)}</td><td class="r">${i.taxRate}%</td><td class="r">${fmt(i.line, cur)}</td></tr>`).join('')}</tbody>
      </table>
      <table class="pd-totals"><tbody>
        <tr><td>Subtotal</td><td class="r">${fmt(subtotal, cur)}</td></tr>
        ${discountPct ? `<tr><td>Discount (${discountPct}%)</td><td class="r">− ${fmt(discount, cur)}</td></tr>` : ''}
        <tr><td>Tax</td><td class="r">${fmt(tax, cur)}</td></tr>
        <tr class="grand"><td>Total</td><td class="r">${fmt(total, cur)}</td></tr>
      </tbody></table>
      ${d.notes ? `<div class="pd-notes"><strong>Notes</strong><br>${esc(d.notes)}</div>` : ''}
      ${d.terms ? `<div class="pd-notes"><strong>Terms</strong><br>${esc(d.terms)}</div>` : ''}
      ${d.includeSignature && b.signature ? `<div class="pd-sign"><div class="pd-sign-box"><img class="pd-sign-img" src="${b.signature}" alt="Signature"><div class="pd-sign-line">For ${esc(b.name || BRAND)}</div></div></div>` : ''}
      <div class="pd-foot">Generated with ${BRAND} · ${esc(b.name || '')} · ${esc(b.phone || b.email || '')}</div>
    </div>`;
    window.print();
  }

  /* ============ SHARE ============ */
  function shareDocument(id) {
    const d = Store.getDocument(id); if (!d) return;
    const { total } = computeTotals(d);
    const s = Store.getSettings().business;
    const typeLabel = d.type === 'quote' ? 'quotation' : d.type;
    const text = `${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)} ${d.number} from ${s.name || BRAND}\nBill to: ${d.clientSnapshot?.name || '—'}\nTotal: ${fmt(total, d.currency)}\n${d.dueDate ? 'Due/valid: ' + fmtDate(d.dueDate) : ''}`;
    if (navigator.share) {
      navigator.share({ title: `${typeLabel} ${d.number}`, text }).catch(() => {});
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    }
  }

  /* ============ CLIENTS ============ */
  function renderClients(q = '') {
    const clients = Store.listClients(q);
    $('#client-list').innerHTML = clients.map(c => `
      <div class="list-row"><div class="avatar">${esc((c.name || '?').trim().charAt(0).toUpperCase())}</div>
        <div class="doc-main"><div class="doc-client">${esc(c.name)}</div><div class="doc-meta">${esc([c.phone, c.email].filter(Boolean).join(' · ') || '—')}</div></div>
        <button class="icon-btn" data-del-client="${esc(c.id)}" aria-label="Delete client">🗑️</button>
      </div>`).join('') || '<p class="muted" style="padding:16px">No clients yet.</p>';
  }
  $('#client-search').addEventListener('input', e => renderClients(e.target.value.trim()));
  $('#client-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-del-client]'); if (!btn) return;
    if (confirm('Delete this client?')) { Store.deleteClient(btn.dataset.delClient); renderClients($('#client-search').value.trim()); }
  });

  const clientModal = $('#client-modal');
  const openClientModal = () => clientModal.showModal();
  $('#add-client').addEventListener('click', openClientModal);
  $('#quick-add-client').addEventListener('click', openClientModal);
  $('#cm-cancel').addEventListener('click', () => clientModal.close());
  $('#client-modal-form').addEventListener('submit', e => {
    e.preventDefault();
    const c = Store.addClient({ name: $('#cm-name').value.trim(), phone: $('#cm-phone').value.trim(), email: $('#cm-email').value.trim(), address: $('#cm-address').value.trim(), taxId: $('#cm-taxid').value.trim() });
    e.target.reset(); clientModal.close();
    toast('Client saved');
    renderClients(); refreshClientSelect(c.id);
  });

  /* ============ ITEMS ============ */
  function renderItems(q = '') {
    const items = Store.listItems(q);
    $('#item-list').innerHTML = items.map(i => `
      <div class="list-row"><div class="avatar">🏷️</div>
        <div class="doc-main"><div class="doc-client">${esc(i.name)}</div><div class="doc-meta">${fmt(i.rate)} · ${Number(i.taxRate) || 0}% tax</div></div>
        <button class="icon-btn" data-del-item="${esc(i.id)}" aria-label="Delete item">🗑️</button>
      </div>`).join('') || '<p class="muted" style="padding:16px">No items yet.</p>';
  }
  $('#item-search').addEventListener('input', e => renderItems(e.target.value.trim()));
  $('#item-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-del-item]'); if (!btn) return;
    if (confirm('Delete this item?')) { Store.deleteItem(btn.dataset.delItem); renderItems($('#item-search').value.trim()); }
  });

  const itemModal = $('#item-modal');
  $('#add-item').addEventListener('click', () => itemModal.showModal());
  $('#im-cancel').addEventListener('click', () => itemModal.close());
  $('#item-modal-form').addEventListener('submit', e => {
    e.preventDefault();
    Store.addItem({ name: $('#im-name').value.trim(), description: $('#im-desc').value.trim(), rate: parseFloat($('#im-rate').value) || 0, taxRate: parseFloat($('#im-tax').value) || 0 });
    e.target.reset(); itemModal.close();
    toast('Item saved');
    renderItems(); refreshItemDatalist();
  });

  /* ============ SETTINGS ============ */
  function fillCurrencySelects() {
    const opts = CURRENCIES.map(([code]) => `<option value="${code}">${code}</option>`).join('');
    ['#f-currency', '#s-currency'].forEach(sel => { $(sel).innerHTML = opts; });
  }

  function loadSettingsForm() {
    const s = Store.getSettings(), b = s.business;
    $('#s-name').value = b.name; $('#s-email').value = b.email; $('#s-phone').value = b.phone;
    $('#s-address').value = b.address; $('#s-taxid').value = b.taxId; $('#s-website').value = b.website;
    $('#s-currency').value = s.currency;
    $('#s-qprefix').value = s.prefixes.quote; $('#s-invprefix').value = s.prefixes.invoice; $('#s-rprefix').value = s.prefixes.receipt;
    if (b.logo) { $('#logo-preview').src = b.logo; $('#logo-preview').hidden = false; $('#logo-placeholder').hidden = true; } else { $('#logo-preview').hidden = true; $('#logo-placeholder').hidden = false; }
    if (b.signature) { $('#signature-preview').src = b.signature; $('#signature-preview').hidden = false; } else { $('#signature-preview').hidden = true; }
  }

  const readFile = (file, cb) => { const r = new FileReader(); r.onload = () => cb(r.result); r.readAsDataURL(file); };
  $('#f-logo').addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0], url => { $('#logo-preview').src = url; $('#logo-preview').hidden = false; $('#logo-placeholder').hidden = true; Store.updateBusiness({ logo: url }); }); });
  $('#clear-logo').addEventListener('click', () => { Store.updateBusiness({ logo: '' }); loadSettingsForm(); });
  $('#f-signature-img').addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0], url => { Store.updateBusiness({ signature: url }); loadSettingsForm(); toast('Signature saved'); }); });

  $('#settings-form').addEventListener('submit', e => {
    e.preventDefault();
    Store.updateBusiness({ name: $('#s-name').value.trim(), email: $('#s-email').value.trim(), phone: $('#s-phone').value.trim(), address: $('#s-address').value.trim(), taxId: $('#s-taxid').value.trim(), website: $('#s-website').value.trim() });
    Store.updateSettings({ currency: $('#s-currency').value, prefixes: { quote: $('#s-qprefix').value.trim() || 'QUO', invoice: $('#s-invprefix').value.trim() || 'INV', receipt: $('#s-rprefix').value.trim() || 'RCT' } });
    toast('Business profile saved');
  });

  $('#export-data').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(Store.exportAll(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'quotecraft-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#import-data').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => { try { Store.importAll(JSON.parse(r.result)); toast('Backup imported'); boot(); } catch { toast('Invalid backup file'); } };
    r.readAsText(file);
  });
  $('#reset-data').addEventListener('click', () => {
    if (confirm('Erase ALL data on this device? This cannot be undone.')) { Store.resetAll(); toast('Data reset'); boot(); }
  });

  /* ============ BOOT ============ */
  function boot() {
    fillCurrencySelects();
    loadSettingsForm();
    renderClients();
    renderItems();
    renderDocList();
    showView('view-dashboard');
  }
  boot();
})();
