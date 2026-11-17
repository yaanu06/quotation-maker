/* QuoteCraft — Owner super-admin panel.
   Local demo data today; AdminStore is the seam to swap for Google Sheets + Apps Script.
   Real auth replaces the demo PIN when the backend lands. */
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const { showView, toast } = window.QC;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const ADMIN_PIN = '1234'; // demo only — real auth with backend
  const PRO_PRICE = 499;    // ₹ / month, for MRR estimate
  const KEY = 'quotecraft.admin.v1';

  /* ---------- store ---------- */
  const AdminStore = (() => {
    const uid = () => Math.random().toString(36).slice(2, 9);
    const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(9 + (n * 7) % 10, (n * 13) % 60, 0, 0); return d.getTime(); };
    const rnd = (seed => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; })(42);

    const seedUsers = () => {
      const first = ['Ramesh', 'Priya', 'Arjun', 'Sneha', 'Vikram', 'Anitha', 'Mohammed', 'Divya', 'Karthik', 'Lakshmi', 'Suresh', 'Fatima'];
      const last = ['Kumar', 'Sharma', 'Patel', 'Nair', 'Reddy', 'Iyer', 'Khan', 'Menon', 'Shetty', 'Rao', 'Das', 'Verma'];
      const biz = ['Kumar Enterprises', 'Sharma Traders', 'Patel Electricals', 'Nair Interiors', 'Reddy Constructions', 'Iyer Textiles', 'Khan Hardware', 'Menon Foods', 'Shetty Motors', 'Rao Pharma', 'Das Decor', 'Verma Agro'];
      const cities = ['Pune', 'Mumbai', 'Chennai', 'Hyderabad', 'Bengaluru', 'Delhi', 'Ahmedabad', 'Kochi', 'Jaipur', 'Kolkata', 'Surat', 'Lucknow'];
      return first.map((f, i) => {
        const pro = rnd() > 0.62;
        return {
          id: uid() + i,
          name: `${f} ${last[i]}`,
          businessName: biz[i],
          email: `${f.toLowerCase()}.${last[i].toLowerCase()}@example.com`,
          phone: `+91 9${String(Math.floor(100000000 + rnd() * 899999999))}`,
          city: cities[i],
          plan: pro ? 'pro' : 'free',
          status: rnd() > 0.9 ? 'blocked' : 'active',
          signupAt: daysAgo(Math.floor(rnd() * 88)),
          lastActive: daysAgo(Math.floor(rnd() * 10)),
          docsCount: Math.floor(rnd() * 240) + (pro ? 60 : 3)
        };
      });
    };

    const load = () => {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw);
      } catch { /* fall through */ }
      const data = { users: seedUsers() };
      localStorage.setItem(KEY, JSON.stringify(data));
      return data;
    };
    let data = load();
    const persist = () => localStorage.setItem(KEY, JSON.stringify(data));

    return {
      list: (filter = 'all', q = '') => {
        let users = [...data.users].sort((a, b) => b.signupAt - a.signupAt);
        if (filter === 'pro' || filter === 'free') users = users.filter(u => u.plan === filter);
        if (filter === 'blocked') users = users.filter(u => u.status === 'blocked');
        if (q) {
          const n = q.toLowerCase();
          users = users.filter(u => [u.name, u.businessName, u.email, u.phone, u.city].join(' ').toLowerCase().includes(n));
        }
        return users;
      },
      stats() {
        const users = data.users;
        const pro = users.filter(u => u.plan === 'pro').length;
        const blocked = users.filter(u => u.status === 'blocked').length;
        const totalDocs = users.reduce((s, u) => s + (u.docsCount || 0), 0);
        const month = new Date().toISOString().slice(0, 7);
        const newThisMonth = users.filter(u => new Date(u.signupAt).toISOString().slice(0, 7) === month).length;
        const active7d = users.filter(u => Date.now() - u.lastActive < 7 * 864e5).length;
        return { total: users.length, pro, blocked, free: users.length - pro, totalDocs, newThisMonth, active7d, mrr: pro * PRO_PRICE };
      },
      signupsLast14Days() {
        const days = [...Array(14)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (13 - i)); return d; });
        return days.map(d => {
          const key = d.toISOString().slice(0, 10);
          const count = data.users.filter(u => new Date(u.signupAt).toISOString().slice(0, 10) === key).length;
          return { label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), day: d.getDate(), count };
        });
      },
      toggleBlock(id) { const u = data.users.find(u => u.id === id); if (u) { u.status = u.status === 'blocked' ? 'active' : 'blocked'; persist(); } return u; },
      setPlan(id, plan) { const u = data.users.find(u => u.id === id); if (u) { u.plan = plan; persist(); } return u; },
      remove(id) { data.users = data.users.filter(u => u.id !== id); persist(); },
      resetDemo() { localStorage.removeItem(KEY); data = load(); },
      exportCSV() {
        const head = ['Name', 'Business', 'Email', 'Phone', 'City', 'Plan', 'Status', 'Signup', 'Docs created'];
        const rows = data.users.map(u => [u.name, u.businessName, u.email, u.phone, u.city, u.plan, u.status, new Date(u.signupAt).toISOString().slice(0, 10), u.docsCount].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
        return [head.join(','), ...rows].join('\n');
      }
    };
  })();

  /* ---------- view ---------- */
  let filter = 'all';
  let query = '';
  const fmtDate = ts => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });

  function renderStats() {
    const s = AdminStore.stats();
    $('#admin-stats').innerHTML = `
      <div class="stat"><div class="stat-label">Users</div><div class="stat-value">${s.total}</div></div>
      <div class="stat"><div class="stat-label">MRR</div><div class="stat-value green">₹${s.mrr.toLocaleString('en-IN')}</div></div>
      <div class="stat"><div class="stat-label">Pro / Free</div><div class="stat-value">${s.pro} / ${s.free}</div></div>
      <div class="stat"><div class="stat-label">New (month)</div><div class="stat-value">${s.newThisMonth}</div></div>
      <div class="stat"><div class="stat-label">Active 7d</div><div class="stat-value">${s.active7d}</div></div>
      <div class="stat"><div class="stat-label">Docs created</div><div class="stat-value">${s.totalDocs}</div></div>`;
  }

  function renderBars() {
    const days = AdminStore.signupsLast14Days();
    const max = Math.max(1, ...days.map(d => d.count));
    $('#admin-bars').innerHTML = days.map(d => `
      <div class="bar-col" title="${esc(d.label)}: ${d.count} signup(s)">
        <div class="bar" style="height:${Math.max(4, (d.count / max) * 84)}px"></div>
        <div class="bar-label">${esc(String(d.day))}</div>
      </div>`).join('');
  }

  function renderUsers() {
    const users = AdminStore.list(filter, query);
    $('#admin-user-list').innerHTML = users.map(u => `
      <div class="list-row user-row">
        <div class="avatar">${esc(u.name.charAt(0).toUpperCase())}</div>
        <div class="doc-main">
          <div class="doc-client">${esc(u.businessName)} <span class="plan-badge plan-${esc(u.plan)}">${esc(u.plan.toUpperCase())}</span>${u.status === 'blocked' ? '<span class="plan-badge plan-blocked">BLOCKED</span>' : ''}</div>
          <div class="doc-meta">${esc(u.name)} · ${esc(u.city)} · ${esc(u.email)}</div>
          <div class="doc-meta">${esc(u.phone)} · joined ${fmtDate(u.signupAt)} · ${u.docsCount} docs</div>
          <div class="user-actions">
            <button class="btn btn-ghost btn-sm" data-toggle-plan="${esc(u.id)}">${u.plan === 'pro' ? 'Downgrade to Free' : 'Upgrade to Pro'}</button>
            <button class="btn btn-ghost btn-sm ${u.status === 'blocked' ? '' : 'danger'}" data-toggle-block="${esc(u.id)}">${u.status === 'blocked' ? 'Unblock' : 'Block'}</button>
            <button class="btn btn-ghost btn-sm danger" data-delete-user="${esc(u.id)}">Delete</button>
          </div>
        </div>
      </div>`).join('') || '<p class="muted" style="padding:16px">No users match.</p>';
  }

  function renderAll() { renderStats(); renderBars(); renderUsers(); }

  /* ---------- events ---------- */
  const pinModal = $('#admin-pin-modal');
  $('#open-admin').addEventListener('click', () => { $('#admin-pin').value = ''; $('#admin-pin-error').hidden = true; pinModal.showModal(); });
  $('#admin-pin-cancel').addEventListener('click', () => pinModal.close());
  $('#admin-pin-form').addEventListener('submit', e => {
    e.preventDefault();
    if ($('#admin-pin').value === ADMIN_PIN) { pinModal.close(); renderAll(); showView('view-admin'); }
    else { $('#admin-pin-error').hidden = false; }
  });
  $('#admin-exit').addEventListener('click', () => showView('view-settings'));
  $('#admin-filter').addEventListener('click', e => { const b = e.target.closest('.seg-btn'); if (!b) return; filter = b.dataset.filter; $$('#admin-filter .seg-btn').forEach(x => x.classList.toggle('seg-active', x === b)); renderUsers(); });
  $('#admin-search').addEventListener('input', e => { query = e.target.value.trim(); renderUsers(); });

  $('#admin-user-list').addEventListener('click', e => {
    const togglePlan = e.target.closest('[data-toggle-plan]');
    const toggleBlock = e.target.closest('[data-toggle-block]');
    const del = e.target.closest('[data-delete-user]');
    if (togglePlan) { const u = AdminStore.list('all').find(u => u.id === togglePlan.dataset.togglePlan); AdminStore.setPlan(u.id, u.plan === 'pro' ? 'free' : 'pro'); toast('Plan updated'); }
    else if (toggleBlock) { const u = AdminStore.toggleBlock(toggleBlock.dataset.toggleBlock); toast(u?.status === 'blocked' ? 'User blocked' : 'User unblocked'); }
    else if (del) { if (confirm('Delete this user and their data?')) { AdminStore.remove(del.dataset.deleteUser); toast('User deleted'); } else return; }
    else return;
    renderAll();
  });

  $('#admin-export-csv').addEventListener('click', () => {
    const blob = new Blob([AdminStore.exportCSV()], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'quotecraft-users.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#admin-reset-demo').addEventListener('click', () => {
    if (confirm('Reset demo users to the original dataset?')) { AdminStore.resetDemo(); renderAll(); toast('Demo data reset'); }
  });
})();
