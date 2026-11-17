/* QuoteCraft storage layer.
   localStorage today; swap `backend` later for Google Sheets + Apps Script. */
const Store = (() => {
  const KEY = 'quotecraft.data.v1';

  const defaultData = () => ({
    settings: {
      business: { name: '', email: '', phone: '', address: '', taxId: '', website: '', logo: '', signature: '' },
      currency: 'INR',
      prefixes: { quote: 'QUO', invoice: 'INV', receipt: 'RCT', proforma: 'PRO', purchase_order: 'PO', delivery_note: 'DN' },
      counters: { quote: 1, invoice: 1, receipt: 1, proforma: 1, purchase_order: 1, delivery_note: 1 },
      template: 'classic',
      seeded: false
    },
    clients: [],
    items: [],
    documents: []
  });

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function mergeData(data) {
    const d = defaultData();
    const s = data.settings || {};
    return {
      settings: {
        ...d.settings, ...s,
        business: { ...d.settings.business, ...(s.business || {}) },
        prefixes: { ...d.settings.prefixes, ...(s.prefixes || {}) },
        counters: { ...d.settings.counters, ...(s.counters || {}) }
      },
      clients: Array.isArray(data.clients) ? data.clients : [],
      items: Array.isArray(data.items) ? data.items : [],
      documents: Array.isArray(data.documents) ? data.documents : []
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return seed(defaultData());
      return mergeData(JSON.parse(raw));
    } catch {
      return defaultData();
    }
  }

  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  function seed(data) {
    if (data.settings.seeded) return data;
    data.clients = [
      { id: uid(), name: 'Ramesh Kumar', phone: '+91 98220 12345', email: 'ramesh@example.com', address: 'MG Road, Pune 411001', taxId: '' },
      { id: uid(), name: 'Shree Agencies', phone: '+91 98220 54321', email: 'accounts@shreeagencies.in', address: 'FC Road, Pune 411005', taxId: '27ABCDE1234F1Z5' }
    ];
    data.items = [
      { id: uid(), name: 'Design consultation', description: 'Per hour', rate: 1500, taxRate: 18 },
      { id: uid(), name: 'Website development', description: 'Fixed scope', rate: 45000, taxRate: 18 },
      { id: uid(), name: 'Monthly maintenance', description: 'AMC per month', rate: 3000, taxRate: 18 }
    ];
    data.settings.seeded = true;
    save(data);
    return data;
  }

  let state = load();
  const persist = () => save(state);

  const api = {
    uid,
    get: () => state,
    getSettings: () => state.settings,
    updateSettings(patch) { Object.assign(state.settings, patch); persist(); },
    updateBusiness(patch) { Object.assign(state.settings.business, patch); persist(); },

    listClients: (q = '') => filterBy(state.clients, q, c => [c.name, c.phone, c.email, c.address].join(' ')),
    getClient: id => state.clients.find(c => c.id === id) || null,
    addClient(c) { const client = { id: uid(), ...c }; state.clients.push(client); persist(); return client; },
    updateClient(id, patch) { const c = api.getClient(id); if (c) { Object.assign(c, patch); persist(); } return c; },
    deleteClient(id) { state.clients = state.clients.filter(c => c.id !== id); persist(); },

    listItems: (q = '') => filterBy(state.items, q, i => [i.name, i.description].join(' ')),
    getItem: id => state.items.find(i => i.id === id) || null,
    addItem(i) { const item = { id: uid(), ...i }; state.items.push(item); persist(); return item; },
    updateItem(id, patch) { const it = api.getItem(id); if (it) { Object.assign(it, patch); persist(); } return it; },
    deleteItem(id) { state.items = state.items.filter(i => i.id !== id); persist(); },

    listDocuments(filter = 'all', q = '') {
      let docs = [...state.documents].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      if (filter !== 'all') docs = docs.filter(d => d.type === filter);
      if (q) {
        const needle = q.toLowerCase();
        docs = docs.filter(d => {
          const client = d.clientSnapshot || {};
          const hay = [d.number, client.name, client.phone, d.status,
            ...(d.items || []).map(i => i.name + ' ' + (i.description || ''))].join(' ').toLowerCase();
          return hay.includes(needle);
        });
      }
      return docs;
    },
    getDocument: id => state.documents.find(d => d.id === id) || null,
    nextNumber(type) {
      const n = state.settings.counters[type] || 1;
      const prefix = (state.settings.prefixes[type] || type.toUpperCase()).trim() || type.toUpperCase();
      return `${prefix}-${String(n).padStart(4, '0')}`;
    },
    addDocument(doc) {
      const number = doc.number || api.nextNumber(doc.type);
      const full = { id: uid(), createdAt: Date.now(), status: 'draft', items: [], ...doc, number };
      state.documents.push(full);
      state.settings.counters[doc.type] = (state.settings.counters[doc.type] || 1) + 1;
      persist();
      return full;
    },
    updateDocument(id, patch) { const d = api.getDocument(id); if (d) { Object.assign(d, patch); persist(); } return d; },
    deleteDocument(id) { state.documents = state.documents.filter(d => d.id !== id); persist(); },
    setStatus(id, status) { return api.updateDocument(id, { status }); },

    recordPayment(id, payment) {
      const d = api.getDocument(id);
      if (!d) return null;
      const payments = [...(d.payments || []), { id: uid(), ...payment }];
      api.updateDocument(id, { payments });
      return api.getDocument(id);
    },

    removePayment(id, paymentId) {
      const d = api.getDocument(id);
      if (!d) return null;
      api.updateDocument(id, { payments: (d.payments || []).filter(p => p.id !== paymentId) });
      return api.getDocument(id);
    },

    duplicateDocument(id) {
      const d = api.getDocument(id);
      if (!d) return null;
      const { id: _id, number: _n, createdAt: _c, status: _s, payments: _p, ...rest } = d;
      return api.addDocument({ ...rest, items: (d.items || []).map(i => ({ ...i })), images: [...(d.images || [])], status: 'draft', payments: [], issueDate: todayISO(), number: undefined });
    },

    convertQuoteToInvoice(id) {
      const q = api.getDocument(id);
      if (!q) return null;
      const invoice = api.addDocument({
        type: 'invoice',
        status: 'unpaid',
        clientId: q.clientId,
        clientSnapshot: { ...(q.clientSnapshot || {}) },
        items: (q.items || []).map(i => ({ ...i })),
        currency: q.currency,
        discountPct: q.discountPct,
        notes: q.notes,
        terms: q.terms,
        includeSignature: q.includeSignature,
        issueDate: todayISO(),
        dueDate: addDaysISO(14),
        convertedFrom: q.number
      });
      api.updateDocument(id, { status: 'accepted' });
      return invoice;
    },

    exportAll() { return JSON.parse(JSON.stringify(state)); },
    importAll(data) {
      state = mergeData(data);
      persist();
    },
    resetAll() { localStorage.removeItem(KEY); state = seed(defaultData()); }
  };

  function filterBy(list, q, hayFn) {
    if (!q) return [...list];
    const needle = q.toLowerCase();
    return list.filter(item => hayFn(item).toLowerCase().includes(needle));
  }

  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function addDaysISO(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }

  return api;
})();
