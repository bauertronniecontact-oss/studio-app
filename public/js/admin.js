/* Studio — admin SPA */
(async function () {

  /* ────────── Helpers ────────── */
  const api = async (url, opts = {}) => {
    const r = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (r.status === 401) { location.href = '/login'; throw new Error('auth'); }
    if (!r.ok) throw new Error((await r.json().catch(()=>({}))).error || 'error');
    return r.json();
  };
  const $ = (s, root = document) => root.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const toast = (msg) => {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1800);
  };

  /* ────────── Upload + drag & drop ────────── */
  async function uploadFile(file) {
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!r.ok) throw new Error('upload échoué');
    return (await r.json()).url;
  }
  // crée une zone drag&drop dans un container donné, qui synchronise une URL dans un input cible
  function attachDropZone(container, targetInput, opts = {}) {
    const initial = targetInput.value || '';
    container.classList.add('drop-zone');
    container.innerHTML = renderZone(initial);
    const fileIn = container.querySelector('input[type=file]');
    function renderZone(url) {
      if (url) {
        container.classList.add('has-image');
        return `
          <button type="button" class="dz-clear" title="Retirer">×</button>
          <div class="dz-thumb"><img src="${esc(url)}" alt=""></div>
          <div style="font-size:11px;letter-spacing:0.04em;">Cliquer ou déposer pour remplacer</div>
          <input type="file" accept="image/*">`;
      }
      container.classList.remove('has-image');
      return `
        <div style="font-size:14px;margin-bottom:4px;">📷 Déposez une image ici</div>
        <div style="font-size:11px;letter-spacing:0.04em;">ou cliquez pour parcourir · ${opts.note || 'JPG/PNG · max 12 MB'}</div>
        <input type="file" accept="image/*">`;
    }
    function setUrl(url) {
      targetInput.value = url;
      targetInput.dispatchEvent(new Event('input', { bubbles: true }));
      container.innerHTML = renderZone(url);
      bindInner();
    }
    // exposer pour réactualisation externe
    container._dzSet = setUrl;

    function bindInner() {
      const fileIn = container.querySelector('input[type=file]');
      fileIn.addEventListener('change', async () => {
        if (!fileIn.files[0]) return;
        container.classList.add('dragging');
        try { const url = await uploadFile(fileIn.files[0]); setUrl(url); toast('Image uploadée.'); }
        catch (e) { toast('Échec upload.'); }
        finally { container.classList.remove('dragging'); }
      });
      const clear = container.querySelector('.dz-clear');
      if (clear) clear.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); setUrl(''); });
    }
    container.addEventListener('dragover', e => { e.preventDefault(); container.classList.add('dragging'); });
    container.addEventListener('dragleave', () => container.classList.remove('dragging'));
    container.addEventListener('drop', async e => {
      e.preventDefault(); container.classList.remove('dragging');
      const f = e.dataTransfer.files[0];
      if (!f || !/^image\//.test(f.type)) return;
      try { const url = await uploadFile(f); setUrl(url); toast('Image uploadée.'); }
      catch { toast('Échec upload.'); }
    });
    bindInner();
  }

  /* ────────── Modales génériques (remplacent prompt / confirm) ────────── */
  function openModal(innerHtml) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-overlay';
    wrap.innerHTML = `<div class="modal">${innerHtml}</div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    const close = () => { wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 200); };
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    return { wrap, close };
  }

  // Affiche une modale-formulaire. fields = [{ name, label, value, type?, required?, textarea? }]
  // Retourne une promesse résolue avec {name: value} ou null si annulé.
  function modalForm(title, fields, submitLabel = 'Enregistrer') {
    return new Promise(resolve => {
      const html = `
        <div class="modal-head">
          <h3>${esc(title)}</h3>
          <button class="modal-close" type="button" data-close>&times;</button>
        </div>
        <form id="genericForm">
          ${fields.map(f => `
            <div class="field" style="margin-top:14px;">
              <label>${esc(f.label || f.name)}</label>
              ${f.textarea
                ? `<textarea name="${esc(f.name)}" rows="${f.rows || 3}" ${f.required?'required':''}>${esc(f.value||'')}</textarea>`
                : `<input name="${esc(f.name)}" type="${f.type||'text'}" value="${esc(f.value||'')}" ${f.required?'required':''} ${f.placeholder?`placeholder="${esc(f.placeholder)}"`:''}>`
              }
            </div>
          `).join('')}
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" data-close>Annuler</button>
            <button type="submit" class="btn">${esc(submitLabel)}</button>
          </div>
        </form>`;
      const { wrap, close } = openModal(html);
      let resolved = false;
      wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
        if (!resolved) { resolved = true; resolve(null); }
      }));
      wrap.querySelector('#genericForm').addEventListener('submit', e => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target).entries());
        resolved = true;
        close();
        resolve(data);
      });
      // autofocus
      setTimeout(() => wrap.querySelector('input,textarea')?.focus(), 50);
    });
  }

  // Confirmation : retourne Promise<boolean>
  function modalChoice(message, choices) {
    return new Promise(resolve => {
      const html = `
        <div class="modal-head">
          <h3>${esc(message)}</h3>
          <button class="modal-close" type="button" data-close>&times;</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">
          ${choices.map(c => `<button type="button" class="btn ${c.kind==='ghost'?'btn-ghost':(c.kind==='danger'?'btn-danger':'')}" data-choice="${esc(c.id)}" style="text-align:left;justify-content:flex-start;">${esc(c.label)}</button>`).join('')}
        </div>
        <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>Annuler</button></div>`;
      const { wrap, close } = openModal(html);
      let resolved = false;
      wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { if (!resolved) { resolved = true; resolve(null); } }));
      wrap.querySelectorAll('[data-choice]').forEach(b => b.addEventListener('click', () => { resolved = true; close(); resolve(b.dataset.choice); }));
    });
  }
  function modalConfirm(message, { okLabel = 'Confirmer', danger = false } = {}) {
    return new Promise(resolve => {
      const html = `
        <div class="modal-head">
          <h3>Confirmation</h3>
          <button class="modal-close" type="button" data-close>&times;</button>
        </div>
        <p style="font-family:'Cormorant Garamond',serif;font-size:16px;color:var(--ink-soft);line-height:1.5;">
          ${esc(message)}
        </p>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-close>Annuler</button>
          <button type="button" class="btn ${danger?'btn-danger':''}" data-ok>${esc(okLabel)}</button>
        </div>`;
      const { wrap, close } = openModal(html);
      let resolved = false;
      wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
        if (!resolved) { resolved = true; resolve(false); }
      }));
      wrap.querySelector('[data-ok]').addEventListener('click', () => {
        resolved = true; close(); resolve(true);
      });
    });
  }

  /* ────────── Auth + white-label ────────── */
  let me;
  try { me = await api('/api/me'); }
  catch { location.href = '/login'; return; }
  applyWhiteLabel(me);
  if (me.impersonating) {
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:var(--accent);color:#fff;font-family:Inter,sans-serif;font-size:13px;padding:8px 16px;display:flex;align-items:center;justify-content:center;gap:14px;';
    b.innerHTML = `Mode admin — vous gérez le studio de <strong>${esc(me.studio_name || me.name || me.email)}</strong> <button id="exitImp" style="background:#fff;color:var(--ink);border:none;padding:4px 12px;border-radius:3px;cursor:pointer;font-weight:600;">← Revenir à l'admin</button>`;
    document.body.appendChild(b);
    document.body.style.paddingTop = '38px';
    document.getElementById('exitImp').addEventListener('click', async () => {
      await api('/api/admin/stop-impersonate', { method: 'POST' });
      location.href = '/admin/platform';
    });
  }

  // Charge le compteur de non-lus pour la sidebar (toutes les minutes)
  async function refreshInboxBadge() {
    try {
      const r = await api('/api/inbox');
      const el = document.getElementById('sideInboxUnread');
      if (el) el.textContent = r.unread > 0 ? r.unread : '';
    } catch {}
  }
  refreshInboxBadge();
  setInterval(refreshInboxBadge, 60000);

  function applyWhiteLabel(u) {
    const studioName = (u.studio_name || 'STUDIO').toUpperCase();
    const logo = u.studio_logo || (studioName[0] || 'S');
    const accent = u.accent_color || '#b8915a';
    document.documentElement.style.setProperty('--accent', accent);
    const mark = $('#sideMark');
    if (mark) mark.innerHTML = `<span class="logo">${esc(logo)}</span>${esc(studioName)}`;
  }

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  });

  $('#studioSettingsBtn').addEventListener('click', openStudioSettings);

  async function openStudioSettings() {
    const portfolio = Array.isArray(me.portfolio) ? me.portfolio : [];
    const html = `
      <div class="modal-head">
        <h3>Paramètres du <em>studio</em></h3>
        <button class="modal-close" type="button" data-close>&times;</button>
      </div>
      <form id="studioForm">

        <!-- Identité visuelle -->
        <div class="settings-section">
          <div class="settings-label">Identité visuelle</div>
          <div class="form-row">
            <div class="field"><label>Nom du studio</label><input name="studio_name" value="${esc(me.studio_name||'')}" placeholder="STUDIO" maxlength="40"></div>
            <div class="field"><label>Initiale / logo</label><input name="studio_logo" value="${esc(me.studio_logo||'')}" placeholder="S" maxlength="2"></div>
            <div class="field"><label>Couleur d'accent</label><input name="accent_color" type="color" value="${esc(me.accent_color||'#b8915a')}" style="height:40px;padding:4px;"></div>
          </div>
          <div class="form-row" style="margin-top:12px;">
            <div class="field"><label>Votre nom</label><input name="name" value="${esc(me.name||'')}"></div>
            <div class="field" style="grid-column:span 2"><label>Votre photo (URL)</label><input name="photo_url" type="url" value="${esc(me.photo_url||'')}" placeholder="https://…"></div>
          </div>
          <div class="field" style="margin-top:12px;"><label>Bio (visible sur la page client + dans votre profil public)</label><textarea name="bio" rows="4" placeholder="Quelques mots sur vous, votre approche…">${esc(me.bio||'')}</textarea></div>
        </div>

        <!-- Profil public marketplace -->
        <div class="settings-section">
          <div class="settings-section-head">
            <div class="settings-label">Profil public — annuaire des stylistes</div>
            <label class="toggle">
              <input type="checkbox" name="is_public" ${me.is_public ? 'checked' : ''}>
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-label">Visible dans <code>/discover</code></span>
            </label>
          </div>
          <div class="form-row">
            <div class="field"><label>Slug d'URL publique</label>
              <input name="public_slug" value="${esc(me.public_slug||'')}" placeholder="marie-dupont" pattern="[a-z0-9-]+">
              <div style="font-size:11px;color:var(--muted);margin-top:4px;font-style:italic;font-family:'Cormorant Garamond',serif;">
                Votre URL : <code>${location.origin}/s/${esc(me.public_slug || '…')}</code>
              </div>
            </div>
            <div class="field"><label>Ville</label><input name="public_city" value="${esc(me.public_city||'')}" placeholder="Genève"></div>
            <div class="field"><label>Années d'expérience</label><input name="years_experience" type="number" min="0" max="60" value="${esc(me.years_experience||'')}"></div>
          </div>
          <div class="field" style="margin-top:12px;"><label>Phrase d'accroche</label>
            <input name="public_tagline" value="${esc(me.public_tagline||'')}" placeholder="Le vestiaire qui vous ressemble." maxlength="120">
          </div>
          <div class="field" style="margin-top:12px;"><label>Spécialités (séparées par des virgules)</label>
            <input name="specialties" value="${esc(me.specialties||'')}" placeholder="Smart casual, Mariage, Hiver, Grande taille…">
          </div>

          <div style="margin-top:18px;">
            <label style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted);font-weight:500;">Portfolio (jusqu'à 12 images)</label>
            <div id="portfolioZone" class="portfolio-zone" style="margin-top:8px;"></div>
            <div style="font-size:11px;color:var(--muted);margin-top:6px;font-style:italic;font-family:'Cormorant Garamond',serif;">
              Glissez-déposez des images ici, ou cliquez. Réorganisables.
            </div>
          </div>
        </div>

        <!-- Mot de passe -->
        <div class="settings-section">
          <div class="settings-label">Mot de passe</div>
          <div class="form-row">
            <div class="field"><label>Mot de passe actuel</label><input name="pwd_current" type="password" autocomplete="current-password"></div>
            <div class="field"><label>Nouveau mot de passe</label><input name="pwd_next" type="password" autocomplete="new-password"></div>
          </div>
        </div>

        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-close>Fermer</button>
          <button type="submit" class="btn">Enregistrer</button>
        </div>
      </form>`;
    const { wrap, close } = openModal(html);

    // Portfolio drag-drop + reorder
    let portfolioUrls = [...portfolio];
    const portfolioZone = wrap.querySelector('#portfolioZone');
    const renderPortfolio = () => {
      portfolioZone.innerHTML = `
        ${portfolioUrls.map((u, i) => `
          <div class="pf-tile" draggable="true" data-i="${i}">
            <img src="${esc(u)}" alt="" onerror="this.parentElement.classList.add('broken');">
            <button type="button" class="pf-rm" data-rm="${i}" title="Retirer">×</button>
          </div>`).join('')}
        ${portfolioUrls.length < 12 ? `
          <label class="pf-add">
            <input type="file" accept="image/*" multiple style="display:none;" id="pfFile">
            <span>+</span>
            <small>Ajouter</small>
          </label>` : ''}`;
      // Remove
      portfolioZone.querySelectorAll('.pf-rm').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        portfolioUrls.splice(+b.dataset.rm, 1);
        renderPortfolio();
      }));
      // File upload
      const fileInput = portfolioZone.querySelector('#pfFile');
      if (fileInput) fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        for (const f of files) {
          if (portfolioUrls.length >= 12) break;
          try {
            const fd = new FormData(); fd.append('file', f);
            const r = await fetch('/api/upload', { method: 'POST', body: fd });
            if (r.ok) {
              const { url } = await r.json();
              portfolioUrls.push(url);
              renderPortfolio();
            }
          } catch {}
        }
      });
      // Drag to reorder
      let dragI = null;
      portfolioZone.querySelectorAll('.pf-tile').forEach(tile => {
        tile.addEventListener('dragstart', () => { dragI = +tile.dataset.i; tile.classList.add('dragging'); });
        tile.addEventListener('dragend', () => tile.classList.remove('dragging'));
        tile.addEventListener('dragover', e => e.preventDefault());
        tile.addEventListener('drop', e => {
          e.preventDefault();
          const targetI = +tile.dataset.i;
          if (dragI === null || dragI === targetI) return;
          const item = portfolioUrls.splice(dragI, 1)[0];
          portfolioUrls.splice(targetI, 0, item);
          renderPortfolio();
        });
      });
    };
    renderPortfolio();

    wrap.querySelector('#studioForm').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      const settings = {
        studio_name: fd.studio_name, studio_logo: fd.studio_logo,
        accent_color: fd.accent_color, name: fd.name,
        photo_url: fd.photo_url, bio: fd.bio,
        public_slug: fd.public_slug, public_tagline: fd.public_tagline,
        public_city: fd.public_city, specialties: fd.specialties,
        years_experience: fd.years_experience ? parseInt(fd.years_experience) : null,
        is_public: !!fd.is_public,
        portfolio: portfolioUrls
      };
      try {
        me = await api('/api/me/settings', { method: 'PUT', body: settings });
      } catch (err) {
        toast(err.message || 'Erreur enregistrement.');
        return;
      }
      applyWhiteLabel(me);
      if (fd.pwd_current && fd.pwd_next) {
        try {
          await api('/api/me/password', { method: 'PUT', body: { current: fd.pwd_current, next: fd.pwd_next } });
          toast('Mot de passe mis à jour.');
        } catch (err) { toast(err.message || 'Erreur mot de passe.'); return; }
      }
      close();
      toast('Paramètres enregistrés.');
    });
  }

  /* ────────── State ────────── */
  let clients = [];
  let activeClient = null, folders = [], activeFolderId = null;
  let activeTab = 'items'; // items | inspirations | moodboard
  let clientMoodboard = [];
  let items = [];
  let inspirations = [];

  /* ────────── Clients sidebar + galerie portfolio ────────── */
  async function loadClients() {
    clients = await api('/api/clients');
    renderClientList();
    if (!activeClient) renderGallery();
  }
  function renderClientList() {
    const root = $('#clientList');
    if (!clients.length) {
      root.innerHTML = '<div style="font-family:Cormorant Garamond,serif;font-style:italic;font-size:13px;color:rgba(255,255,255,0.4);padding:8px 12px;">Aucun client.</div>';
      return;
    }
    root.innerHTML = clients.map(c => `
      <div class="client-row ${activeClient && activeClient.id===c.id ? 'active' : ''}" data-id="${c.id}">
        <span class="c-name">${esc(c.name)}</span>
        <span class="c-count">${c.items_count}·${c.insp_count}</span>
      </div>
    `).join('');
    root.querySelectorAll('.client-row').forEach(row =>
      row.addEventListener('click', () => selectClient(+row.dataset.id))
    );
  }

  /* ────── Menu popover sur les cartes du portfolio ────── */
  function openCardMenu(cardEl, cli) {
    // Fermer un éventuel popover existant
    document.querySelectorAll('.card-menu').forEach(m => m.remove());

    const trigger = cardEl.querySelector('.card-menu-trigger');
    const tRect = trigger.getBoundingClientRect();

    const menu = document.createElement('div');
    menu.className = 'card-menu';
    menu.innerHTML = `
      <a class="cm-item" href="/c/${esc(cli.slug)}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24"><path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>
        Voir le site
      </a>
      <button class="cm-item" data-act="copy">
        <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copier le lien
      </button>
      <button class="cm-item" data-act="invite">
        <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>
        Inviter par email
      </button>
      <button class="cm-item" data-act="rename">
        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Renommer
      </button>
      <div class="cm-sep"></div>
      <button class="cm-item cm-danger" data-act="delete">
        <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        Supprimer
      </button>
    `;
    document.body.appendChild(menu);

    // Position : ouvre vers le haut + à droite (sous le bouton ⋯)
    const mWidth = 200;
    const left = Math.min(window.innerWidth - mWidth - 12, Math.max(12, tRect.right - mWidth));
    const top = tRect.bottom + 6;
    menu.style.left = left + 'px';
    menu.style.top  = top + 'px';

    // Si pas assez de place en bas, ouvre vers le haut
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 12) {
        menu.style.top = (tRect.top - r.height - 6) + 'px';
      }
      menu.classList.add('open');
    });

    const close = () => menu.remove();

    // Délégué : un seul handler pour tous les items
    menu.addEventListener('click', async (e) => {
      const item = e.target.closest('.cm-item');
      if (!item) return;
      const act = item.dataset.act;
      if (item.tagName === 'A') { close(); return; } // <a> natif
      e.preventDefault();
      close();

      if (act === 'copy') {
        navigator.clipboard.writeText(`${location.origin}/c/${cli.slug}`).then(() => toast('✓ Lien copié.'));
      } else if (act === 'invite') {
        activeClient = cli;
        openInviteModal(cli);
      } else if (act === 'rename') {
        const d = await modalForm('Renommer le client', [
          { name: 'name', label: 'Nom', value: cli.name, required: true }
        ]);
        if (!d || !d.name) return;
        await api(`/api/clients/${cli.id}`, { method: 'PUT', body: { name: d.name } });
        await loadClients();
        renderGallery();
        toast('Client renommé.');
      } else if (act === 'delete') {
        const ok = await modalConfirm(
          `Supprimer « ${cli.name} » et toutes ses données (pièces, inspirations, profil) ? Cette action est irréversible.`,
          { okLabel: 'Supprimer définitivement', danger: true }
        );
        if (!ok) return;
        await api(`/api/clients/${cli.id}`, { method: 'DELETE' });
        await loadClients();
        renderGallery();
        toast('Client supprimé.');
      }
    });

    // Fermeture sur clic extérieur / Escape / scroll
    setTimeout(() => {
      const onClickOut = e => { if (!menu.contains(e.target)) { close(); cleanup(); } };
      const onEsc      = e => { if (e.key === 'Escape') { close(); cleanup(); } };
      const onScroll   = () => { close(); cleanup(); };
      const cleanup = () => {
        document.removeEventListener('click', onClickOut);
        document.removeEventListener('keydown', onEsc);
        window.removeEventListener('scroll', onScroll, true);
      };
      document.addEventListener('click', onClickOut);
      document.addEventListener('keydown', onEsc);
      window.addEventListener('scroll', onScroll, true);
    }, 0);
  }

  function backToGallery() {
    activeClient = null;
    items = []; inspirations = [];
    renderClientList();
    renderGallery();
  }

  const TAG_PRESETS = [
    { label: 'VIP', color: '#c0392b' },
    { label: 'Hiver', color: '#2c5d7c' },
    { label: 'Été', color: '#e67e22' },
    { label: 'Sportif', color: '#27ae60' },
    { label: 'Mariage', color: '#9b59b6' },
    { label: 'Business', color: '#34495e' },
    { label: 'Casual', color: '#b8915a' },
    { label: 'Soirée', color: '#1a1a1a' },
  ];

  let tagFilter = null; // tag actif dans la galerie

  function renderGallery() {
    const ago = s => {
      if (!s) return 'pas encore vu';
      const days = Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
      if (days < 1) return "vu aujourd'hui";
      if (days < 7) return `vu il y a ${days}j`;
      if (days < 30) return `vu il y a ${Math.floor(days/7)} sem.`;
      return `vu il y a ${Math.floor(days/30)} mois`;
    };
    const STATUS_LBL = { active:'Active', dormant:'Dormant', prospect:'Prospect', archived:'Archivé' };

    const card = c => {
      const previews = c.preview || [];
      let mosaicCls = `m-${Math.min(previews.length, 8)}`;
      let tiles = '';
      if (previews.length === 0) {
        tiles = `<div class="tile empty"><span style="position:relative;z-index:1;">— sans aperçu —</span></div>`;
      } else if (previews.length <= 5) {
        tiles = previews.map(p => `<div class="tile"><img src="${esc(p)}" alt="" onerror="this.parentElement.classList.add('img-broken');this.remove();"></div>`).join('');
      } else {
        const shown = previews.slice(0, c.items_count > 8 ? 7 : 8);
        tiles = shown.map(p => `<div class="tile"><img src="${esc(p)}" alt="" onerror="this.parentElement.classList.add('img-broken');this.remove();"></div>`).join('');
        if (c.items_count > 8) {
          tiles += `<div class="tile more">+${c.items_count - 7}</div>`;
        }
      }

      const initial = (c.name || '?').trim().charAt(0).toUpperCase();
      const tagsHtml = (c.tags || []).slice(0, 3).map(t =>
        `<span class="tag-chip small" style="background:${esc(t.color)}">${esc(t.label)}</span>`
      ).join('');
      return `
        <div class="portfolio-card" data-id="${c.id}" data-slug="${esc(c.slug)}" draggable="true">
          <span class="drag-handle" title="Glisser pour réordonner">⋮⋮</span>
          ${c.status ? `<span class="pc-status ${esc(c.status)}">${esc(STATUS_LBL[c.status] || c.status)}</span>` : ''}

          <div class="mosaic ${mosaicCls}">${tiles}</div>
          <div class="right-col">
            <div class="client-photo ${c.photo_url ? 'has-image' : ''}">
              ${c.photo_url
                ? `<img src="${esc(c.photo_url)}" alt="${esc(c.name)}" onerror="const p=this.parentElement;p.classList.remove('has-image');p.innerHTML='<span class=&quot;cp-initial&quot;>${esc(initial)}</span><span class=&quot;cp-label&quot;>Photo invalide</span>';">`
                : `<span class="cp-initial">${esc(initial)}</span><span class="cp-label">Sans photo</span>`}
            </div>
            <div class="pc-body">
              <div class="pc-name">${esc(c.name)}</div>
              <div class="pc-meta">
                <strong>${c.items_count}</strong> pièce${c.items_count>1?'s':''}
                <span class="dot">·</span>
                <strong>${c.insp_count}</strong> insp.
              </div>
              ${tagsHtml ? `<div class="pc-tags">${tagsHtml}</div>` : ''}
              <div class="pc-bottom">
                <span class="ago">${ago(c.last_viewed_at)}</span>
                <div class="pc-bottom-right">
                  ${c.likes_count > 0 ? `<span class="likes">♥ ${c.likes_count}</span>` : ''}
                  <button class="card-menu-trigger" aria-label="Actions" title="Actions">
                    <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>`;
    };

    const newCard = `
      <div class="portfolio-card new-card" id="galleryNew">
        <div class="nc-content">
          <span class="plus">+</span>
          <span style="font-style:italic;font-size:16px;">Nouveau client</span>
        </div>
      </div>`;

    // Tags uniques pour les filtres
    const allTags = [];
    const seen = new Set();
    clients.forEach(c => (c.tags || []).forEach(t => {
      const k = (t.label || '').toLowerCase();
      if (k && !seen.has(k)) { seen.add(k); allTags.push(t); }
    }));

    const filteredClients = tagFilter
      ? clients.filter(c => (c.tags || []).some(t => t.label.toLowerCase() === tagFilter.toLowerCase()))
      : clients;

    $('#main').innerHTML = `
      <div class="portfolio-head">
        <div>
          <h2>Mes <em>sélections</em></h2>
          <div style="font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--muted);font-size:14px;margin-top:6px;">
            ${filteredClients.length}/${clients.length} client${clients.length>1?'s':''} · glissez les cartes pour réordonner
          </div>
        </div>
        <input class="portfolio-search" id="galleryFilter" placeholder="🔎 Rechercher un client…">
      </div>
      ${allTags.length ? `
        <div class="tag-filters">
          <button class="tag-filter all ${!tagFilter?'active':''}" data-tag="">Tous</button>
          ${allTags.map(t => `
            <button class="tag-filter ${tagFilter===t.label?'active':''}" data-tag="${esc(t.label)}">
              <span class="dot" style="background:${esc(t.color)}"></span>${esc(t.label)}
            </button>
          `).join('')}
        </div>` : ''}
      <div class="portfolio-grid" id="galleryGrid">
        ${filteredClients.map(card).join('')}
        ${newCard}
      </div>
    `;

    // Clic carte → ouvrir client (sauf si clic sur menu ou drag handle)
    $('#galleryGrid').querySelectorAll('.portfolio-card[data-id]').forEach(el => {
      const id = +el.dataset.id;
      const slug = el.dataset.slug;
      const cli = clients.find(c => c.id === id);

      el.addEventListener('click', (e) => {
        if (e.target.closest('.card-menu-trigger')) return;
        if (e.target.closest('.card-menu')) return;
        if (e.target.closest('.drag-handle')) return;
        selectClient(id);
      });

      const trigger = el.querySelector('.card-menu-trigger');
      if (trigger) trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        openCardMenu(el, cli);
      });
    });
    $('#galleryNew').addEventListener('click', () => $('#newClientBtn').click());
    $('#galleryFilter').addEventListener('input', e => {
      const q = e.target.value.toLowerCase().trim();
      $('#galleryGrid').querySelectorAll('.portfolio-card[data-id]').forEach(el => {
        const c = clients.find(x => x.id === +el.dataset.id);
        const match = !q || (c.name || '').toLowerCase().includes(q);
        el.style.display = match ? '' : 'none';
      });
    });

    // Filtres tags
    document.querySelectorAll('.tag-filter').forEach(b => {
      b.addEventListener('click', () => {
        tagFilter = b.dataset.tag || null;
        renderGallery();
      });
    });

    // Drag & drop
    setupDragDrop();
  }

  /* ────────── Drag & drop ────────── */
  function setupDragDrop() {
    const grid = $('#galleryGrid'); if (!grid) return;
    let dragId = null;
    grid.querySelectorAll('.portfolio-card[data-id]').forEach(card => {
      card.addEventListener('dragstart', e => {
        dragId = +card.dataset.id;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', card.dataset.id); } catch {}
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        grid.querySelectorAll('.drag-over-left,.drag-over-right').forEach(el =>
          el.classList.remove('drag-over-left','drag-over-right'));
      });
      card.addEventListener('dragover', e => {
        if (!dragId || +card.dataset.id === dragId) return;
        e.preventDefault();
        const r = card.getBoundingClientRect();
        const left = (e.clientX - r.left) < r.width / 2;
        grid.querySelectorAll('.drag-over-left,.drag-over-right').forEach(el =>
          el.classList.remove('drag-over-left','drag-over-right'));
        card.classList.add(left ? 'drag-over-left' : 'drag-over-right');
      });
      card.addEventListener('drop', async e => {
        e.preventDefault();
        const targetId = +card.dataset.id;
        if (!dragId || dragId === targetId) return;
        const r = card.getBoundingClientRect();
        const insertBefore = (e.clientX - r.left) < r.width / 2;
        // réordonne le tableau local
        const ids = clients.map(c => c.id).filter(id => id !== dragId);
        const idx = ids.indexOf(targetId);
        ids.splice(insertBefore ? idx : idx + 1, 0, dragId);
        // optimiste : réordonne `clients` puis re-render
        clients.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        renderGallery();
        try { await api('/api/clients/reorder', { method: 'PUT', body: { ids } }); }
        catch { toast('Erreur réordonnancement.'); }
      });
    });
  }

  $('#newClientBtn').addEventListener('click', async () => {
    const data = await modalForm('Nouveau client', [
      { name: 'name', label: 'Nom du client', required: true, placeholder: 'ex: Philip 3XL' },
      { name: 'note', label: 'Note (optionnel)', textarea: true, rows: 2 }
    ], 'Créer');
    if (!data || !data.name) return;
    const c = await api('/api/clients', { method: 'POST', body: data });
    await loadClients();
    selectClient(c.id);
    toast('Client créé.');
  });

  async function selectClient(id) {
    activeClient = clients.find(c => c.id === id);
    renderClientList();
    items = await api(`/api/clients/${id}/items`);
    inspirations = await api(`/api/clients/${id}/inspirations`);
    folders = await api(`/api/clients/${id}/folders`);
    clientMoodboard = await api(`/api/clients/${id}/moodboard`).catch(() => []);
    activeFolderId = null;
    renderMain();
  }

  /* ────────── Main view ────────── */
  function renderMain() {
    if (!activeClient) return;
    const shareUrl = `${location.origin}/c/${activeClient.slug}`;
    const tagChips = (activeClient.tags || []).map(t =>
      `<span class="tag-chip" style="background:${esc(t.color)};font-size:10px;">${esc(t.label)}</span>`).join('');

    $('#main').innerHTML = `
      <button class="back-to-gallery" id="backToGalleryBtn">← Tous les clients</button>

      <div class="client-header">
        <div class="ch-identity">
          <h2>${esc(activeClient.name)}</h2>
          ${tagChips ? `<div class="ch-tags">${tagChips}</div>` : ''}
          ${activeClient.note ? `<div class="ch-note">${esc(activeClient.note)}</div>` : ''}
        </div>

        <div class="ch-share">
          <div class="ch-url" id="copyLinkBtn" title="Cliquer pour copier le lien complet (avec code)">
            <span class="ch-url-label">Lien client</span>
            <span class="ch-url-value">${esc(shareUrl)}</span>
            <span class="ch-copy-icon">⧉</span>
          </div>
          ${activeClient.access_code ? `
            <div class="ch-code" id="copyCodeBtn" title="Cliquer pour copier juste le code">
              <span class="ch-code-label">Code d'accès</span>
              <span class="ch-code-value">${esc(activeClient.access_code)}</span>
              <span class="ch-copy-icon">⧉</span>
            </div>` : ''}
          <button class="btn btn-sm btn-with-icon" id="inviteBtn">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>
            Inviter par email
          </button>
        </div>
      </div>

      <div class="client-toolbar">
        <div class="ct-group">
          <a class="ct-btn ct-primary" href="${esc(shareUrl)}" target="_blank" rel="noopener" title="Ouvrir la page du client dans un nouvel onglet">
            <svg viewBox="0 0 24 24"><path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>
            Voir le site
          </a>
        </div>
        <div class="ct-group">
          <button class="ct-btn" id="profileClientBtn">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>
            Profil
          </button>
          <button class="ct-btn" id="tagsBtn">
            <svg viewBox="0 0 24 24"><path d="M20 12l-8 8-9-9V3h8l9 9z"/><circle cx="7.5" cy="7.5" r="1"/></svg>
            Tags
          </button>
          <button class="ct-btn" id="crmBtn">
            <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9h18M7 14h3M14 14h3"/></svg>
            CRM
          </button>
          <button class="ct-btn" id="tryonBtn">
            <svg viewBox="0 0 24 24"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/></svg>
            Try-on
          </button>
        </div>
        <div class="ct-group ct-right">
          <button class="ct-btn" id="qrBtn">
            <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3M14 17v4M17 14v3M20 17v4M14 20h3"/></svg>
            QR
          </button>
          <a class="ct-btn" href="/api/clients/${activeClient.id}/report" target="_blank">
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>
            Rapport
          </a>
          <div class="ct-menu">
            <button class="ct-btn" id="moreMenuBtn">
              <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>
              Plus
            </button>
            <div class="ct-dropdown" id="moreMenu">
              <button data-act="history">
                <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>
                Historique des pièces
              </button>
              <button data-act="rename">
                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Renommer le client
              </button>
              <button data-act="delete" class="danger">
                <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                Supprimer le client
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="admin-tabs">
        <button data-t="items" class="${activeTab==='items'?'active':''}">Sélection (${items.length})</button>
        <button data-t="inspirations" class="${activeTab==='inspirations'?'active':''}">Inspiration Style (${inspirations.length})</button>
        <button data-t="moodboard" class="${activeTab==='moodboard'?'active':''}">Moodboard Client (${clientMoodboard.length})</button>
      </div>

      <div id="tabBody"></div>
    `;

    $('#backToGalleryBtn').addEventListener('click', backToGallery);

    // Copier le lien complet (toute la zone URL est cliquable)
    $('#copyLinkBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(shareUrl).then(() => toast('✓ Lien copié (avec code).'));
    });
    // Copier juste le code
    const copyCodeBtn = $('#copyCodeBtn');
    if (copyCodeBtn) copyCodeBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(activeClient.access_code).then(() => toast('✓ Code copié.'));
    });

    // Renommer
    const renameAction = async () => {
      const d = await modalForm('Éditer le client', [
        { name: 'name', label: 'Nom', value: activeClient.name, required: true },
        { name: 'note', label: 'Note', value: activeClient.note || '', textarea: true, rows: 2 }
      ]);
      if (!d) return;
      await api(`/api/clients/${activeClient.id}`, { method: 'PUT', body: d });
      await loadClients();
      activeClient = clients.find(c => c.id === activeClient.id);
      renderMain();
      toast('Client modifié.');
    };
    // Supprimer
    const deleteAction = async () => {
      const ok = await modalConfirm(
        `Supprimer « ${activeClient.name} » et toutes ses données (pièces et inspirations) ? Cette action est irréversible.`,
        { okLabel: 'Supprimer', danger: true });
      if (!ok) return;
      await api(`/api/clients/${activeClient.id}`, { method: 'DELETE' });
      activeClient = null;
      await loadClients();
      toast('Client supprimé.');
    };

    // Menu "Plus"
    const moreMenuBtn = $('#moreMenuBtn');
    const moreMenu = $('#moreMenu');
    moreMenuBtn.addEventListener('click', e => {
      e.stopPropagation();
      moreMenu.classList.toggle('open');
    });
    document.addEventListener('click', () => moreMenu?.classList.remove('open'));
    moreMenu.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        moreMenu.classList.remove('open');
        const act = b.dataset.act;
        if (act === 'history') openHistory(activeClient);
        if (act === 'rename') renameAction();
        if (act === 'delete') deleteAction();
      });
    });
    document.querySelectorAll('.admin-tabs button').forEach(b => {
      b.addEventListener('click', () => { activeTab = b.dataset.t; renderMain(); });
    });
    $('#profileClientBtn').addEventListener('click', () => openProfileEditor(activeClient));
    $('#inviteBtn').addEventListener('click', () => openInviteModal(activeClient));
    $('#tryonBtn').addEventListener('click', () => openTryonStudio(activeClient));
    $('#crmBtn').addEventListener('click', () => openCrmEditor(activeClient));
    $('#tagsBtn').addEventListener('click', () => openTagEditor(activeClient));
    $('#qrBtn').addEventListener('click', () => openQrModal(shareUrl, activeClient));

    if (activeTab === 'items') renderItemsTab();
    else if (activeTab === 'moodboard') renderMoodboardTab();
    else renderInspirationsTab();
  }

  /* ────────── Items tab ────────── */
  const CATEGORIES = [
    { v: 'tshirt',     l: 'T-Shirt' },
    { v: 'chemise',    l: 'Chemise' },
    { v: 'pull',       l: 'Pull / Sweat' },
    { v: 'veste',      l: 'Veste / Manteau' },
    { v: 'pantalon',   l: 'Pantalon / Jean' },
    { v: 'short',      l: 'Short' },
    { v: 'training',   l: 'Training / Sport' },
    { v: 'chaussures', l: 'Chaussures' },
    { v: 'accessoire', l: 'Accessoire' },
    { v: 'autre',      l: 'Autre' },
  ];
  const CURRENCIES = ['€', 'CHF', '$', '£'];

  const catOptions = (selected = '') =>
    `<option value="" ${!selected?'selected':''}>— Choisir —</option>` +
    CATEGORIES.map(c => `<option value="${c.v}" ${selected===c.v?'selected':''}>${c.l}</option>`).join('');

  // Sépare "CHF 120", "€ 69,00 €", "49,95 EUR" → { cur, amt }
  const parsePrice = (s) => {
    if (!s) return { cur: '€', amt: '' };
    s = String(s).toUpperCase();
    let cur = '€';
    if (s.includes('€') || s.includes('EUR'))      cur = '€';
    else if (s.includes('£') || s.includes('GBP')) cur = '£';
    else if (s.includes('$') || s.includes('USD')) cur = '$';
    else if (s.includes('CHF'))                    cur = 'CHF';
    const m = s.match(/\d+(?:[.,]\d{1,2})?/);
    return { cur, amt: m ? m[0] : '' };
  };
  const formatPrice = (cur, amt) => {
    if (!amt) return '';
    // S'assure que `amt` est pur numérique (sécurité si l'utilisateur recopie du texte)
    const clean = String(amt).match(/\d+(?:[.,]\d{1,2})?/);
    return clean ? `${cur} ${clean[0]}` : '';
  };

  const currencyOptions = (selected = 'CHF') =>
    CURRENCIES.map(c => `<option ${selected===c?'selected':''}>${c}</option>`).join('');

  function renderItemsTab() {
    $('#tabBody').innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>Ajouter une pièce</h3></div>

        <div style="background:rgba(184,145,90,0.08);border:1px solid rgba(184,145,90,0.25);padding:14px;margin-bottom:14px;border-radius:2px;">
          <div style="font-family:'Cormorant Garamond',serif;font-size:14px;font-style:italic;color:var(--ink);margin-bottom:8px;display:flex;align-items:center;gap:8px;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M16 4l4 4-4 4"/><path d="M12 8h8"/></svg>
            Import auto — collez l'URL d'un produit, on remplit le formulaire pour vous.
          </div>
          <div style="display:flex;gap:8px;">
            <input id="scrapeUrl" type="url" placeholder="https://…" style="flex:1;background:#fff;border:1px solid var(--hairline-strong);padding:10px 12px;font-size:13px;border-radius:2px;">
            <button class="btn" id="scrapeBtn" type="button" style="display:inline-flex;align-items:center;gap:8px;"><span id="scrapeBtnLabel">Importer</span><span id="scrapeSpinner" style="display:none;width:13px;height:13px;border:1.5px solid currentColor;border-top-color:transparent;border-radius:50%;animation:scrapeSpin .7s linear infinite;"></span></button>
            <style>@keyframes scrapeSpin{to{transform:rotate(360deg)}}#scrapeBtn[disabled]{opacity:.65;cursor:wait;}</style>
          </div>
          <div id="scrapeStatus" style="font-size:13px;color:var(--ink-soft);margin-top:8px;display:none;"></div>
        </div>

        <form id="itemForm">
          <div class="form-row">
            <div class="field"><label>Catégorie</label>
              <select name="cat" required>${catOptions()}</select>
            </div>
            <div class="field"><label>Marque</label><input name="brand" required></div>
            <div class="field"><label>Nom du produit</label><input name="name" required></div>
            <div class="field"><label>Prix</label>
              <div class="price-group">
                <select name="currency">${currencyOptions()}</select>
                <input name="amount" placeholder="120" inputmode="decimal">
              </div>
            </div>
          </div>
          <div class="form-row" style="margin-top:10px;">
            <div class="field" style="grid-column:span 2"><label>Lien (URL produit)</label><input name="link" type="url" placeholder="https://…"></div>
            <div class="field" style="grid-column:span 2">
              <label>Image</label>
              <input name="image" type="hidden">
              <div id="itemDrop"></div>
              <input id="itemImageUrl" type="url" placeholder="…ou collez une URL" style="margin-top:6px;background:transparent;border:none;border-bottom:1px dotted var(--hairline-strong);font-size:12px;color:var(--muted);padding:6px 0;">
              <div id="itemImageThumbs" style="display:none;gap:6px;margin-top:8px;flex-wrap:wrap;"></div>
            </div>
          </div>
          <div class="field" style="margin-top:10px;"><label>Description</label><textarea name="description" rows="2" placeholder="Pourquoi cette pièce…"></textarea></div>
          <div class="field" style="margin-top:10px;"><label>Dossiers</label><div id="itemFoldersPicker" style="display:flex;flex-wrap:wrap;gap:6px;"></div></div>
          <div style="margin-top:14px;display:flex;gap:8px;">
            <button class="btn" type="submit">Ajouter</button>
            <button class="btn btn-ghost" type="reset">Effacer</button>
          </div>
        </form>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>Pièces de la sélection (<span id="itemsCount">${items.length}</span>)</h3>
          <input class="admin-search" id="itemsSearch" placeholder="🔎 Rechercher (marque, nom, cat.)…">
        </div>
        <div id="folderBar" style="display:flex;flex-wrap:wrap;gap:6px;padding:0 0 12px;border-bottom:1px solid var(--hairline);margin-bottom:14px;align-items:center;"></div>
        <div class="adm-items" id="itemsGrid"></div>
      </div>
    `;

    // Drop zone image principale
    const imgHidden = $('#itemForm input[name=image]');
    const imgUrl = $('#itemImageUrl');
    const dropEl = $('#itemDrop');
    attachDropZone(dropEl, imgHidden);
    imgUrl.addEventListener('input', () => { imgHidden.value = imgUrl.value; });

    // Render items grid (avec filtrage par recherche)
    const STATUS_LABEL = { proposed:'Proposée', validated:'Validée', bought:'Achetée', rejected:'Refusée' };
    function renderItemsGrid(filter = '') {
      const f = filter.trim().toLowerCase();
      const filtered = items.filter(it => {
        if (activeFolderId != null && !(it.folder_ids || []).includes(activeFolderId)) return false;
        if (!f) return true;
        return (it.brand||'').toLowerCase().includes(f) ||
               (it.name||'').toLowerCase().includes(f) ||
               (it.cat||'').toLowerCase().includes(f);
      });
      $('#itemsCount').textContent = filtered.length;
      // Group by category (order: CATEGORIES list, puis "autre/sans cat" en fin)
      const catLabel = v => (CATEGORIES.find(c => c.v === v)?.l) || 'Sans catégorie';
      const groups = new Map();
      CATEGORIES.forEach(c => groups.set(c.v, []));
      groups.set('', []);
      filtered.forEach(it => { const k = it.cat && groups.has(it.cat) ? it.cat : ''; groups.get(k).push(it); });
      const renderItem = it => {
        const gal = Array.isArray(it.images) && it.images.length ? it.images : (it.image ? [it.image] : []);
        const multi = gal.length > 1;
        return `
        <div class="adm-item" draggable="true" data-id="${it.id}" data-gallery='${esc(JSON.stringify(gal))}'>
          <div class="ai-thumb ${gal[0] ? '' : 'placeholder'}">
            ${gal[0] ? `<img class="ai-gimg" data-idx="0" src="${esc(gal[0])}" alt="" onerror="this.parentElement.classList.add('placeholder');this.remove();">` : ''}
            ${multi ? `
              <button class="ai-nav prev" data-nav="-1" aria-label="Précédent">‹</button>
              <button class="ai-nav next" data-nav="1" aria-label="Suivant">›</button>
              <div class="ai-dots">${gal.map((_,i)=>`<span class="ai-dot${i===0?' on':''}" data-dot="${i}"></span>`).join('')}</div>
            ` : ''}
            ${it.liked ? `<div style="position:absolute;top:6px;right:6px;background:#fff;border-radius:50%;width:22px;height:22px;display:grid;place-items:center;border:1px solid #e74c3c;z-index:3;"><span style="color:#e74c3c;font-size:11px;">♥</span></div>` : ''}
          </div>
          ${it.item_status ? `<span class="status-pill status-${it.item_status}">${STATUS_LABEL[it.item_status]}</span>` : ''}
          <div class="ai-brand">${esc(it.brand || '—')}</div>
          <div class="ai-name">${esc(it.name || '')}</div>
          <div class="ai-meta">${esc(it.cat || '')}${it.price ? ' · ' + esc(it.price) : ''}</div>
          ${it.comment ? `<div class="comment-display" style="font-size:12px;padding:6px 8px;margin-top:6px;">${esc(it.comment)}</div>` : ''}
          <div class="ai-actions">
            <button class="btn btn-ghost btn-sm" data-act="edit">Éditer</button>
            <select class="status-select" data-id="${it.id}" style="padding:4px 24px 4px 8px;font-size:11px;background:#fff;border:1px solid var(--hairline);">
              <option value="">— statut —</option>
              <option value="proposed"  ${it.item_status==='proposed'?'selected':''}>Proposée</option>
              <option value="validated" ${it.item_status==='validated'?'selected':''}>Validée</option>
              <option value="bought"    ${it.item_status==='bought'?'selected':''}>Achetée</option>
              <option value="rejected"  ${it.item_status==='rejected'?'selected':''}>Refusée</option>
            </select>
            <button class="btn btn-ghost btn-sm btn-danger" data-act="del">×</button>
          </div>
        </div>`;};
      const sections = [];
      for (const [k, arr] of groups) {
        if (!arr.length) continue;
        sections.push(`<div class="cat-group-head" style="grid-column:1/-1;font-family:'Cormorant Garamond',serif;font-size:14px;font-style:italic;color:var(--ink-soft);letter-spacing:0.08em;text-transform:uppercase;padding:14px 0 6px;border-bottom:1px solid var(--hairline);margin-bottom:6px;">${esc(catLabel(k))} <span style="color:var(--muted);font-size:12px;">· ${arr.length}</span></div>`);
        sections.push(arr.map(renderItem).join(''));
      }
      $('#itemsGrid').innerHTML = sections.join('') || '<div style="grid-column:1/-1;font-family:Cormorant Garamond,serif;font-style:italic;color:var(--muted);padding:30px;text-align:center;">Aucun résultat.</div>';

      // bind actions
      $('#itemsGrid').querySelectorAll('.adm-item').forEach(card => {
        const id = +card.dataset.id;
        // drag start
        card.addEventListener('dragstart', e => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/item-id', String(id));
          card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        // carousel
        const gimg = card.querySelector('.ai-gimg');
        const navs = card.querySelectorAll('[data-nav]');
        const dots = card.querySelectorAll('[data-dot]');
        if (gimg && navs.length) {
          let gal = []; try { gal = JSON.parse(card.dataset.gallery || '[]'); } catch {}
          const show = i => {
            if (!gal.length) return;
            const n = (i + gal.length) % gal.length;
            gimg.src = gal[n]; gimg.dataset.idx = String(n);
            dots.forEach((d,k) => d.classList.toggle('on', k === n));
          };
          navs.forEach(b => b.addEventListener('click', e => { e.stopPropagation(); show((+gimg.dataset.idx||0) + (+b.dataset.nav)); }));
          dots.forEach(d => d.addEventListener('click', e => { e.stopPropagation(); show(+d.dataset.dot); }));
        }
        card.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
          if (activeFolderId != null) {
            // On est dans un dossier précis : on retire juste le lien
            const it = items.find(x => x.id === id);
            const next = new Set(it?.folder_ids || []); next.delete(activeFolderId);
            await api(`/api/items/${id}/folders`, { method: 'PUT', body: { folder_ids: [...next] } });
            items = await api(`/api/clients/${activeClient.id}/items`);
            renderFolderBar(); renderItemsGrid($('#itemsSearch').value);
            toast('Retirée du dossier.');
            return;
          }
          const choice = await modalChoice('Cette pièce', [
            { id: 'unlink', label: 'Retirer de tous les dossiers (la pièce reste dans "Tous")', kind: 'ghost' },
            { id: 'delete', label: 'Supprimer définitivement', kind: 'danger' },
          ]);
          if (!choice) return;
          if (choice === 'unlink') {
            await api(`/api/items/${id}/folders`, { method: 'PUT', body: { folder_ids: [] } });
            items = await api(`/api/clients/${activeClient.id}/items`);
            renderFolderBar(); renderItemsGrid($('#itemsSearch').value);
            toast('Retirée de tous les dossiers.');
          } else {
            await api(`/api/items/${id}`, { method: 'DELETE' });
            items = items.filter(x => x.id !== id);
            await loadClients(); renderMain(); toast('Supprimée.');
          }
        });
        card.querySelector('[data-act="edit"]')?.addEventListener('click', () => {
          openItemModal(items.find(x => x.id === id));
        });
        card.querySelector('.status-select')?.addEventListener('change', async e => {
          await api(`/api/items/${id}/status`, { method: 'PUT', body: { status: e.target.value || null } });
          const it = items.find(x => x.id === id); if (it) it.item_status = e.target.value || null;
          renderItemsGrid($('#itemsSearch').value);
          toast('Statut mis à jour.');
        });
      });
    }
    const FOLDER_KIND_SUGGESTIONS = ['Saison', 'Événement', 'Mariage', 'Vacances', 'Travail', 'Soirée', 'Casual', 'Autre'];
    async function reloadFolders() {
      folders = await api(`/api/clients/${activeClient.id}/folders`);
      items = await api(`/api/clients/${activeClient.id}/items`);
      renderFolderBar(); renderItemsGrid($('#itemsSearch').value);
    }
    function openFolderModal(folderToEdit = null) {
      const lab = (txt) => `<div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">${txt}</div>`;
      const inp = `padding:8px 10px;font-size:13px;border:1px solid var(--hairline-strong);width:100%;background:#fff;border-radius:2px;box-sizing:border-box;`;
      const f = folderToEdit || {};
      const isEdit = !!folderToEdit;
      const html = `
        <div class="modal-head">
          <h3>${isEdit ? 'Éditer le dossier' : 'Nouveau dossier'}</h3>
          <button class="modal-close" type="button" data-close>&times;</button>
        </div>
        <datalist id="folderKindSuggestions">${FOLDER_KIND_SUGGESTIONS.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
        <div class="folder-row">
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;">
            <div>${lab('Nom')}<input name="name" placeholder="Hiver 2026, Mariage Marie…" value="${esc(f.name||'')}" style="${inp}" autofocus></div>
            <div>${lab('Type')}<input name="kind" list="folderKindSuggestions" placeholder="Saison, Événement…" value="${esc(f.kind||'')}" style="${inp}"></div>
          </div>
          <div style="margin-top:10px;">
            ${lab('Période (optionnelle)')}
            <div style="display:flex;gap:8px;align-items:center;">
              <input name="date_from" type="date" value="${esc(f.date_from||'')}" style="${inp}flex:1;">
              <span style="font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--muted);font-size:13px;">au</span>
              <input name="date_to" type="date" value="${esc(f.date_to||'')}" style="${inp}flex:1;">
            </div>
          </div>
          <div style="margin-top:10px;">
            ${lab('Description')}
            <textarea name="description" rows="3" placeholder="Note pour ce dossier…" style="${inp}font-family:'Cormorant Garamond',serif;font-style:italic;resize:vertical;">${esc(f.description||'')}</textarea>
          </div>
          <div style="display:flex;gap:8px;margin-top:16px;justify-content:space-between;align-items:center;">
            ${isEdit ? `<button class="btn btn-ghost btn-sm btn-danger" type="button" data-act="del">Supprimer</button>` : '<span></span>'}
            <div style="display:flex;gap:8px;">
              <button class="btn btn-ghost btn-sm" type="button" data-close>Annuler</button>
              <button class="btn btn-sm" type="button" data-act="${isEdit ? 'save' : 'create'}">${isEdit ? 'Enregistrer' : 'Créer le dossier'}</button>
            </div>
          </div>
        </div>`;
      const { wrap, close } = openModal(html);
      const row = wrap.querySelector('.folder-row');
      const readVals = () => ({
        name: row.querySelector('[name=name]').value.trim(),
        kind: row.querySelector('[name=kind]').value || null,
        date_from: row.querySelector('[name=date_from]').value || null,
        date_to: row.querySelector('[name=date_to]').value || null,
        description: row.querySelector('[name=description]').value || null,
      });
      row.querySelector('[data-act=create]')?.addEventListener('click', async () => {
        const v = readVals(); if (!v.name) { toast('Nom requis.'); return; }
        await api(`/api/clients/${activeClient.id}/folders`, { method: 'POST', body: v });
        await reloadFolders(); close(); toast('Dossier créé.');
      });
      row.querySelector('[data-act=save]')?.addEventListener('click', async () => {
        const v = readVals(); if (!v.name) { toast('Nom requis.'); return; }
        await api(`/api/folders/${f.id}`, { method: 'PUT', body: v });
        await reloadFolders(); close(); toast('Enregistré.');
      });
      row.querySelector('[data-act=del]')?.addEventListener('click', async () => {
        if (!await modalConfirm(`Supprimer le dossier "${f.name}" ? Les pièces ne sont pas supprimées.`, { okLabel: 'Supprimer', danger: true })) return;
        await api(`/api/folders/${f.id}`, { method: 'DELETE' });
        await reloadFolders(); close(); toast('Supprimé.');
      });
    }
    function renderFolderPicker(container, selected = new Set(), onChange) {
      if (!container) return;
      if (!folders.length) {
        container.innerHTML = '<span style="font-family:Cormorant Garamond,serif;font-style:italic;color:var(--muted);font-size:12px;">Aucun dossier — créez-en un via "＋ Nouveau dossier" au-dessus.</span>';
        return;
      }
      const render = () => {
        container.innerHTML = folders.map(f => {
          const on = selected.has(f.id);
          return `<button type="button" data-fid="${f.id}" style="font-family:'Cormorant Garamond',serif;font-size:12px;background:${on?'var(--accent)':'#fff'};color:${on?'#fff':'var(--ink)'};border:1px solid ${on?'var(--accent)':'var(--hairline-strong)'};padding:4px 10px;border-radius:12px;cursor:pointer;transition:all .15s;">${on?'✓ ':''}${esc(f.name)}</button>`;
        }).join('');
        container.querySelectorAll('[data-fid]').forEach(b => b.addEventListener('click', () => {
          const id = +b.dataset.fid;
          if (selected.has(id)) selected.delete(id); else selected.add(id);
          render(); onChange?.([...selected]);
        }));
      };
      render();
    }
    function renderFolderBar() {
      const bar = $('#folderBar'); if (!bar) return;
      renderFolderPicker($('#itemFoldersPicker'), new Set(), ids => { const f = $('#itemForm'); if (f) f.dataset.folderIds = JSON.stringify(ids); });
      const allCount = items.length;
      const allTab = `<button class="folder-tab ${activeFolderId == null ? 'active' : ''}" data-fid="">Tous <span style="opacity:.65;font-size:11px;">· ${allCount}</span></button>`;
      const folderTab = f => {
        const on = activeFolderId === f.id;
        const cnt = items.filter(i => (i.folder_ids||[]).includes(f.id)).length;
        return `<span class="folder-tab-wrap" data-fid="${f.id}" style="display:inline-flex;align-items:center;gap:4px;">
          <button class="folder-tab ${on ? 'active' : ''}" data-fid="${f.id}">${esc(f.name)} <span style="opacity:.65;font-size:11px;">· ${cnt}</span></button>
          <button data-edit="${f.id}" title="Éditer le dossier" class="folder-edit-btn"><svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3-9 9H2.5v-3z"/></svg></button>
        </span>`;
      };
      bar.innerHTML = allTab +
        folders.map(folderTab).join('') +
        `<button id="manageFolders" style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:13px;background:transparent;border:1px dashed var(--hairline-strong);padding:6px 12px;border-radius:14px;cursor:pointer;color:var(--ink-soft);transition:all .15s;">＋ Nouveau dossier</button>`;
      bar.querySelectorAll('.folder-tab-wrap').forEach(w => {
        const editBtn = w.querySelector('[data-edit]');
        editBtn.addEventListener('click', e => {
          e.stopPropagation();
          openFolderModal(folders.find(f => f.id === +editBtn.dataset.edit));
        });
      });
      bar.querySelectorAll('button[data-fid]').forEach(b => b.addEventListener('click', () => {
        activeFolderId = b.dataset.fid ? +b.dataset.fid : null;
        renderFolderBar(); renderItemsGrid($('#itemsSearch').value);
      }));
      // Drag-and-drop targets: tab buttons (Tous + chaque dossier)
      bar.querySelectorAll('button[data-fid]').forEach(b => {
        b.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/item-id')) { e.preventDefault(); b.classList.add('drop-hover'); } });
        b.addEventListener('dragleave', () => b.classList.remove('drop-hover'));
        b.addEventListener('drop', async e => {
          e.preventDefault();
          b.classList.remove('drop-hover');
          const itemId = +e.dataTransfer.getData('text/item-id');
          if (!itemId) return;
          const it = items.find(x => x.id === itemId);
          if (!it) return;
          const destFid = b.dataset.fid ? +b.dataset.fid : null;
          let next = new Set(it.folder_ids || []);
          if (activeFolderId != null) next.delete(activeFolderId); // move depuis le dossier courant
          if (destFid != null) next.add(destFid); // sinon "Tous" : retire de l'actuel seulement
          await api(`/api/items/${itemId}/folders`, { method: 'PUT', body: { folder_ids: [...next] } });
          items = await api(`/api/clients/${activeClient.id}/items`);
          renderFolderBar(); renderItemsGrid($('#itemsSearch').value);
          toast(destFid != null ? 'Déplacé.' : 'Retiré du dossier.');
        });
      });
      $('#manageFolders')?.addEventListener('click', () => openFolderModal());
    }
    renderFolderBar();
    renderItemsGrid();
    $('#itemsSearch').addEventListener('input', e => renderItemsGrid(e.target.value));

    // Scrape
    // Affiche le quota restant
    fetch('/api/scrape/quota').then(r => r.json()).then(q => {
      const status = $('#scrapeStatus');
      if (q.plan === 'pro') return;
      status.style.display = 'block';
      status.style.color = 'var(--muted)';
      status.innerHTML = `<em style="font-family:'Cormorant Garamond',serif;font-size:14px;color:var(--ink);">${q.remaining}/${q.limit} imports restants aujourd'hui · <a href="#" id="upgradeLink" style="color:var(--accent);font-weight:600;text-decoration:underline;">Passer en Pro</a></em>`;
      const up = document.getElementById('upgradeLink');
      if (up) up.addEventListener('click', e => { e.preventDefault(); openUpgradeModal(); });
    }).catch(()=>{});

    $('#scrapeBtn').addEventListener('click', async () => {
      const url = $('#scrapeUrl').value.trim();
      if (!url) return;
      const status = $('#scrapeStatus');
      const btn = $('#scrapeBtn'), spin = $('#scrapeSpinner'), lbl = $('#scrapeBtnLabel');
      btn.disabled = true; spin.style.display = 'inline-block'; lbl.textContent = 'Import…';
      const restore = () => { btn.disabled = false; spin.style.display = 'none'; lbl.textContent = 'Importer'; };
      status.style.display = 'block';
      status.style.color = 'var(--muted)';
      status.textContent = 'Récupération en cours…';
      const f0 = $('#itemForm');
      ['brand','name','image','link','description','amount'].forEach(k => { if (f0[k]) f0[k].value = ''; });
      if (f0.cat) f0.cat.value = '';
      const r = await fetch('/api/scrape', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ url })
      });
      const data = await r.json().catch(()=>({}));
      if (r.status === 402) {
        status.style.color = '#b03030';
        status.innerHTML = `${esc(data.message)} <a href="#" id="upgradeLink2" style="color:var(--accent);text-decoration:underline;">Passer en Pro →</a>`;
        document.getElementById('upgradeLink2')?.addEventListener('click', e => { e.preventDefault(); openUpgradeModal(); });
        restore(); return;
      }
      if (!r.ok) {
        status.style.color = '#b03030';
        status.textContent = '✗ ' + (data.error || data.message || 'échec');
        restore(); return;
      }
      const f = $('#itemForm');
      if (data.brand) f.brand.value = data.brand;
      if (data.cat && CATEGORIES.some(c => c.v === data.cat)) f.cat.value = data.cat;
      if (data.name)  f.name.value  = data.name;
      if (data.image) { f.image.value = data.image; imgUrl.value = data.image; if (dropEl._dzSet) dropEl._dzSet(data.image); }
      const thumbs = $('#itemImageThumbs');
      const imgs = Array.isArray(data.images) ? data.images : [];
      if (thumbs) {
        if (imgs.length > 1) {
          const selected = new Set(imgs);
          const refresh = () => {
            const ordered = imgs.filter(u => selected.has(u));
            f.image.value = ordered[0] || '';
            imgUrl.value = ordered[0] || '';
            if (dropEl._dzSet) dropEl._dzSet(ordered[0] || '');
            f.dataset.images = JSON.stringify(ordered);
            thumbs.querySelectorAll('[data-u]').forEach(el => {
              const u = el.dataset.u, on = selected.has(u), prim = on && u === ordered[0];
              el.style.outline = prim ? '2px solid var(--accent)' : '1px solid var(--hairline-strong)';
              el.style.opacity = on ? '1' : '0.55';
              const box = el.querySelector('.thumb-check');
              if (box) {
                box.style.background = on ? 'var(--accent)' : 'rgba(255,255,255,0.92)';
                box.style.borderColor = on ? 'var(--accent)' : 'var(--hairline-strong)';
                box.innerHTML = on ? '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 4.5"/></svg>' : '';
              }
              const star = el.querySelector('.thumb-star');
              if (star) star.style.display = prim ? 'flex' : 'none';
            });
          };
          thumbs.innerHTML = imgs.map(u => `
            <div data-u="${esc(u)}" style="position:relative;width:62px;height:62px;border-radius:2px;overflow:hidden;outline:1px solid var(--hairline-strong);">
              <img src="${esc(u)}" alt="" data-role="primary" style="width:100%;height:100%;object-fit:cover;display:block;cursor:pointer;">
              <span class="thumb-check" data-role="check" style="position:absolute;top:4px;left:4px;width:16px;height:16px;border:1.5px solid var(--hairline-strong);background:rgba(255,255,255,0.92);border-radius:2px;cursor:pointer;display:flex;align-items:center;justify-content:center;"></span>
              <span class="thumb-star" style="position:absolute;top:4px;right:4px;width:16px;height:16px;background:var(--accent);color:#fff;font-size:10px;line-height:1;border-radius:2px;display:none;align-items:center;justify-content:center;">★</span>
            </div>`).join('');
          thumbs.style.display = 'flex';
          thumbs.querySelectorAll('[data-u]').forEach(el => {
            const u = el.dataset.u;
            el.querySelector('[data-role="check"]').addEventListener('click', e => {
              e.stopPropagation();
              if (selected.has(u)) selected.delete(u); else selected.add(u);
              refresh();
            });
            el.querySelector('[data-role="primary"]').addEventListener('click', e => {
              e.stopPropagation();
              selected.add(u);
              imgs.splice(imgs.indexOf(u), 1); imgs.unshift(u);
              refresh();
            });
          });
          refresh();
          const hint = document.createElement('div');
          hint.style.cssText = 'font-size:11px;color:var(--muted);font-style:italic;width:100%;margin-top:4px;';
          hint.textContent = 'Case = inclure/exclure · Clic image = définir comme principale (★)';
          thumbs.appendChild(hint);
        } else { thumbs.style.display = 'none'; thumbs.innerHTML = ''; delete f.dataset.images; }
      }
      if (data.link || url) f.link.value = data.link || url;
      if (data.description) f.description.value = data.description;
      if (data.price) {
        const p = parsePrice(data.price);
        if (CURRENCIES.includes(p.cur)) f.currency.value = p.cur;
        f.amount.value = p.amt;
      }
      status.style.color = 'var(--accent)';
      status.textContent = '✓ Importé. Vérifiez et complétez si besoin.';
      restore();
    });

    function openUpgradeModal() {
      const html = `
        <div class="modal-head">
          <h3>Passer en <em>Pro</em></h3>
          <button class="modal-close" data-close>&times;</button>
        </div>
        <div style="text-align:center;padding:14px 0;">
          <div style="font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--muted);font-size:14px;line-height:1.6;margin-bottom:18px;">
            La version gratuite vous donne 30 imports / jour.<br>
            Le plan Pro vous offre des imports illimités, des sites e-commerce protégés (Zalando, H&M, Zara…) débloqués via ScrapingBee, et le support prioritaire.
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:24px 0;">
            <div style="border:1px solid var(--hairline);padding:18px;border-radius:4px;">
              <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:var(--muted);">Gratuit</div>
              <div style="font-family:'Cormorant Garamond',serif;font-size:28px;margin-top:6px;">€0</div>
              <div style="font-size:12px;color:var(--muted);font-style:italic;margin-top:4px;">/mois</div>
              <ul style="text-align:left;margin-top:14px;padding:0;list-style:none;font-size:13px;color:var(--ink-soft);">
                <li>✓ 30 imports / jour</li>
                <li>✓ Sites OG-friendly</li>
                <li>—</li>
              </ul>
            </div>
            <div style="border:1.5px solid var(--accent);padding:18px;border-radius:4px;background:rgba(184,145,90,0.05);">
              <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:var(--accent);font-weight:600;">Pro ★</div>
              <div style="font-family:'Cormorant Garamond',serif;font-size:28px;margin-top:6px;">€29</div>
              <div style="font-size:12px;color:var(--muted);font-style:italic;margin-top:4px;">/mois</div>
              <ul style="text-align:left;margin-top:14px;padding:0;list-style:none;font-size:13px;color:var(--ink-soft);">
                <li>✓ Imports illimités</li>
                <li>✓ Tous les sites (anti-bot)</li>
                <li>✓ Support prioritaire</li>
              </ul>
            </div>
          </div>
          <button class="btn" id="checkoutBtn" style="width:100%;">Démarrer mon essai Pro</button>
          <div style="font-size:11px;color:var(--muted);font-style:italic;margin-top:10px;">Paiement Stripe — à brancher prochainement.</div>
        </div>`;
      const { wrap, close } = openModal(html);
      wrap.querySelector('#checkoutBtn').addEventListener('click', () => {
        toast('Paiement Stripe non encore configuré — ajoute STRIPE_KEY pour activer.');
      });
    }

    $('#itemForm').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      let images = [];
      try { images = JSON.parse(e.target.dataset.images || '[]'); } catch {}
      if (!images.length && fd.image) images = [fd.image];
      const body = {
        cat: fd.cat, brand: fd.brand, name: fd.name,
        price: formatPrice(fd.currency, fd.amount),
        link: fd.link, image: fd.image, images, description: fd.description
      };
      const newItem = await api(`/api/clients/${activeClient.id}/items`, { method: 'POST', body });
      let folderIds = [];
      try { folderIds = JSON.parse(e.target.dataset.folderIds || '[]'); } catch {}
      if (newItem?.id && folderIds.length) {
        await api(`/api/items/${newItem.id}/folders`, { method: 'PUT', body: { folder_ids: folderIds } });
      }
      items = await api(`/api/clients/${activeClient.id}/items`);
      await loadClients();
      activeClient = clients.find(c => c.id === activeClient.id);
      renderMain();
      toast('Pièce ajoutée.');
    });
  }

  /* ────────── Modale d'édition d'une pièce ────────── */
  function openItemModal(it) {
    const { cur, amt } = parsePrice(it.price);
    const html = `
      <div class="modal-overlay" id="itemModalWrap">
        <div class="modal">
          <div class="modal-head">
            <h3>Éditer la <em>pièce</em></h3>
            <button class="modal-close" type="button" data-close>&times;</button>
          </div>
          <form id="editItemForm">
            <div class="form-row">
              <div class="field"><label>Catégorie</label>
                <select name="cat" required>${catOptions(it.cat || '')}</select>
              </div>
              <div class="field"><label>Marque</label><input name="brand" value="${esc(it.brand||'')}"></div>
            </div>
            <div class="form-row" style="margin-top:12px;">
              <div class="field"><label>Nom du produit</label><input name="name" value="${esc(it.name||'')}" required></div>
              <div class="field"><label>Prix</label>
                <div class="price-group">
                  <select name="currency">${currencyOptions(cur)}</select>
                  <input name="amount" value="${esc(amt)}" placeholder="120">
                </div>
              </div>
            </div>
            <div class="field" style="margin-top:12px;"><label>Lien (URL produit)</label><input name="link" type="url" value="${esc(it.link||'')}"></div>
            <div class="field" style="margin-top:12px;">
              <label>Image</label>
              <input name="image" type="hidden" value="${esc(it.image||'')}" id="imgInput">
              <div id="imgDrop"></div>
              <input id="imgUrlInput" type="url" placeholder="…ou collez une URL" value="${esc(it.image||'')}" style="margin-top:6px;background:transparent;border:none;border-bottom:1px dotted var(--hairline-strong);font-size:12px;color:var(--muted);padding:6px 0;">
            </div>
            <div class="field" style="margin-top:12px;"><label>Description</label><textarea name="description" rows="3">${esc(it.description||'')}</textarea></div>
            <div class="field" style="margin-top:12px;"><label>Dossiers</label><div id="editItemFoldersPicker" style="display:flex;flex-wrap:wrap;gap:6px;"></div></div>
            <div class="modal-foot">
              <button type="button" class="btn btn-ghost" data-close>Annuler</button>
              <button type="submit" class="btn">Enregistrer</button>
            </div>
          </form>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const wrap = $('#itemModalWrap');
    requestAnimationFrame(() => wrap.classList.add('open'));
    const close = () => { wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 200); };
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    document.addEventListener('keydown', function escClose(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); }
    });

    // Drop zone image édition
    const imgInput = wrap.querySelector('#imgInput');
    const imgDrop = wrap.querySelector('#imgDrop');
    const imgUrlInput = wrap.querySelector('#imgUrlInput');
    attachDropZone(imgDrop, imgInput);
    imgUrlInput.addEventListener('input', () => {
      imgInput.value = imgUrlInput.value;
      if (imgDrop._dzSet) imgDrop._dzSet(imgUrlInput.value);
    });

    let editFolderIds = new Set(it.folder_ids || []);
    renderFolderPicker(wrap.querySelector('#editItemFoldersPicker'), editFolderIds, ids => { editFolderIds = new Set(ids); });

    $('#editItemForm').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      const body = {
        cat: fd.cat, brand: fd.brand, name: fd.name,
        price: formatPrice(fd.currency, fd.amount),
        link: fd.link, image: fd.image, description: fd.description
      };
      await api(`/api/items/${it.id}`, { method: 'PUT', body });
      await api(`/api/items/${it.id}/folders`, { method: 'PUT', body: { folder_ids: [...editFolderIds] } });
      items = await api(`/api/clients/${activeClient.id}/items`);
      close();
      renderMain();
      toast('Pièce modifiée.');
    });
  }

  /* ────────── Inspirations tab ────────── */
  function renderMoodboardTab() {
    const html = `
      <div class="panel">
        <div class="panel-head">
          <h3>Moodboard du client (<span>${clientMoodboard.length}</span>)</h3>
        </div>
        <p style="font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--ink-soft);font-size:14px;line-height:1.5;margin-bottom:18px;max-width:640px;">
          Ce que ${esc(activeClient.name)} a déposé comme inspirations — utilisez-les pour affiner la sélection.
        </p>
        ${clientMoodboard.length ? `
          <div class="adm-items" id="mbAdmGrid">
            ${clientMoodboard.map(m => `
              <div class="adm-item" data-mid="${m.id}">
                <div class="ai-thumb"><img src="${esc(m.image_url)}" alt="" onerror="this.parentElement.classList.add('placeholder');this.remove();"></div>
                ${m.caption ? `<div class="ai-name" style="font-style:italic;color:var(--ink-soft);font-size:12px;word-break:break-all;">${esc(m.caption)}</div>` : ''}
                <div class="ai-meta">${m.created_at ? new Date(m.created_at).toLocaleDateString('fr-FR') : ''}</div>
                <div class="ai-actions">
                  <button class="btn btn-ghost btn-sm btn-danger" data-mb-del="${m.id}">×</button>
                </div>
              </div>`).join('')}
          </div>
        ` : `
          <div style="grid-column:1/-1;font-family:Cormorant Garamond,serif;font-style:italic;color:var(--muted);padding:40px;text-align:center;">
            Le client n'a encore rien ajouté à son moodboard.
          </div>
        `}
      </div>`;
    $('#tabBody').innerHTML = html;
    $('#tabBody').querySelectorAll('[data-mb-del]').forEach(b => b.addEventListener('click', async () => {
      const mid = +b.dataset.mbDel;
      if (!await modalConfirm('Retirer cette image du moodboard du client ?', { okLabel: 'Retirer', danger: true })) return;
      await api(`/api/clients/${activeClient.id}/moodboard/${mid}`, { method: 'DELETE' });
      clientMoodboard = clientMoodboard.filter(m => m.id !== mid);
      renderMain();
    }));
  }

  function renderInspirationsTab() {
    $('#tabBody').innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>Créer une inspiration</h3></div>
        <form id="inspForm">
          <div class="form-row">
            <div class="field"><label>Titre</label><input name="title" placeholder="ex: Smart casual hiver" required></div>
            <div class="field" style="grid-column:span 2">
              <label>Image principale (le look complet)</label>
              <input name="main_image" type="hidden" id="inspMainInput">
              <div id="inspMainDrop"></div>
              <input id="inspMainUrl" type="url" placeholder="…ou collez une URL" style="margin-top:6px;background:transparent;border:none;border-bottom:1px dotted var(--hairline-strong);font-size:12px;color:var(--muted);padding:6px 0;width:100%;">
            </div>
          </div>
          <div style="margin-top:14px;"><button class="btn" type="submit">Créer</button></div>
        </form>
      </div>

      <div id="inspList"></div>
    `;

    const inspMainInput = $('#inspMainInput');
    const inspMainDrop  = $('#inspMainDrop');
    const inspMainUrl   = $('#inspMainUrl');
    attachDropZone(inspMainDrop, inspMainInput);
    inspMainUrl.addEventListener('input', () => {
      inspMainInput.value = inspMainUrl.value;
      if (inspMainDrop._dzSet) inspMainDrop._dzSet(inspMainUrl.value);
    });

    $('#inspForm').addEventListener('submit', async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      await api(`/api/clients/${activeClient.id}/inspirations`, { method: 'POST', body });
      inspirations = await api(`/api/clients/${activeClient.id}/inspirations`);
      await loadClients();
      renderMain();
      toast('Inspiration créée.');
    });

    const list = $('#inspList');
    if (!inspirations.length) {
      list.innerHTML = '<div class="empty" style="margin-top:20px;"><div class="e-sub">Aucune inspiration encore.</div></div>';
      return;
    }
    inspirations.forEach(ins => list.appendChild(renderInspEditor(ins)));
  }

  function renderInspEditor(ins) {
    const root = document.createElement('div');
    root.className = 'panel insp-panel collapsed';
    root.innerHTML = `
      <div class="panel-head insp-head" style="cursor:pointer;">
        <h3 style="display:flex;align-items:center;gap:8px;">
          <svg class="insp-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition:transform .2s;"><path d="M9 18l6-6-6-6"/></svg>
          ${esc(ins.title)}
          <span style="font-size:11px;color:var(--muted);font-family:Inter;">· ${ins.pieces.length} pièce${ins.pieces.length>1?'s':''}</span>
          ${ins.is_template ? '<span style="font-size:10px;letter-spacing:0.16em;color:var(--accent);background:rgba(184,145,90,0.12);padding:3px 8px;text-transform:uppercase;border-radius:2px;">Template</span>' : ''}
        </h3>
        <div class="actions">
          <button class="btn btn-ghost btn-sm" data-act="duplicate">Dupliquer</button>
          <button class="btn btn-ghost btn-sm" data-act="template">${ins.is_template?'Retirer du template':'Marquer comme template'}</button>
          <button class="btn btn-ghost btn-sm" data-act="heatmap">Heatmap</button>
          <button class="btn btn-ghost btn-sm" data-act="rename">Renommer</button>
          <button class="btn btn-ghost btn-sm btn-danger" data-act="del">Supprimer</button>
        </div>
      </div>

      <div class="insp-body">
      <div class="form-row">
        <div class="field" style="grid-column:span 4">
          <label>Image principale du look</label>
          <input class="main-img-input" type="hidden" value="${esc(ins.main_image || '')}">
          <div class="main-img-drop"></div>
          <input class="main-img-url" type="url" value="${esc(ins.main_image || '')}" placeholder="…ou collez une URL" style="margin-top:6px;background:transparent;border:none;border-bottom:1px dotted var(--hairline-strong);font-size:12px;color:var(--muted);padding:6px 0;">
        </div>
      </div>

      <div style="margin-top:16px;">
        <div style="font-family:Cormorant Garamond,serif;font-style:italic;color:rgba(243,234,208,0.6);font-size:13px;margin-bottom:6px;">
          Cliquez sur l'image pour ajouter un point · Glissez un point pour le repositionner.
        </div>
        <div class="anchor-edit ${ins.main_image ? '' : 'placeholder'}">
          ${ins.main_image ? `<img src="${esc(ins.main_image)}" alt="">` : ''}
        </div>
      </div>

      <div class="pieces-list" style="margin-top:14px;display:flex;flex-direction:column;gap:14px;"></div>
      </div>
    `;

    // Accordéon : clic sur l'en-tête (hors boutons) ouvre ce panneau et ferme les autres
    const head = root.querySelector('.insp-head');
    head.addEventListener('click', e => {
      if (e.target.closest('.actions')) return;
      const willOpen = root.classList.contains('collapsed');
      document.querySelectorAll('.insp-panel').forEach(p => p.classList.add('collapsed'));
      if (willOpen) root.classList.remove('collapsed');
    });

    const inputImg = root.querySelector('.main-img-input');
    const mainDrop = root.querySelector('.main-img-drop');
    const mainUrl = root.querySelector('.main-img-url');
    const ae = root.querySelector('.anchor-edit');
    const piecesList = root.querySelector('.pieces-list');
    let selectedPieceId = ins.pieces[0]?.id || null;

    // Drop zone image principale du look — auto-save dès qu'une image est définie
    attachDropZone(mainDrop, inputImg);
    let lastSavedImage = inputImg.value;
    async function saveMainImage(url) {
      await api(`/api/inspirations/${ins.id}`, { method: 'PUT', body: { main_image: url } });
      ins.main_image = url;
      lastSavedImage = url;
      ae.classList.toggle('placeholder', !url);
      let img = ae.querySelector('img');
      if (url) {
        if (!img) { img = document.createElement('img'); ae.prepend(img); }
        img.src = url;
      } else if (img) img.remove();
      refreshDots();
      toast('Image mise à jour.');
    }
    mainUrl.addEventListener('input', () => {
      inputImg.value = mainUrl.value;
      if (mainDrop._dzSet) mainDrop._dzSet(mainUrl.value);
    });
    inputImg.addEventListener('input', () => {
      if (inputImg.value !== lastSavedImage) saveMainImage(inputImg.value);
    });
    // Quand drop ou upload se fait, _dzSet appelle setUrl qui change inputImg.value mais ne déclenche pas 'input' natif.
    // Solution : observer inputImg via un wrapper. attachDropZone dispatch 'input' déjà → ok.

    function refreshDots() {
      ae.querySelectorAll('.ae-dot').forEach(d => d.remove());
      ins.pieces.forEach((p, i) => {
        const dot = document.createElement('div');
        dot.className = 'ae-dot';
        dot.style.left = p.anchor_x + '%';
        dot.style.top  = p.anchor_y + '%';
        dot.textContent = i + 1;
        dot.dataset.id = p.id;
        dot.title = p.label || '';
        dot.style.cursor = 'grab';
        if (p.id === selectedPieceId) dot.classList.add('selected');
        // Hover sync
        dot.addEventListener('mouseenter', () => {
          piecesList.querySelector(`[data-piece-id="${p.id}"]`)?.classList.add('hovered-from-dot');
        });
        dot.addEventListener('mouseleave', () => {
          piecesList.querySelector(`[data-piece-id="${p.id}"]`)?.classList.remove('hovered-from-dot');
        });
        // Drag pour repositionner
        let dragging = false, startX = 0, startY = 0;
        dot.addEventListener('mousedown', e => {
          e.stopPropagation();
          dragging = true; startX = e.clientX; startY = e.clientY;
          dot.style.cursor = 'grabbing';
          selectedPieceId = p.id; refreshDots(); refreshPieces();
          const onMove = ev => {
            if (!dragging) return;
            const r = ae.getBoundingClientRect();
            const x = Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100));
            const y = Math.max(0, Math.min(100, ((ev.clientY - r.top)  / r.height) * 100));
            dot.style.left = x + '%'; dot.style.top = y + '%';
            p.anchor_x = x; p.anchor_y = y;
          };
          const onUp = async ev => {
            if (!dragging) return;
            dragging = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            dot.style.cursor = 'grab';
            // Si déplacement minime → juste sélection
            const moved = Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 4;
            if (moved) {
              await api(`/api/pieces/${p.id}`, { method: 'PUT', body: { anchor_x: p.anchor_x, anchor_y: p.anchor_y } });
            }
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
        ae.appendChild(dot);
      });
    }

    // Clic sur image (pas sur un dot) = créer une nouvelle pièce à cette position
    ae.addEventListener('click', async (e) => {
      if (e.target.classList.contains('ae-dot') || e.target.closest('.ae-dot')) return;
      if (!ins.main_image) return;
      const r = ae.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width)  * 100;
      const y = ((e.clientY - r.top)  / r.height) * 100;
      // Popover inline pour saisir le label
      const pop = document.createElement('div');
      pop.className = 'ae-quick-add';
      pop.style.cssText = `position:absolute;left:${x}%;top:${y}%;transform:translate(-50%,-130%);background:#fff;border:1px solid var(--ink);padding:6px;display:flex;gap:4px;z-index:50;box-shadow:0 6px 22px rgba(0,0,0,0.18);border-radius:2px;`;
      pop.innerHTML = `<input type="text" placeholder="Pièce (ex. Veste)" style="border:none;outline:none;font-size:13px;padding:4px 6px;width:140px;font-family:'Inter',sans-serif;"><button type="button" style="background:var(--ink);color:#fff;border:none;padding:4px 10px;font-size:11px;cursor:pointer;letter-spacing:0.04em;">Ajouter</button>`;
      ae.appendChild(pop);
      const input = pop.querySelector('input');
      const btn = pop.querySelector('button');
      input.focus();
      const submit = async () => {
        const label = input.value.trim();
        if (!label) { pop.remove(); return; }
        const p = await api(`/api/inspirations/${ins.id}/pieces`, {
          method: 'POST', body: { label, anchor_x: x, anchor_y: y }
        });
        p.refs = [];
        ins.pieces.push(p);
        selectedPieceId = p.id;
        pop.remove();
        refreshDots(); refreshPieces();
      };
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        if (e.key === 'Escape') pop.remove();
      });
      // Click outside pour fermer
      setTimeout(() => {
        const closeOnOutside = ev => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', closeOnOutside); } };
        document.addEventListener('click', closeOnOutside);
      }, 0);
    });

    root.querySelector('[data-act="del"]').addEventListener('click', async () => {
      const ok = await modalConfirm(`Supprimer l'inspiration « ${ins.title} » ?`, { okLabel: 'Supprimer', danger: true });
      if (!ok) return;
      await api(`/api/inspirations/${ins.id}`, { method: 'DELETE' });
      inspirations = inspirations.filter(x => x.id !== ins.id);
      await loadClients(); renderMain(); toast('Supprimée.');
    });
    root.querySelector('[data-act="rename"]').addEventListener('click', async () => {
      const d = await modalForm('Renommer l\'inspiration', [
        { name: 'title', label: 'Titre', value: ins.title, required: true }
      ]);
      if (!d || !d.title) return;
      await api(`/api/inspirations/${ins.id}`, { method: 'PUT', body: { title: d.title } });
      ins.title = d.title;
      root.querySelector('.panel-head h3').firstChild.textContent = d.title + ' ';
      toast('Titre modifié.');
    });
    root.querySelector('[data-act="template"]').addEventListener('click', async () => {
      const next = !ins.is_template;
      await api(`/api/inspirations/${ins.id}/template`, { method: 'PUT', body: { is_template: next } });
      ins.is_template = next;
      toast(next ? '✓ Ajouté à la bibliothèque de templates.' : 'Retiré des templates.');
      renderMain();
    });
    root.querySelector('[data-act="heatmap"]').addEventListener('click', () => openHeatmap(ins));
    root.querySelector('[data-act="duplicate"]').addEventListener('click', async () => {
      await api(`/api/inspirations/${ins.id}/duplicate`, { method: 'POST' });
      inspirations = await api(`/api/clients/${activeClient.id}/inspirations`);
      renderMain();
      toast('Inspiration dupliquée.');
    });

    function refreshPieces() {
      piecesList.innerHTML = '';
      ins.pieces.forEach((p, i) => piecesList.appendChild(renderPieceEditor(ins, p, i)));
    }

    function renderPieceEditor(ins, p, i) {
      const el = document.createElement('div');
      el.dataset.pieceId = p.id;
      el.style.cssText = 'background:rgba(243,234,208,0.04);border:1px solid var(--hairline-light);padding:14px;transition:border-color .2s,background .2s;';
      if (p.id === selectedPieceId) el.style.borderColor = 'var(--cream)';
      el.addEventListener('mouseenter', () => {
        ae.querySelector(`.ae-dot[data-id="${p.id}"]`)?.classList.add('hovered-from-card');
      });
      el.addEventListener('mouseleave', () => {
        ae.querySelector(`.ae-dot[data-id="${p.id}"]`)?.classList.remove('hovered-from-card');
      });
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="font-family:Cormorant Garamond,serif;font-size:16px;">
            <span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:var(--accent);color:var(--ink);font-family:Inter;font-size:11px;font-weight:600;display:inline-grid;place-items:center;margin-right:8px;vertical-align:middle;">${i+1}</span>
            ${esc(p.label)}
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-sm" data-act="select">${p.id === selectedPieceId ? '✓ Sélectionnée' : 'Sélectionner'}</button>
            <button class="btn btn-ghost btn-sm" data-act="renameP">Renommer</button>
            <button class="btn btn-ghost btn-sm btn-danger" data-act="delP">Suppr.</button>
          </div>
        </div>

        <form class="add-ref-form" style="margin-top:12px;">
          <div class="form-row">
            <div class="field"><label>Marque</label><input name="brand"></div>
            <div class="field"><label>Nom</label><input name="name"></div>
            <div class="field"><label>Lien</label><input name="link" type="url"></div>
            <div class="field">
              <label>Image</label>
              <input name="image" type="hidden">
              <div class="ref-drop"></div>
              <input type="url" class="ref-url" placeholder="…ou URL" style="margin-top:4px;background:transparent;border:none;border-bottom:1px dotted var(--hairline-strong);font-size:11px;color:var(--muted);padding:4px 0;">
            </div>
          </div>
          <div style="margin-top:10px;"><button class="btn btn-sm" type="submit">+ Ajouter une référence</button></div>
        </form>

        <div class="refs-list"></div>
      `;
      const refsList = el.querySelector('.refs-list');

      function refreshRefs() {
        refsList.innerHTML = p.refs.map(r => `
          <div class="ref-item" data-id="${r.id}">
            <div class="ri-img">${r.image ? `<img src="${esc(r.image)}" alt="">` : ''}</div>
            <div class="ri-text">
              <span class="b">${esc(r.brand || '—')}</span>
              <span class="n">${esc(r.name || '')}</span>
              ${r.link ? `<a class="n" style="color:var(--accent);font-style:italic;" href="${esc(r.link)}" target="_blank">Voir →</a>` : ''}
            </div>
            <button class="btn btn-ghost btn-sm btn-danger" data-act="delR">×</button>
          </div>
        `).join('');
        refsList.querySelectorAll('.ref-item').forEach(item => {
          const rid = +item.dataset.id;
          item.querySelector('[data-act="delR"]').addEventListener('click', async () => {
            await api(`/api/refs/${rid}`, { method: 'DELETE' });
            p.refs = p.refs.filter(x => x.id !== rid);
            refreshRefs();
          });
        });
      }
      refreshRefs();

      el.querySelector('[data-act="select"]').addEventListener('click', () => {
        selectedPieceId = p.id; refreshDots(); refreshPieces();
      });
      el.querySelector('[data-act="renameP"]').addEventListener('click', async () => {
        const d = await modalForm('Renommer la pièce', [
          { name: 'label', label: 'Label (ex: Veste, Pantalon…)', value: p.label, required: true }
        ]);
        if (!d || !d.label) return;
        await api(`/api/pieces/${p.id}`, { method: 'PUT', body: { label: d.label } });
        p.label = d.label; refreshPieces();
        toast('Label modifié.');
      });
      el.querySelector('[data-act="delP"]').addEventListener('click', async () => {
        const ok = await modalConfirm(`Supprimer la pièce « ${p.label} » et toutes ses références ?`, { okLabel: 'Supprimer', danger: true });
        if (!ok) return;
        await api(`/api/pieces/${p.id}`, { method: 'DELETE' });
        ins.pieces = ins.pieces.filter(x => x.id !== p.id);
        if (selectedPieceId === p.id) selectedPieceId = ins.pieces[0]?.id || null;
        refreshDots(); refreshPieces();
      });
      // Drop zone pour l'image de référence
      const refForm = el.querySelector('.add-ref-form');
      const refImg = refForm.querySelector('input[name=image]');
      const refDrop = refForm.querySelector('.ref-drop');
      const refUrl = refForm.querySelector('.ref-url');
      attachDropZone(refDrop, refImg);
      refUrl.addEventListener('input', () => {
        refImg.value = refUrl.value;
        if (refDrop._dzSet) refDrop._dzSet(refUrl.value);
      });

      refForm.addEventListener('submit', async e => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target).entries());
        const r = await api(`/api/pieces/${p.id}/refs`, { method: 'POST', body });
        p.refs.push(r);
        e.target.reset();
        if (refDrop._dzSet) refDrop._dzSet('');
        refUrl.value = '';
        refreshRefs();
        toast('Référence ajoutée.');
      });

      return el;
    }

    refreshDots(); refreshPieces();
    return root;
  }

  /* ────────── Profil client (mensurations + préférences) ────────── */
  const PROFILE_FIELDS = {
    measurements: [
      { k: 'height',      l: 'Taille (cm)',         t: 'number' },
      { k: 'weight',      l: 'Poids (kg)',          t: 'number' },
      { k: 'chest',       l: 'Tour de poitrine',    t: 'number' },
      { k: 'waist',       l: 'Tour de taille',      t: 'number' },
      { k: 'hips',        l: 'Tour de hanches',     t: 'number' },
      { k: 'inseam',      l: 'Entrejambe',          t: 'number' },
      { k: 'shoulder',    l: 'Largeur épaules',     t: 'number' },
      { k: 'neck',        l: 'Tour de cou',         t: 'number' },
    ],
    sizes: [
      { k: 'size_top',    l: 'Taille haut',         t: 'text', placeholder: '3XL' },
      { k: 'size_bottom', l: 'Taille bas',          t: 'text', placeholder: '46' },
      { k: 'shoe',        l: 'Pointure',            t: 'text', placeholder: '45' },
    ],
    style: [
      { k: 'styles',      l: 'Style(s) préféré(s)', t: 'text', placeholder: 'smart casual, street, classique…' },
      { k: 'occasions',   l: 'Occasions',           t: 'text', placeholder: 'bureau, sport, sorties…' },
      { k: 'fav_brands',  l: 'Marques favorites',   t: 'text' },
      { k: 'avoid_brands',l: 'Marques à éviter',    t: 'text' },
      { k: 'fav_colors',  l: 'Couleurs favorites',  t: 'text' },
      { k: 'avoid_colors',l: 'Couleurs à éviter',   t: 'text' },
      { k: 'materials_avoid', l: 'Matières à éviter', t: 'text', placeholder: 'laine, synthétique…' },
    ],
    budget: [
      { k: 'budget_min',  l: 'Budget min / pièce',  t: 'number' },
      { k: 'budget_max',  l: 'Budget max / pièce',  t: 'number' },
      { k: 'currency',    l: 'Devise',              t: 'text', placeholder: 'CHF' },
    ],
    other: [
      { k: 'notes',       l: 'Notes libres',        textarea: true, rows: 4 },
    ]
  };

  async function openProfileEditor(client) {
    const data = await api(`/api/clients/${client.id}/profile`);
    const p = data.profile || {};
    const renderSection = (title, fields) => `
      <h4 style="font-family:'Cormorant Garamond',serif;font-weight:400;font-size:18px;margin:18px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--hairline);">${title}</h4>
      <div class="form-row">
        ${fields.map(f => `
          <div class="field">
            <label>${esc(f.l)}</label>
            ${f.textarea
              ? `<textarea name="${f.k}" rows="${f.rows||3}" placeholder="${esc(f.placeholder||'')}">${esc(p[f.k]||'')}</textarea>`
              : `<input name="${f.k}" type="${f.t}" value="${esc(p[f.k]||'')}" placeholder="${esc(f.placeholder||'')}">`
            }
          </div>`).join('')}
      </div>`;

    const html = `
      <div class="modal-head">
        <h3>Profil de <em>${esc(client.name)}</em></h3>
        <button class="modal-close" type="button" data-close>&times;</button>
      </div>
      <div style="font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--muted);font-size:13px;margin-bottom:8px;">
        ${data.filled_by === 'client'
          ? 'Rempli par le client via le questionnaire.'
          : data.filled_by === 'shopper'
            ? 'Rempli par vous — le client n\'a pas besoin du questionnaire.'
            : 'Non renseigné. Vous pouvez le compléter pour éviter le questionnaire client.'}
      </div>
      <form id="profileForm">
        <div class="field"><label>Message d'accueil sur la page du client</label>
          <textarea name="welcome_message" rows="2" placeholder="Quelques mots pour accueillir votre client…">${esc(data.welcome_message||'')}</textarea>
        </div>
        <div class="field" style="margin-top:12px;"><label>Photo du client (visible dans le portfolio + utilisée pour le try-on)</label>
          <input name="photo_url" type="hidden" value="${esc(data.photo_url||'')}" id="profilePhotoInput">
          <div id="profilePhotoDrop"></div>
          <input id="profilePhotoUrl" type="url" value="${esc(data.photo_url||'')}" placeholder="…ou collez une URL" style="margin-top:6px;background:transparent;border:none;border-bottom:1px dotted var(--hairline-strong);font-size:12px;color:var(--muted);padding:6px 0;">
        </div>
        ${renderSection('Mensurations', PROFILE_FIELDS.measurements)}
        ${renderSection('Tailles habituelles', PROFILE_FIELDS.sizes)}
        ${renderSection('Style & préférences', PROFILE_FIELDS.style)}
        ${renderSection('Budget', PROFILE_FIELDS.budget)}
        ${renderSection('Notes', PROFILE_FIELDS.other)}
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-close>Fermer</button>
          <button type="submit" class="btn">Enregistrer le profil</button>
        </div>
      </form>`;

    const { wrap, close } = openModal(html);
    // Drop zone pour photo client
    const ppInput = wrap.querySelector('#profilePhotoInput');
    const ppDrop = wrap.querySelector('#profilePhotoDrop');
    const ppUrl = wrap.querySelector('#profilePhotoUrl');
    attachDropZone(ppDrop, ppInput);
    ppUrl.addEventListener('input', () => {
      ppInput.value = ppUrl.value;
      if (ppDrop._dzSet) ppDrop._dzSet(ppUrl.value);
    });

    wrap.querySelector('#profileForm').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      const profile = {};
      for (const section of Object.values(PROFILE_FIELDS))
        for (const f of section) if (fd[f.k]) profile[f.k] = fd[f.k];
      await api(`/api/clients/${client.id}`, { method: 'PUT', body: {
        welcome_message: fd.welcome_message,
        photo_url: fd.photo_url
      }});
      await api(`/api/clients/${client.id}/profile`, { method: 'PUT', body: { profile }});
      close();
      toast('Profil enregistré.');
    });
  }

  /* ────────── Try-on virtuel ────────── */
  async function openTryonStudio(client) {
    const data = await api(`/api/clients/${client.id}/profile`);
    const garments = items.filter(i => i.image);
    const html = `
      <div class="modal-head">
        <h3>Essayage <em>virtuel</em></h3>
        <button class="modal-close" type="button" data-close>&times;</button>
      </div>
      <div style="font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--muted);font-size:13px;margin-bottom:14px;">
        Superpose une pièce sur la photo du client via Replicate IDM-VTON.
        ${process.env?.REPLICATE_API_TOKEN ? '' : '<br><strong>Service non configuré côté serveur.</strong> Définir <code>REPLICATE_API_TOKEN</code> au démarrage.'}
      </div>
      <form id="tryonForm">
        <div class="field"><label>Photo du client (URL)</label>
          <input name="human_url" type="url" value="${esc(data.photo_url||'')}" placeholder="https://…" required>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;font-style:italic;">Photo plein corps, vue de face, fond neutre.</div>
        </div>
        <div class="field" style="margin-top:14px;"><label>Pièce à essayer</label>
          <select name="item_id" required>
            <option value="">— Choisir une pièce de la sélection —</option>
            ${garments.map(i => `<option value="${i.id}">${esc(i.brand || '')} — ${esc(i.name || '')}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="margin-top:14px;"><label>Description courte (aide l'IA)</label>
          <input name="category" value="" placeholder="ex: a white t-shirt">
        </div>
        <div id="tryonResult" style="margin-top:18px;display:none;text-align:center;"></div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-close>Fermer</button>
          <button type="submit" class="btn">Lancer l'essayage</button>
        </div>
      </form>`;
    const { wrap, close } = openModal(html);
    wrap.querySelector('#tryonForm').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      const item = items.find(x => x.id == fd.item_id);
      if (!item || !item.image) { toast('Sélection invalide.'); return; }
      const out = wrap.querySelector('#tryonResult');
      out.style.display = 'block';
      out.innerHTML = `<div style="padding:30px;font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--muted);">Génération en cours (peut prendre 30-60s)…</div>`;
      try {
        const r = await api('/api/tryon', { method: 'POST', body: {
          human_url: fd.human_url,
          garment_url: item.image,
          category: fd.category || `${item.cat || 'a garment'}`
        }});
        out.innerHTML = `<img src="${esc(r.image)}" alt="" style="max-width:100%;border:1px solid var(--hairline);">`;
      } catch (err) {
        out.innerHTML = `<div style="padding:24px;color:#b03030;font-size:13px;">${esc(err.message || 'Erreur')}</div>`;
      }
    });
  }

  /* ────────── CRM ────────── */
  async function openCrmEditor(client) {
    const c = await api(`/api/clients`).then(arr => arr.find(x => x.id === client.id));
    const d = await modalForm('Suivi CRM', [
      { name: 'status', label: 'Statut', value: c.status || 'active', placeholder: 'active, dormant, prospect, archived' },
      { name: 'birthday', label: 'Anniversaire (AAAA-MM-JJ)', value: c.birthday || '', placeholder: '1990-06-15' },
      { name: 'last_contact_at', label: 'Dernier contact (AAAA-MM-JJ)', value: (c.last_contact_at||'').slice(0,10) },
      { name: 'next_action', label: 'Prochaine action', value: c.next_action || '', placeholder: 'Relance pour la collection automne…' },
      { name: 'next_action_at', label: 'Date prochaine action (AAAA-MM-JJ)', value: (c.next_action_at||'').slice(0,10) },
    ], 'Enregistrer');
    if (!d) return;
    await api(`/api/clients/${client.id}`, { method: 'PUT', body: d });
    await loadClients();
    activeClient = clients.find(c => c.id === client.id);
    toast('CRM mis à jour.');
  }

  /* ────────── Historique (pièces supprimées) ────────── */
  async function openHistory(client) {
    const all = await api(`/api/clients/${client.id}/items?deleted=1`);
    const deleted = all.filter(i => i.deleted_at);
    const html = `
      <div class="modal-head">
        <h3>Historique des <em>pièces</em></h3>
        <button class="modal-close" type="button" data-close>&times;</button>
      </div>
      <div style="font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--muted);font-size:13px;margin-bottom:14px;">
        ${deleted.length} pièce${deleted.length>1?'s':''} précédemment proposée${deleted.length>1?'s':''} et supprimée${deleted.length>1?'s':''}.
      </div>
      <div class="adm-items" id="histList">
        ${deleted.length ? deleted.map(i => `
          <div class="adm-item" data-id="${i.id}">
            <div class="ai-thumb ${i.image?'':'placeholder'}">${i.image?`<img src="${esc(i.image)}">`:''}</div>
            <div class="ai-brand">${esc(i.brand||'—')}</div>
            <div class="ai-name">${esc(i.name||'')}</div>
            <div class="ai-meta">supprimée ${new Date(i.deleted_at).toLocaleDateString('fr-FR')}</div>
            <div class="ai-actions">
              <button class="btn btn-ghost btn-sm" data-act="restore">Restaurer</button>
              <button class="btn btn-ghost btn-sm btn-danger" data-act="purge">Purger</button>
            </div>
          </div>`).join('') : '<div style="grid-column:1/-1;font-style:italic;color:var(--muted);text-align:center;padding:30px;">Rien dans l\'historique.</div>'}
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" type="button" data-close>Fermer</button>
      </div>`;
    const { wrap, close } = openModal(html);
    wrap.querySelectorAll('[data-act="restore"]').forEach(b => b.addEventListener('click', async () => {
      const id = b.closest('.adm-item').dataset.id;
      await api(`/api/items/${id}/restore`, { method: 'POST' });
      close();
      items = await api(`/api/clients/${client.id}/items`);
      renderMain();
      toast('Pièce restaurée.');
    }));
    wrap.querySelectorAll('[data-act="purge"]').forEach(b => b.addEventListener('click', async () => {
      const id = b.closest('.adm-item').dataset.id;
      const ok = await modalConfirm('Purger définitivement cette pièce ?', { okLabel: 'Purger', danger: true });
      if (!ok) return;
      await api(`/api/items/${id}?hard=1`, { method: 'DELETE' });
      b.closest('.adm-item').remove();
      toast('Purgée.');
    }));
  }

  /* ────────── Heatmap viewer ────────── */
  async function openHeatmap(ins) {
    const points = await api(`/api/inspirations/${ins.id}/heatmap`);
    const html = `
      <div class="modal-head">
        <h3>Heatmap — <em>${esc(ins.title)}</em></h3>
        <button class="modal-close" type="button" data-close>&times;</button>
      </div>
      <div style="font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--muted);font-size:13px;margin-bottom:12px;">
        ${points.reduce((s,p)=>s+p.w,0)} clic${points.reduce((s,p)=>s+p.w,0)>1?'s':''} agrégé${points.reduce((s,p)=>s+p.w,0)>1?'s':''}.
      </div>
      <div class="heatmap-stage">
        ${ins.main_image ? `<img src="${esc(ins.main_image)}">` : '<div style="position:absolute;inset:0;display:grid;place-items:center;color:var(--muted);font-style:italic;">Pas d\'image</div>'}
        ${points.map(p => `<div class="heat-dot" style="left:${p.x}%;top:${p.y}%;width:${30+p.w*8}px;height:${30+p.w*8}px;opacity:${Math.min(0.85, 0.3 + p.w*0.15)};"></div>`).join('')}
      </div>
      <div class="modal-foot">
        <button class="btn" type="button" data-close>Fermer</button>
      </div>`;
    openModal(html);
  }

  /* ────────── QR code ────────── */
  function openQrModal(url, client) {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(url)}`;
    const html = `
      <div class="modal-head">
        <h3>QR — <em>${esc(client.name)}</em></h3>
        <button class="modal-close" type="button" data-close>&times;</button>
      </div>
      <div class="qr-wrap">
        <img src="${qrUrl}" alt="QR code">
        <div class="qr-url">${esc(url)}</div>
        <div style="font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--muted);margin-top:14px;font-size:13px;">
          À scanner avec un smartphone pour ouvrir directement la sélection.
        </div>
      </div>
      <div class="modal-foot">
        <a href="${qrUrl}" download="qr-${esc(client.slug || 'client')}.png" class="btn btn-ghost btn-sm" style="text-decoration:none;">Télécharger</a>
        <button class="btn" type="button" data-close>Fermer</button>
      </div>`;
    openModal(html);
  }

  /* ────────── Invitation client par email ────────── */
  async function openInviteModal(client) {
    // recharge client pour avoir les infos auth à jour
    const fresh = (await api('/api/clients')).find(c => c.id === client.id) || client;
    const statusBadge = fresh.is_claimed
      ? `<span style="background:rgba(39,174,96,0.12);color:#1e7e4f;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.06em;">✓ Compte activé</span>`
      : (fresh.email
        ? `<span style="background:rgba(184,145,90,0.12);color:var(--accent-deep,#8a6a3a);padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.06em;">Invitation envoyée — en attente</span>`
        : `<span style="background:var(--bg-soft);color:var(--muted);padding:3px 10px;border-radius:999px;font-size:11px;font-style:italic;">Aucun email</span>`);

    const html = `
      <div class="modal-head">
        <h3>Inviter <em>${esc(client.name)}</em></h3>
        <button class="modal-close" type="button" data-close>&times;</button>
      </div>

      <div style="margin-bottom:18px;">${statusBadge}</div>

      <div style="font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--ink-soft);font-size:14px;margin-bottom:18px;line-height:1.5;">
        Génère un lien de connexion personnel. ${fresh.is_claimed
          ? 'Votre client peut déjà se connecter ' + (fresh.has_password ? 'par email + mot de passe' : 'par lien magique uniquement') + '.'
          : 'Le client recevra un lien à usage unique (valable 7 jours) pour activer son espace.'}
      </div>

      <form id="inviteForm">
        <div class="field"><label>Email du client</label>
          <input name="email" type="email" value="${esc(fresh.email||'')}" required placeholder="prenom@email.com">
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-close>Annuler</button>
          <button type="submit" class="btn">${fresh.is_claimed ? 'Renvoyer un lien magique' : 'Générer l\'invitation'}</button>
        </div>
      </form>

      <div id="inviteResult" style="display:none;margin-top:18px;padding:16px;background:var(--bg-soft);border:1px solid var(--hairline);"></div>

      <div style="margin-top:24px;padding-top:18px;border-top:1px solid var(--hairline);">
        <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;">Page de connexion client</div>
        <div style="font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--ink-soft);font-size:13px;">
          Vous pouvez aussi communiquer cette adresse : <a href="/c/login" target="_blank" style="text-decoration:underline;color:var(--ink);">${location.origin}/c/login</a> — où le client se connectera avec son email + mot de passe ou demandera un nouveau lien magique.
        </div>
      </div>`;

    const { wrap, close } = openModal(html);
    wrap.querySelector('#inviteForm').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      try {
        const r = await api(`/api/clients/${client.id}/invite`, { method: 'POST', body: { email: fd.email } });
        const out = wrap.querySelector('#inviteResult');
        out.style.display = 'block';
        out.innerHTML = `
          <div style="font-family:'Cormorant Garamond',serif;font-size:13px;color:var(--ink-soft);margin-bottom:8px;">
            ✓ Lien généré pour <strong>${esc(r.email)}</strong> (expire le ${new Date(r.expires).toLocaleDateString('fr-FR')}).
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input value="${esc(r.url)}" readonly style="flex:1;background:#fff;border:1px solid var(--hairline-strong);padding:8px 10px;font-size:12px;font-family:monospace;" id="inviteUrl">
            <button type="button" class="btn btn-sm" id="copyInviteBtn">Copier</button>
          </div>
          <div style="margin-top:10px;font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--muted);font-size:12px;">
            ✉ En production, ce lien serait envoyé automatiquement par email (Resend / Postmark…). Pour l'instant, copiez-le et envoyez-le manuellement à votre client.
          </div>`;
        out.querySelector('#copyInviteBtn').addEventListener('click', () => {
          navigator.clipboard.writeText(r.url).then(() => toast('Lien copié.'));
        });
        // refresh state
        await loadClients();
      } catch (err) {
        toast(err.message || 'Erreur');
      }
    });
  }

  /* ────────── Éditeur de tags ────────── */
  async function openTagEditor(client) {
    const c = (await api('/api/clients')).find(x => x.id === client.id);
    let tags = (c.tags || []).slice();
    const html = `
      <div class="modal-head">
        <h3>Tags de <em>${esc(client.name)}</em></h3>
        <button class="modal-close" type="button" data-close>&times;</button>
      </div>
      <div style="font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--muted);font-size:13px;margin-bottom:12px;">
        Catégorisez votre client (VIP, saison, occasion…). Visible sur la carte du portfolio et filtrable.
      </div>
      <div class="tag-editor-list" id="tagList"></div>

      <div style="display:flex;gap:8px;align-items:flex-end;margin-top:14px;">
        <div class="field" style="flex:1;">
          <label>Nouveau tag</label>
          <input id="newTagLabel" placeholder="ex: VIP, Mariage…" maxlength="30">
        </div>
        <div class="field">
          <label>Couleur</label>
          <input id="newTagColor" type="color" value="#b8915a" style="height:40px;padding:4px;width:60px;">
        </div>
        <button class="btn" type="button" id="addTagBtn">+ Ajouter</button>
      </div>

      <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);margin:18px 0 6px;">Suggestions rapides</div>
      <div class="tag-presets" id="tagPresets">
        ${TAG_PRESETS.map(t => `<button class="tag-preset-btn" data-label="${esc(t.label)}" data-color="${esc(t.color)}">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${esc(t.color)};margin-right:5px;vertical-align:middle;"></span>${esc(t.label)}
        </button>`).join('')}
      </div>

      <div class="modal-foot">
        <button type="button" class="btn btn-ghost" data-close>Annuler</button>
        <button type="button" class="btn" id="saveTagsBtn">Enregistrer</button>
      </div>`;
    const { wrap, close } = openModal(html);

    const renderList = () => {
      wrap.querySelector('#tagList').innerHTML = tags.map((t, i) =>
        `<span class="tag-chip" style="background:${esc(t.color)}">
          ${esc(t.label)}
          <button data-rm="${i}" title="Retirer">×</button>
        </span>`).join('');
      wrap.querySelectorAll('[data-rm]').forEach(b =>
        b.addEventListener('click', () => { tags.splice(+b.dataset.rm, 1); renderList(); }));
    };
    renderList();

    wrap.querySelector('#addTagBtn').addEventListener('click', () => {
      const label = wrap.querySelector('#newTagLabel').value.trim();
      const color = wrap.querySelector('#newTagColor').value;
      if (!label) return;
      if (tags.some(t => t.label.toLowerCase() === label.toLowerCase())) {
        toast('Tag déjà présent.'); return;
      }
      tags.push({ label, color });
      wrap.querySelector('#newTagLabel').value = '';
      renderList();
    });
    wrap.querySelectorAll('.tag-preset-btn').forEach(b => {
      b.addEventListener('click', () => {
        const label = b.dataset.label;
        if (tags.some(t => t.label.toLowerCase() === label.toLowerCase())) return;
        tags.push({ label, color: b.dataset.color });
        renderList();
      });
    });

    wrap.querySelector('#saveTagsBtn').addEventListener('click', async () => {
      await api(`/api/clients/${client.id}/tags`, { method: 'PUT', body: { tags } });
      await loadClients();
      activeClient = clients.find(x => x.id === client.id);
      close();
      toast('Tags enregistrés.');
    });
  }

  /* ────────── Boot ────────── */
  await loadClients();

})();
