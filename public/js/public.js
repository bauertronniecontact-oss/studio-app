/* Studio — vue publique client */
(async function () {
  const slug = location.pathname.split('/').filter(Boolean)[1];
  if (!slug) { document.body.innerHTML = '<p style="padding:60px;text-align:center;font-family:Cormorant Garamond,serif;font-style:italic;">Lien invalide.</p>'; return; }

  let data;
  try {
    const r = await fetch(`/api/public/${slug}`);
    if (!r.ok) throw new Error('not found');
    data = await r.json();
  } catch {
    document.body.innerHTML = '<p style="padding:60px;text-align:center;font-family:Cormorant Garamond,serif;font-style:italic;">Cette sélection n\'existe pas.</p>';
    return;
  }

  /* ───── tracking événements ───── */
  function track(kind, payload = {}) {
    try {
      navigator.sendBeacon
        ? navigator.sendBeacon(`/api/public/${slug}/event`, new Blob([JSON.stringify({ kind, ...payload })], { type: 'application/json' }))
        : fetch(`/api/public/${slug}/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, ...payload }), keepalive: true });
    } catch {}
  }
  track('view_page');

  // Temps passé : on émet périodiquement
  let visibleSince = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      track('time', { duration_ms: Date.now() - visibleSince });
    } else visibleSince = Date.now();
  });
  window.addEventListener('beforeunload', () => track('time', { duration_ms: Date.now() - visibleSince }));

  /* ───── white-label ───── */
  const studio = data.studio || {};
  const studioName = (studio.studio_name || 'STUDIO').toUpperCase();
  const logo = studio.studio_logo || studioName[0] || 'S';
  document.querySelectorAll('.topbar .mark, .f-mark').forEach(el => {
    if (el.classList.contains('mark')) el.innerHTML = `<span class="logo">${esc(logo)}</span>${esc(studioName)}`;
    else el.textContent = studioName;
  });
  if (studio.accent_color) document.documentElement.style.setProperty('--accent', studio.accent_color);
  document.title = `${studioName} — ${data.client.name}`;

  /* ───── état d'authentification client ───── */
  let clientAuth = { logged: false };
  try { clientAuth = await fetch('/c/auth/me').then(r => r.json()); } catch {}

  // Intégré dans la topbar (à la place des icônes) — plus de chevauchement
  const topbarIcons = document.querySelector('.topbar-icons');
  if (topbarIcons) {
    if (clientAuth.logged) {
      topbarIcons.innerHTML = `
        <span class="auth-status">Connecté · ${esc(clientAuth.email || clientAuth.name)}</span>
        ${!clientAuth.has_password ? `<button id="setPwdBtn" class="auth-pill auth-pill-primary">Définir un mot de passe</button>` : ''}
        <button id="logoutClientBtn" class="auth-pill">Déconnexion</button>
      `;
    } else {
      topbarIcons.innerHTML = `
        <a href="/c/login" class="auth-pill auth-pill-link">
          <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Se connecter à mon espace
        </a>`;
    }
  }

  if (clientAuth.logged) {
    document.getElementById('logoutClientBtn')?.addEventListener('click', async () => {
      await fetch('/c/auth/logout', { method: 'POST' });
      location.reload();
    });
    document.getElementById('setPwdBtn')?.addEventListener('click', openSetPasswordModal);
  }

  function openSetPasswordModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:300;display:grid;place-items:center;padding:24px;';
    overlay.innerHTML = `
      <div style="background:#fff;padding:30px;max-width:420px;width:100%;border:1px solid var(--hairline);">
        <h3 style="font-family:'Cormorant Garamond',serif;font-weight:400;font-size:22px;margin-bottom:8px;">Définir un mot de passe</h3>
        <p style="font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--muted);font-size:13px;margin-bottom:16px;line-height:1.5;">
          Vous pourrez ensuite vous reconnecter avec votre email + ce mot de passe, sans avoir besoin d'un lien magique.
        </p>
        <form id="pwdF">
          <label style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted);">Nouveau mot de passe (min 6 caractères)</label>
          <input type="password" name="password" required minlength="6" style="width:100%;padding:10px 12px;border:1px solid var(--hairline-strong);margin-top:6px;font-size:14px;">
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;">
            <button type="button" id="closePwd" style="background:#fff;border:1px solid var(--hairline-strong);padding:10px 18px;font-size:12px;cursor:pointer;">Annuler</button>
            <button type="submit" style="background:var(--ink);color:#fff;border:none;padding:10px 18px;font-size:12px;cursor:pointer;">Enregistrer</button>
          </div>
          <div id="pwdErrMsg" style="display:none;color:#b03030;font-size:12px;margin-top:8px;"></div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#closePwd').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#pwdF').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      const r = await fetch('/c/auth/set-password', {
        method: 'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ password: fd.password })
      });
      const d = await r.json().catch(()=>({}));
      if (r.ok) { overlay.remove(); location.reload(); }
      else {
        const err = overlay.querySelector('#pwdErrMsg');
        err.textContent = d.error || 'Erreur';
        err.style.display = 'block';
      }
    });
  }

  /* ───── badge notifs (intégré dans la topbar, sans collision) ───── */
  if (data.unread_notifications > 0 && topbarIcons) {
    const badge = document.createElement('button');
    badge.className = 'notif-badge';
    badge.innerHTML = `<span class="notif-dot"></span>${data.unread_notifications} nouveau${data.unread_notifications>1?'x':''}`;
    badge.title = 'Cliquez pour marquer comme lu';
    badge.addEventListener('click', async () => {
      await fetch(`/api/public/${slug}/notifications/read`, { method: 'POST' });
      badge.remove();
    });
    topbarIcons.prepend(badge);
  }

  /* ───── bandeau d'accueil ───── */
  const clientFilled = data.client.profile_filled_by;
  if (data.client.welcome_message || studio.bio || studio.photo_url || data.client.photo_url || !clientFilled) {
    const banner = document.createElement('div');
    banner.className = 'client-banner';
    banner.innerHTML = `
      <div class="container client-banner-inner">
        <div class="cb-client">
          ${data.client.photo_url
            ? `<a href="/c/${esc(slug)}/profile" class="cb-photo cb-has" title="Modifier ma photo"><img src="${esc(data.client.photo_url)}" alt=""></a>`
            : `<a href="/c/${esc(slug)}/profile" class="cb-photo cb-empty" title="Ajouter ma photo"><span>+ photo</span></a>`}
          <div class="cb-client-text">
            <div class="cb-greeting">Bonjour</div>
            <div class="cb-name">${esc(data.client.name)}</div>
          </div>
        </div>

        ${data.client.welcome_message
          ? `<div class="cb-message">"${esc(data.client.welcome_message)}"</div>`
          : (studio.bio ? `<div class="cb-message">${esc(studio.bio)}</div>` : '')}

        ${studio.name || studio.photo_url ? `
          <div class="cb-stylist">
            ${studio.photo_url ? `<img class="cb-stylist-photo" src="${esc(studio.photo_url)}" alt="">` : ''}
            <div class="cb-stylist-text">
              <div class="cb-stylist-label">Votre styliste</div>
              <div class="cb-stylist-name">${esc(studio.name || studio.studio_name || '')}</div>
            </div>
          </div>` : ''}

        ${!clientFilled ? `
          <a href="/c/${esc(slug)}/profile" class="btn btn-ghost btn-sm cb-cta">
            Compléter mon profil →
          </a>` : ''}
      </div>`;
    document.querySelector('.topbar').insertAdjacentElement('afterend', banner);
  }

  /* ───── tabs ───── */
  document.querySelectorAll('.topbar .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.topbar .tab').forEach(b => b.classList.toggle('active', b === btn));
      const t = btn.dataset.tab;
      document.getElementById('tab-selection').style.display    = t === 'selection' ? '' : 'none';
      document.getElementById('tab-inspiration').style.display  = t === 'inspiration' ? '' : 'none';
      const mb = document.getElementById('tab-moodboard');
      if (mb) { mb.style.display = t === 'moodboard' ? '' : 'none'; if (t === 'moodboard') loadMoodboard(); }
    });
  });

  /* ───── Moodboard client ───── */
  let moodboard = [];
  async function loadMoodboard() {
    moodboard = await fetch(`/api/public/${slug}/moodboard`).then(r => r.json()).catch(() => []);
    renderMoodboard();
  }
  function renderMoodboard() {
    const grid = document.getElementById('moodboardGrid');
    if (!grid) return;
    if (!moodboard.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1;"><div class="e-title">Encore vide</div><div class="e-sub">Déposez votre première inspiration ci-dessus.</div></div>`;
      return;
    }
    grid.innerHTML = moodboard.map(m => `
      <div class="card mb-card" data-id="${m.id}">
        <div class="visual"><img src="${esc(m.image_url)}" alt=""></div>
        <button class="mb-del" data-del="${m.id}" title="Retirer" style="position:absolute;top:10px;right:10px;width:28px;height:28px;border-radius:50%;border:none;background:rgba(255,255,255,0.95);color:var(--ink);cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.12);transition:background .2s,color .2s,transform .15s;">×</button>
      </div>`).join('');
    grid.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('mouseenter', () => { btn.style.background = '#b03030'; btn.style.color = '#fff'; btn.style.transform = 'scale(1.08)'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(255,255,255,0.95)'; btn.style.color = 'var(--ink)'; btn.style.transform = ''; });
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const id = +btn.dataset.del;
        await fetch(`/api/public/${slug}/moodboard/${id}`, { method: 'DELETE' });
        moodboard = moodboard.filter(m => m.id !== id);
        renderMoodboard();
      });
    });
  }
  const mbDrop = document.getElementById('moodboardDrop');
  const mbInput = document.getElementById('moodboardInput');
  async function uploadMoodboardFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const fd = new FormData(); fd.append('file', file);
    const up = await fetch(`/api/public/${slug}/upload`, { method: 'POST', body: fd }).then(r => r.json()).catch(() => null);
    if (!up?.url) return;
    const row = await fetch(`/api/public/${slug}/moodboard`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ image_url: up.url }) }).then(r => r.json()).catch(() => null);
    if (row?.id) { moodboard.unshift(row); renderMoodboard(); }
  }
  if (mbDrop && mbInput) {
    mbDrop.addEventListener('click', () => mbInput.click());
    mbInput.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) uploadMoodboardFile(f); mbInput.value = ''; });
    mbDrop.addEventListener('dragover', e => { e.preventDefault(); mbDrop.style.background = 'rgba(184,145,90,0.08)'; mbDrop.style.borderColor = 'var(--accent)'; });
    mbDrop.addEventListener('dragleave', () => { mbDrop.style.background = ''; mbDrop.style.borderColor = ''; });
    mbDrop.addEventListener('drop', e => {
      e.preventDefault(); mbDrop.style.background = ''; mbDrop.style.borderColor = '';
      const f = e.dataTransfer.files?.[0]; if (f) uploadMoodboardFile(f);
    });
  }
  const mbUrlBtn = document.getElementById('moodboardUrlBtn');
  const mbUrlIn = document.getElementById('moodboardUrl');
  const mbUrlStatus = document.getElementById('moodboardUrlStatus');
  const mbUrlSpin = document.getElementById('moodboardUrlSpinner');
  const mbUrlLbl = document.getElementById('moodboardUrlLabel');
  async function addMoodboardUrl() {
    const url = (mbUrlIn?.value || '').trim(); if (!url) return;
    mbUrlBtn.disabled = true; if (mbUrlSpin) mbUrlSpin.style.display = 'inline-block'; if (mbUrlLbl) mbUrlLbl.textContent = 'Récupération…';
    if (mbUrlStatus) { mbUrlStatus.style.display = 'block'; mbUrlStatus.style.color = 'var(--muted)'; mbUrlStatus.textContent = 'Récupération de l\'image…'; }
    try {
      const r = await fetch(`/api/public/${slug}/moodboard/from-url`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ url }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (mbUrlStatus) { mbUrlStatus.style.color = '#b03030'; mbUrlStatus.textContent = '✗ ' + (d.error || 'échec'); }
      } else if (d?.id) {
        moodboard.unshift(d); renderMoodboard();
        if (mbUrlStatus) { mbUrlStatus.style.color = 'var(--accent)'; mbUrlStatus.textContent = '✓ Ajouté.'; }
        mbUrlIn.value = '';
      }
    } catch (e) {
      if (mbUrlStatus) { mbUrlStatus.style.color = '#b03030'; mbUrlStatus.textContent = '✗ ' + e.message; }
    }
    mbUrlBtn.disabled = false; if (mbUrlSpin) mbUrlSpin.style.display = 'none'; if (mbUrlLbl) mbUrlLbl.textContent = 'Ajouter';
  }
  mbUrlBtn?.addEventListener('click', addMoodboardUrl);
  mbUrlIn?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addMoodboardUrl(); } });

  /* ─── Sélection ─── */
  const items = data.items || [];
  const folders = data.folders || [];
  const cats   = [...new Set(items.map(i => i.cat).filter(Boolean))];
  const brands = [...new Set(items.map(i => i.brand).filter(Boolean))];

  const state = { cat: 'all', brand: 'all', folderId: 'all', compareMode: false };
  const compareSet = new Set();

  function openDropdown(pick, key, options, labelFor, labelAll) {
    document.querySelectorAll('.hero-dd').forEach(d => d.remove());
    const dd = document.createElement('div');
    dd.className = 'hero-dd open';
    dd.innerHTML = [
      ...(labelAll ? [`<button data-v="all" class="${state[key]==='all'?'active':''}">${labelAll}</button>`] : []),
      ...options.map(o => `<button data-v="${esc(o)}" class="${state[key]===o?'active':''}">${esc(labelFor(o))}</button>`)
    ].join('');
    pick.appendChild(dd);
    dd.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        state[key] = b.dataset.v;
        pick.textContent = b.textContent;
        pick.classList.toggle('set', state[key] !== 'all');
        renderItems();
      });
    });
    setTimeout(() => {
      document.addEventListener('click', function close(e) {
        if (!dd.contains(e.target)) { dd.remove(); document.removeEventListener('click', close); }
      });
    }, 0);
  }

  const pickCat   = document.getElementById('pickCat');
  const pickBrand = document.getElementById('pickBrand');
  pickCat.addEventListener('click', e => {
    e.stopPropagation();
    openDropdown(pickCat, 'cat', cats, v => v, 'pièces');
  });
  pickBrand.addEventListener('click', e => {
    e.stopPropagation();
    openDropdown(pickBrand, 'brand', brands, v => v, 'Toute marque');
  });
  const pickFolder = document.getElementById('pickFolder');
  if (pickFolder && folders.length) {
    pickFolder.addEventListener('click', e => {
      e.stopPropagation();
      const ids = folders.map(f => String(f.id));
      const nameOf = id => folders.find(f => String(f.id) === id)?.name || '';
      openDropdown(pickFolder, 'folderId', ids, nameOf, 'Mes collections');
    });
  } else if (pickFolder) {
    pickFolder.style.cursor = 'default';
    pickFolder.style.borderBottom = 'none';
  }

  // bouton "Filtres avancés" → on l'utilise pour le mode comparateur
  const advBtn = document.getElementById('advFiltersBtn');
  advBtn.innerHTML = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.4;"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>Comparer';
  advBtn.addEventListener('click', () => {
    state.compareMode = !state.compareMode;
    if (!state.compareMode) compareSet.clear();
    advBtn.style.background = state.compareMode ? 'var(--ink)' : '#fff';
    advBtn.style.color = state.compareMode ? '#fff' : 'var(--ink)';
    renderItems();
  });

  const grid    = document.getElementById('grid');
  const counter = document.getElementById('counter');

  function renderItems() {
    const list = items.filter(it =>
      (state.cat === 'all'   || it.cat === state.cat) &&
      (state.brand === 'all' || it.brand === state.brand) &&
      (state.folderId === 'all' || (it.folder_ids || []).includes(+state.folderId))
    );
    counter.innerHTML = `${list.length} pièce${list.length>1?'s':''}` +
      (state.compareMode ? ` · <strong style="color:var(--accent)">Mode comparateur</strong> — sélectionnez 2 ou 3 pièces` : '');

    if (!list.length) {
      grid.innerHTML = `<div class="empty"><div class="e-title">Aucune pièce</div><div class="e-sub">Ajustez vos filtres.</div></div>`;
      return;
    }
    const STATUS_LBL = { proposed:'Proposée', validated:'Validée ✓', bought:'Achetée', rejected:'Refusée' };
    grid.innerHTML = list.map(it => {
      const selected = compareSet.has(it.id);
      const gallery = Array.isArray(it.images) && it.images.length ? it.images : (it.image ? [it.image] : []);
      const multi = gallery.length > 1;
      return `
      <div class="card ${selected?'compare-selected':''}" data-id="${it.id}" data-gallery='${esc(JSON.stringify(gallery))}'>
        <div class="visual ${gallery[0] ? '' : 'placeholder'}" data-zoom="${gallery[0] ? esc(gallery[0]) : ''}">
          ${gallery[0] ? `<img class="gallery-img" src="${esc(gallery[0])}" alt="" data-idx="0">` : `<span>— visuel —</span>`}
          ${multi ? `
            <button class="gallery-nav prev" data-nav="-1" aria-label="Précédent">‹</button>
            <button class="gallery-nav next" data-nav="1" aria-label="Suivant">›</button>
            <div class="gallery-dots">${gallery.map((_,i)=>`<span class="dot${i===0?' on':''}" data-dot="${i}"></span>`).join('')}</div>
          ` : ''}
          ${it.is_new ? `<span class="new-tag">Nouveau</span>` : ''}
          ${it.item_status ? `<span class="status-pill status-${it.item_status}">${STATUS_LBL[it.item_status]}</span>` : ''}
          ${state.compareMode ? `<span class="compare-mark">${selected ? '✓' : '+'}</span>` : `
            <button class="like-btn ${it.liked?'liked':''}" data-like="${it.id}" aria-label="Favori">
              <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            </button>`}
        </div>
        <div class="head">
          <span class="name">${esc(it.name || '')}</span>
          ${it.link && !state.compareMode ? `<a class="link-cta" href="${esc(it.link)}" target="_blank" rel="noopener" data-link="${it.id}">Voir +</a>` : ''}
        </div>
        <div class="meta">
          ${it.brand ? `<span class="brand">${esc(it.brand)}</span>` : ''}
          ${it.price ? `Dès ${esc(it.price)}` : ''}
        </div>
        ${it.description ? `<p class="desc">${esc(it.description)}</p>` : ''}
        ${it.comment ? `<div class="comment-display">${esc(it.comment)}</div>` : ''}
        ${!state.compareMode ? `
          <button class="link-cta" data-comment="${it.id}" style="background:none;border:none;padding:0;margin-top:8px;color:var(--ink-soft);font-size:11px;letter-spacing:0.06em;">${it.comment?'✎ Modifier commentaire':'＋ Laisser un commentaire'}</button>` : ''}
      </div>`;
    }).join('');

    // listeners
    grid.querySelectorAll('.card').forEach(card => {
      const id = +card.dataset.id;
      // gallery navigation
      const navBtns = card.querySelectorAll('[data-nav]');
      const dots = card.querySelectorAll('[data-dot]');
      const galImg = card.querySelector('.gallery-img');
      if (navBtns.length && galImg) {
        let gal = []; try { gal = JSON.parse(card.dataset.gallery || '[]'); } catch {}
        const showIdx = i => {
          if (!gal.length) return;
          const n = (i + gal.length) % gal.length;
          galImg.src = gal[n]; galImg.dataset.idx = String(n);
          card.querySelector('.visual')?.setAttribute('data-zoom', gal[n]);
          dots.forEach((d, k) => d.classList.toggle('on', k === n));
        };
        navBtns.forEach(b => b.addEventListener('click', e => {
          e.stopPropagation();
          showIdx((+galImg.dataset.idx || 0) + (+b.dataset.nav));
        }));
        dots.forEach(d => d.addEventListener('click', e => { e.stopPropagation(); showIdx(+d.dataset.dot); }));
      }
      // like button
      const likeBtn = card.querySelector('[data-like]');
      if (likeBtn) {
        likeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const r = await fetch(`/api/public/${slug}/items/${id}/like`, { method: 'POST' });
          const d = await r.json();
          likeBtn.classList.toggle('liked', d.liked);
          if (d.liked) { likeBtn.classList.remove('liked-just'); void likeBtn.offsetWidth; likeBtn.classList.add('liked-just'); }
          const it = items.find(x => x.id === id); if (it) it.liked = d.liked ? 1 : 0;
        });
      }
      // comment button
      const cmtBtn = card.querySelector('[data-comment]');
      if (cmtBtn) {
        cmtBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          openCommentBox(id, card);
        });
      }
      // card click: compare ou lightbox
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-like]') || e.target.closest('[data-comment]') || e.target.closest('a')) return;
        if (state.compareMode) {
          if (compareSet.has(id)) compareSet.delete(id);
          else if (compareSet.size >= 3) return;
          else compareSet.add(id);
          renderItems();
          if (compareSet.size >= 2) openCompare();
        } else {
          const visual = e.target.closest('.visual');
          if (visual && visual.dataset.zoom) {
            track('click_image', { target_id: id });
            openLightbox(visual.dataset.zoom);
          }
        }
      });
      card.querySelectorAll('[data-link]').forEach(a => {
        a.addEventListener('click', () => track('click_item', { target_id: id }));
      });
    });
  }

  function openCommentBox(id, card) {
    const it = items.find(x => x.id === id);
    const existing = it?.comment || '';
    const html = `
      <div class="modal-head">
        <h3>Votre <em>commentaire</em></h3>
        <button class="modal-close" data-close>&times;</button>
      </div>
      <div style="font-family:'Cormorant Garamond',serif;color:var(--muted);font-style:italic;font-size:13px;margin-bottom:14px;">
        Sur ${esc(it?.brand || '')} — ${esc(it?.name || '')}
      </div>
      <form id="cmtForm">
        <textarea name="comment" rows="4" placeholder="Trop cintré, j'aimerais en taille au-dessus…" style="width:100%;font-family:'Cormorant Garamond',serif;font-style:italic;font-size:15px;padding:14px;background:var(--bg-soft);border:1px solid var(--hairline);color:var(--ink-soft);outline:none;line-height:1.5;border-radius:2px;">${esc(existing)}</textarea>
        <div class="modal-foot">
          <button class="btn btn-ghost" type="button" data-close>Annuler</button>
          <button class="btn" type="submit">Envoyer</button>
        </div>
      </form>`;
    const wrap = document.createElement('div');
    wrap.className = 'modal-overlay';
    wrap.innerHTML = `<div class="modal" style="max-width:520px;">${html}</div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    const close = () => { wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 200); };
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    wrap.querySelector('#cmtForm').addEventListener('submit', async e => {
      e.preventDefault();
      const text = e.target.comment.value;
      await fetch(`/api/public/${slug}/items/${id}/comment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: text })
      });
      if (it) it.comment = text;
      close();
      renderItems();
    });
    setTimeout(() => wrap.querySelector('textarea')?.focus(), 50);
  }
  renderItems();

  /* ─── Comparateur ─── */
  function openCompare() {
    const chosen = items.filter(i => compareSet.has(i.id));
    if (chosen.length < 2) return;
    const html = `
      <div class="compare-head">
        <h3>Comparer <em>${chosen.length} pièces</em></h3>
        <button class="modal-close" data-close>&times;</button>
      </div>
      <div class="compare-grid" style="grid-template-columns: repeat(${chosen.length}, 1fr);">
        ${chosen.map(i => `
          <div class="compare-col">
            <div class="visual ${i.image?'':'placeholder'}" style="aspect-ratio:1/1;">${i.image?`<img src="${esc(i.image)}" alt="">`:'<span>— visuel —</span>'}</div>
            <div style="margin-top:14px;">
              <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;font-weight:600;">${esc(i.brand||'')}</div>
              <div style="font-family:'Cormorant Garamond',serif;font-size:18px;margin-top:2px;">${esc(i.name||'')}</div>
              <div style="font-family:'Cormorant Garamond',serif;color:var(--ink-soft);margin-top:6px;">${esc(i.price||'')}</div>
              <div style="font-size:11px;color:var(--muted);letter-spacing:0.05em;margin-top:4px;">${esc(i.cat||'')}</div>
              ${i.description?`<p style="font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--ink-soft);margin-top:10px;line-height:1.5;font-size:14px;">${esc(i.description)}</p>`:''}
              ${i.link?`<a href="${esc(i.link)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="margin-top:14px;display:inline-block;text-decoration:none;">Voir le produit →</a>`:''}
            </div>
          </div>`).join('')}
      </div>`;
    openOverlay(html, 'compare');
  }

  /* ─── Lightbox ─── */
  function openLightbox(url) {
    const html = `
      <button class="modal-close" data-close style="position:absolute;top:18px;right:18px;font-size:32px;color:#fff;z-index:10;">&times;</button>
      <div class="lightbox-img-wrap">
        <img src="${esc(url)}" alt="" id="lbImg">
      </div>`;
    openOverlay(html, 'lightbox');
    let scale = 1;
    const img = document.getElementById('lbImg');
    img.addEventListener('wheel', e => {
      e.preventDefault();
      scale = Math.min(5, Math.max(1, scale + (e.deltaY < 0 ? 0.15 : -0.15)));
      img.style.transform = `scale(${scale})`;
    }, { passive: false });
    img.addEventListener('click', () => {
      scale = scale === 1 ? 2 : 1;
      img.style.transform = `scale(${scale})`;
    });
  }

  /* ─── Helpers overlay ─── */
  function openOverlay(html, kind) {
    const wrap = document.createElement('div');
    wrap.className = `pub-overlay ${kind}`;
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    const close = () => { wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 200); };
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    document.addEventListener('keydown', function k(e){ if(e.key==='Escape'){close();document.removeEventListener('keydown',k);}});
    return { close };
  }

  /* ─── Inspirations ─── */
  const insps = data.inspirations || [];
  document.getElementById('insp-counter').textContent =
    `${insps.length} look${insps.length>1?'s':''}`;
  const listEl = document.getElementById('insp-list');
  if (!insps.length) {
    listEl.innerHTML = `<div class="empty"><div class="e-title">Aucune inspiration</div><div class="e-sub">À venir prochainement.</div></div>`;
  } else {
    insps.forEach(ins => listEl.appendChild(renderInspiration(ins)));
    requestAnimationFrame(() => document.querySelectorAll('.inspiration').forEach(drawLines));
    window.addEventListener('resize', () => document.querySelectorAll('.inspiration').forEach(drawLines));
  }

  function renderInspiration(ins) {
    track('view_inspiration', { target_id: ins.id });
    const wrap = document.createElement('article');
    wrap.className = 'inspiration';
    wrap.dataset.insp = ins.id;
    // total du look = somme des prix de la 1ère référence de chaque pièce
    let total = 0; let currency = ''; let counted = 0;
    ins.pieces.forEach(p => {
      const r = p.refs?.[0];
      if (!r) return;
      const m = String(r.link ? '' : '').match(/^/); // placeholder
      // parser via brand/name/link inutile — on tente sur "name" si contient prix, sinon skip
      // Simplification : pas de prix sur ref, on ignore
    });
    // Plutôt : utiliser les pièces "items" liées (non disponible) → on affiche le total uniquement si Items publics ont price
    // On somme les pièces de la sélection dont le brand+name match les références (heuristique simple)
    const matched = [];
    ins.pieces.forEach(p => {
      const r = p.refs?.[0]; if (!r) return;
      const it = items.find(x =>
        (r.brand && x.brand && x.brand.toLowerCase() === r.brand.toLowerCase()) &&
        (r.name && x.name && x.name.toLowerCase().includes((r.name||'').toLowerCase().split(' ')[0]))
      );
      if (it && it.price) {
        const m = String(it.price).match(/([A-Z€$£¥]{1,3})?\s*([\d.,]+)/);
        if (m) {
          const amt = parseFloat(m[2].replace(/,/g,'.'));
          if (!isNaN(amt)) { total += amt; currency = currency || (m[1] || ''); counted++; }
        }
      }
    });
    const totalLabel = counted >= 2
      ? `<span class="look-total">Total du look · <strong>${currency} ${Math.round(total).toLocaleString('fr-CH')}</strong></span>`
      : '';

    wrap.innerHTML = `
      <h3>${esc(ins.title || 'Look')} ${totalLabel}</h3>
      <div class="insp-layout">
        <div class="insp-left ${ins.main_image ? '' : 'placeholder'}">
          ${ins.main_image ? `<img src="${esc(ins.main_image)}" alt="" data-zoom>` : ''}
          <svg class="insp-svg" preserveAspectRatio="none"></svg>
          ${ins.pieces.map((p, i) => `
            <div class="anchor-dot" data-piece="${p.id}"
              style="left:${p.anchor_x}%; top:${p.anchor_y}%;"
              title="${esc(p.label||'')}">${i + 1}</div>
          `).join('')}
        </div>
        <div class="insp-right">
          ${ins.pieces.map(p => renderPieceBox(p)).join('') || '<div class="empty" style="padding:30px"><div class="e-sub">Pas encore de pièce.</div></div>'}
        </div>
      </div>
    `;
    // image cliquable → lightbox + tracking
    const mainImg = wrap.querySelector('.insp-left img[data-zoom]');
    if (mainImg) {
      mainImg.addEventListener('click', (e) => {
        const r = mainImg.getBoundingClientRect();
        track('click_image', {
          target_id: ins.id,
          x: ((e.clientX - r.left) / r.width) * 100,
          y: ((e.clientY - r.top)  / r.height) * 100
        });
        openLightbox(mainImg.src);
      });
    }
    // dots tracking
    wrap.querySelectorAll('.anchor-dot').forEach(d => {
      d.addEventListener('click', () => track('click_hotspot', { target_id: ins.id, meta: { piece_id: d.dataset.piece } }));
    });
    const boxes = wrap.querySelectorAll('.piece-box');
    const dots  = wrap.querySelectorAll('.anchor-dot');
    boxes.forEach(box => {
      const id = box.dataset.piece;
      box.addEventListener('mouseenter', () => highlight(wrap, id, true));
      box.addEventListener('mouseleave', () => highlight(wrap, id, false));
    });
    dots.forEach(d => {
      const id = d.dataset.piece;
      d.addEventListener('mouseenter', () => highlight(wrap, id, true));
      d.addEventListener('mouseleave', () => highlight(wrap, id, false));
    });
    wrap.querySelectorAll('.piece-box').forEach(box => {
      const prev = box.querySelector('.pb-prev');
      const next = box.querySelector('.pb-next');
      if (prev) prev.addEventListener('click', () => navRef(box, -1));
      if (next) next.addEventListener('click', () => navRef(box, +1));
      box.querySelectorAll('.pb-link').forEach(a =>
        a.addEventListener('click', () => track('click_ref', { target_id: +box.dataset.piece })));
      const v = box.querySelector('.pb-visual img');
      if (v) v.addEventListener('click', () => openLightbox(v.src));
    });
    return wrap;
  }

  function renderPieceBox(p) {
    if (!p.refs.length) {
      return `<div class="piece-box" data-piece="${p.id}">
        <div class="pb-visual"></div>
        <div class="pb-body">
          <span class="pb-label">${esc(p.label || '')}</span>
          <span class="pb-name" style="font-style:italic;color:#999">— aucune référence —</span>
        </div>
      </div>`;
    }
    const refsJson = encodeURIComponent(JSON.stringify(p.refs));
    return `<div class="piece-box" data-piece="${p.id}" data-refs="${refsJson}" data-idx="0">
      <div class="pb-visual">${p.refs[0].image ? `<img src="${esc(p.refs[0].image)}" alt="">` : ''}</div>
      <div class="pb-body">
        <span class="pb-label">${esc(p.label || '')}</span>
        <span class="pb-brand">${esc(p.refs[0].brand || '')}</span>
        <span class="pb-name">${esc(p.refs[0].name || '')}</span>
        ${p.refs[0].link ? `<a class="pb-link" href="${esc(p.refs[0].link)}" target="_blank" rel="noopener">Voir →</a>` : ''}
      </div>
      ${p.refs.length > 1 ? `
      <div class="pb-nav">
        <button class="pb-prev" aria-label="Précédent">◀</button>
        <div class="pb-counter">1/${p.refs.length}</div>
        <button class="pb-next" aria-label="Suivant">▶</button>
      </div>` : ''}
    </div>`;
  }

  function navRef(box, dir) {
    const refs = JSON.parse(decodeURIComponent(box.dataset.refs));
    let idx = parseInt(box.dataset.idx) + dir;
    if (idx < 0) idx = refs.length - 1;
    if (idx >= refs.length) idx = 0;
    box.dataset.idx = idx;
    const r = refs[idx];
    box.querySelector('.pb-visual').innerHTML = r.image ? `<img src="${esc(r.image)}" alt="">` : '';
    box.querySelector('.pb-brand').textContent = r.brand || '';
    box.querySelector('.pb-name').textContent  = r.name  || '';
    let linkEl = box.querySelector('.pb-link');
    if (r.link) {
      if (linkEl) linkEl.href = r.link;
      else {
        const a = document.createElement('a');
        a.className = 'pb-link'; a.target = '_blank'; a.rel = 'noopener';
        a.href = r.link; a.textContent = 'Voir →';
        box.querySelector('.pb-body').appendChild(a);
      }
    } else if (linkEl) linkEl.remove();
    box.querySelector('.pb-counter').textContent = `${idx+1}/${refs.length}`;
    const v = box.querySelector('.pb-visual img');
    if (v) v.addEventListener('click', () => openLightbox(v.src));
  }

  function highlight(wrap, pieceId, on) {
    wrap.querySelectorAll(`.piece-box[data-piece="${pieceId}"]`).forEach(b => b.classList.toggle('active', on));
    wrap.querySelectorAll(`.anchor-dot[data-piece="${pieceId}"]`).forEach(d => d.classList.toggle('active', on));
    wrap.querySelectorAll(`line[data-piece="${pieceId}"]`).forEach(l => l.classList.toggle('active', on));
  }

  function drawLines(wrap) {
    const left = wrap.querySelector('.insp-left');
    const svg = wrap.querySelector('.insp-svg');
    if (!left || !svg) return;
    const lr = left.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${lr.width} ${lr.height}`);
    svg.setAttribute('width', lr.width);
    svg.setAttribute('height', lr.height);
    svg.innerHTML = '';
    wrap.querySelectorAll('.anchor-dot').forEach(dot => {
      const pid = dot.dataset.piece;
      const box = wrap.querySelector(`.piece-box[data-piece="${pid}"]`);
      if (!box) return;
      const dx = (parseFloat(dot.style.left) / 100) * lr.width;
      const dy = (parseFloat(dot.style.top)  / 100) * lr.height;
      const br = box.getBoundingClientRect();
      const targetX = lr.width + (br.left - lr.right);
      const targetY = (br.top + br.height/2) - lr.top;
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', dx); ln.setAttribute('y1', dy);
      ln.setAttribute('x2', targetX); ln.setAttribute('y2', targetY);
      ln.setAttribute('data-piece', pid);
      svg.appendChild(ln);
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
})();
