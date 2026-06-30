/* Studio Personal Shopping — backend Express + Supabase (Postgres) */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SUPABASE_SECRET) {
  console.error('❌ Variables d\'environnement manquantes : SUPABASE_URL et SUPABASE_SECRET_KEY (voir .env)');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, {
  auth: { persistSession: false },
  db: { schema: 'public' }
});

/* ─────────── Code d'accès client (dérivé du slug + SECRET) ─────────── */
const ACCESS_SECRET = process.env.SESSION_SECRET || 'studio-dev-secret-change-me';
function codeFromSlug(slug) {
  return crypto.createHmac('sha256', ACCESS_SECRET)
    .update('access:' + (slug || ''))
    .digest('hex').slice(0, 6).toUpperCase();
}

/* ─────────── Helpers Supabase (mince couche pour lisibilité) ─────────── */
async function dbFirst(table, where, opts = {}) {
  let q = sb.from(table).select(opts.select || '*');
  for (const [k, v] of Object.entries(where || {})) q = q.eq(k, v);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data || null;
}
async function dbList(table, opts = {}) {
  let q = sb.from(table).select(opts.select || '*');
  if (opts.where) for (const [k, v] of Object.entries(opts.where)) q = q.eq(k, v);
  if (opts.is)    for (const [k, v] of Object.entries(opts.is))    q = q.is(k, v);
  if (opts.notIs) for (const [k, v] of Object.entries(opts.notIs)) q = q.not(k, 'is', v);
  if (opts.order) (Array.isArray(opts.order) ? opts.order : [opts.order]).forEach(o => {
    if (typeof o === 'string') q = q.order(o, { ascending: true });
    else q = q.order(o.col, { ascending: o.asc !== false, nullsFirst: o.nullsFirst });
  });
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
async function dbInsert(table, row) {
  const { data, error } = await sb.from(table).insert(row).select().single();
  if (error) throw error;
  return data;
}
async function dbUpdate(table, where, patch) {
  let q = sb.from(table).update(patch);
  for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
  const { data, error } = await q.select();
  if (error) throw error;
  return data && data[0] ? data[0] : null;
}
async function dbDelete(table, where) {
  let q = sb.from(table).delete();
  for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
  const { error } = await q;
  if (error) throw error;
}
async function dbCount(table, where = {}, notNull = []) {
  let q = sb.from(table).select('id', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(where)) {
    if (v === null) q = q.is(k, null);
    else q = q.eq(k, v);
  }
  for (const k of notNull) q = q.not(k, 'is', null);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}
async function dbMaxPos(table, where) {
  let q = sb.from(table).select('position').order('position', { ascending: false }).limit(1);
  for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
  const { data, error } = await q;
  if (error) throw error;
  return data?.[0]?.position || 0;
}

/* ─────────── Upload (Supabase Storage) ─────────── */
const UPLOAD_BUCKET = process.env.SUPABASE_BUCKET || 'studio-uploads';
const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads'); // legacy fallback (lecture seule)
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Auto-création du bucket public au démarrage
(async () => {
  try {
    const { data: buckets } = await sb.storage.listBuckets();
    if (!buckets || !buckets.find(b => b.name === UPLOAD_BUCKET)) {
      const { error } = await sb.storage.createBucket(UPLOAD_BUCKET, { public: true, fileSizeLimit: '12MB' });
      if (error && !/already exists/i.test(error.message)) console.error('Bucket create error:', error.message);
      else console.log(`▸ Supabase bucket "${UPLOAD_BUCKET}" prêt.`);
    }
  } catch (e) { console.error('Bucket init error:', e.message); }
})();

async function uploadToSupabase(file) {
  const ext = (path.extname(file.originalname || '') || '.jpg').toLowerCase().slice(0, 8);
  const key = `${Date.now()}-${nanoid(8)}${ext}`;
  const { error } = await sb.storage.from(UPLOAD_BUCKET)
    .upload(key, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) throw error;
  const { data } = sb.storage.from(UPLOAD_BUCKET).getPublicUrl(key);
  return data.publicUrl;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('image only'));
    cb(null, true);
  }
});

/* ─────────── App ─────────── */
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'studio-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 }
}));

const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'unauthorized' });
  next();
};

// Wrapper async pour Express : catche les erreurs sans répéter try/catch
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(err => {
  console.error('[err]', req.method, req.path, err?.message || err);
  if (res.headersSent) return;
  res.status(500).json({ error: err?.message || 'server error' });
});

/* ─────────── Admin seed ─────────── */
(async () => {
  try {
    const u = await dbFirst('users', { email: 'admin@studio.local' });
    if (!u) {
      const email = 'admin@studio.local';
      const pwd = 'studio2026';
      await dbInsert('users', { email, password_hash: bcrypt.hashSync(pwd, 10), name: 'Studio' });
      console.log('\n────────────────────────────────────────');
      console.log('  Premier compte personal shopper créé :');
      console.log('  email    :', email);
      console.log('  password :', pwd);
      console.log('  (à changer après la première connexion)');
      console.log('────────────────────────────────────────\n');
    }
  } catch (e) {
    console.error('seed admin error:', e?.message || e);
  }
})();

/* ═══════════════════════════════════════════ */
/*               AUTH SHOPPER                  */
/* ═══════════════════════════════════════════ */
app.post('/api/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'champs requis' });
  const u = await dbFirst('users', { email: email.toLowerCase().trim() });
  if (!u || !bcrypt.compareSync(password, u.password_hash)) {
    return res.status(401).json({ error: 'identifiants invalides' });
  }
  req.session.userId = u.id;
  res.json({ id: u.id, email: u.email, name: u.name });
}));
app.post('/api/auth/signup', ah(async (req, res) => {
  const { email, password, name, studio_name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email et mot de passe requis' });
  if (password.length < 6) return res.status(400).json({ error: 'mot de passe trop court (min 6 caractères)' });
  const normalized = String(email).toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) return res.status(400).json({ error: 'email invalide' });
  const existing = await dbFirst('users', { email: normalized });
  if (existing) return res.status(409).json({ error: 'Cet email a déjà un compte. Connectez-vous.' });
  const u = await dbInsert('users', {
    email: normalized,
    password_hash: bcrypt.hashSync(password, 10),
    name: name || null,
    studio_name: studio_name || null
  });
  req.session.userId = u.id;
  res.json({ id: u.id, email: u.email, name: u.name });
}));
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

const USER_PUBLIC_SELECT = 'id, email, name, studio_name, studio_logo, accent_color, photo_url, bio, portfolio, specialties, years_experience, is_public, public_slug, public_tagline, public_city';

app.get('/api/me', requireAuth, ah(async (req, res) => {
  const u = await dbFirst('users', { id: req.session.userId }, { select: USER_PUBLIC_SELECT });
  res.json(u);
}));
app.put('/api/me/settings', requireAuth, ah(async (req, res) => {
  const f = req.body || {};
  const patch = {};
  for (const k of ['studio_name', 'studio_logo', 'accent_color', 'photo_url', 'bio', 'name',
                   'specialties', 'years_experience', 'public_tagline', 'public_city'])
    if (f[k] !== undefined) patch[k] = f[k] === '' ? null : f[k];
  if (Array.isArray(f.portfolio)) patch.portfolio = f.portfolio.filter(u => u && typeof u === 'string').slice(0, 12);
  if (f.is_public !== undefined) patch.is_public = !!f.is_public;
  // public_slug : généré si demandé et pas déjà défini
  if (f.public_slug !== undefined && f.public_slug.trim()) {
    const slugClean = String(f.public_slug).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    if (slugClean) patch.public_slug = slugClean;
  }
  if (Object.keys(patch).length) {
    try {
      await dbUpdate('users', { id: req.session.userId }, patch);
    } catch (err) {
      if (String(err.message).includes('duplicate') || String(err.code) === '23505') {
        return res.status(409).json({ error: 'Ce slug public est déjà pris.' });
      }
      throw err;
    }
  }
  const u = await dbFirst('users', { id: req.session.userId }, { select: USER_PUBLIC_SELECT });
  res.json(u);
}));
app.put('/api/me/password', requireAuth, ah(async (req, res) => {
  const { current, next } = req.body || {};
  const u = await dbFirst('users', { id: req.session.userId });
  if (!bcrypt.compareSync(current || '', u.password_hash)) return res.status(400).json({ error: 'mot de passe actuel invalide' });
  if (!next || next.length < 6) return res.status(400).json({ error: 'mot de passe trop court (min 6)' });
  await dbUpdate('users', { id: u.id }, { password_hash: bcrypt.hashSync(next, 10) });
  res.json({ ok: true });
}));

/* ═══════════════════════════════════════════ */
/*                  CLIENTS                    */
/* ═══════════════════════════════════════════ */
const ownClient = (userId, clientId) => dbFirst('clients', { id: clientId, user_id: userId }, { select: 'id' });

app.get('/api/clients', requireAuth, ah(async (req, res) => {
  const rows = await dbList('clients', { where: { user_id: req.session.userId }, order: [{ col: 'position', asc: true }, { col: 'created_at', asc: false }] });
  // enrichissement (counts + previews)
  await Promise.all(rows.map(async c => {
    const [items_count, insp_count, likes_count] = await Promise.all([
      sb.from('items').select('id', { count: 'exact', head: true }).eq('client_id', c.id).is('deleted_at', null).then(r => r.count || 0),
      sb.from('inspirations').select('id', { count: 'exact', head: true }).eq('client_id', c.id).then(r => r.count || 0),
      sb.from('items').select('id', { count: 'exact', head: true }).eq('client_id', c.id).eq('liked', true).is('deleted_at', null).then(r => r.count || 0),
    ]);
    c.items_count = items_count;
    c.insp_count = insp_count;
    c.likes_count = likes_count;
    c.tags = Array.isArray(c.tags) ? c.tags : (c.tags || []);
    c.has_password = !!c.password_hash;
    c.is_claimed = !!c.claimed_at;
    c.access_code = codeFromSlug(c.slug);
    delete c.password_hash;
    delete c.magic_token;
    // moodboard preview
    const { data: thumbs } = await sb.from('items')
      .select('image').eq('client_id', c.id).is('deleted_at', null)
      .not('image', 'is', null).order('position').limit(8);
    c.preview = (thumbs || []).filter(t => t.image).map(t => t.image);
    if (!c.preview.length) {
      const { data: ins } = await sb.from('inspirations')
        .select('main_image').eq('client_id', c.id).not('main_image', 'is', null)
        .order('position').limit(1);
      if (ins?.[0]?.main_image) c.preview = [ins[0].main_image];
    }
  }));
  res.json(rows);
}));

app.post('/api/clients', requireAuth, ah(async (req, res) => {
  const { name, note } = req.body || {};
  if (!name) return res.status(400).json({ error: 'nom requis' });
  const slug = nanoid(8).toLowerCase();
  const c = await dbInsert('clients', { user_id: req.session.userId, slug, name, note: note || null });
  res.json(c);
}));

app.put('/api/clients/reorder', requireAuth, ah(async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids requis' });
  await Promise.all(ids.map((id, i) =>
    sb.from('clients').update({ position: i + 1 }).eq('id', id).eq('user_id', req.session.userId)
  ));
  res.json({ ok: true });
}));

app.put('/api/clients/:id/tags', requireAuth, ah(async (req, res) => {
  const c = await ownClient(req.session.userId, req.params.id);
  if (!c) return res.sendStatus(404);
  const tags = Array.isArray(req.body?.tags) ? req.body.tags : [];
  const clean = tags.filter(t => t && t.label).map(t => ({
    label: String(t.label).slice(0, 30),
    color: /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : '#b8915a'
  }));
  await dbUpdate('clients', { id: c.id }, { tags: clean });
  res.json({ tags: clean });
}));

app.put('/api/clients/:id', requireAuth, ah(async (req, res) => {
  const c = await dbFirst('clients', { id: req.params.id, user_id: req.session.userId });
  if (!c) return res.sendStatus(404);
  const f = req.body || {};
  const patch = {};
  for (const k of ['name', 'note', 'welcome_message', 'photo_url', 'status', 'birthday', 'last_contact_at', 'next_action', 'next_action_at'])
    if (f[k] !== undefined) patch[k] = f[k] || null;
  if (Object.keys(patch).length) await dbUpdate('clients', { id: c.id }, patch);
  const updated = await dbFirst('clients', { id: c.id });
  res.json(updated);
}));

app.delete('/api/clients/:id', requireAuth, ah(async (req, res) => {
  await sb.from('clients').delete().eq('id', req.params.id).eq('user_id', req.session.userId);
  res.json({ ok: true });
}));

/* ─── Profil client (mensurations + préférences) ─── */
app.get('/api/clients/:id/profile', requireAuth, ah(async (req, res) => {
  const c = await dbFirst('clients', { id: req.params.id, user_id: req.session.userId });
  if (!c) return res.sendStatus(404);
  res.json({
    profile: c.profile_json || null,
    filled_by: c.profile_filled_by,
    welcome_message: c.welcome_message,
    photo_url: c.photo_url
  });
}));
app.put('/api/clients/:id/profile', requireAuth, ah(async (req, res) => {
  const c = await ownClient(req.session.userId, req.params.id);
  if (!c) return res.sendStatus(404);
  await dbUpdate('clients', { id: c.id }, {
    profile_json: req.body?.profile || {},
    profile_filled_by: 'shopper'
  });
  res.json({ ok: true });
}));

/* ═══════════════════════════════════════════ */
/*                   ITEMS                     */
/* ═══════════════════════════════════════════ */
function priceToAmount(price) {
  if (!price) return { amount: null, currency: null };
  const m = String(price).match(/([A-Z€$£¥]{1,3})?\s*([\d.,]+)\s*([A-Z€$£¥]{1,3})?/i);
  if (!m) return { amount: null, currency: null };
  return {
    currency: (m[1] || m[3] || '').toUpperCase() || null,
    amount: parseFloat(m[2].replace(/,/g, '.')) || null
  };
}

app.get('/api/clients/:id/items', requireAuth, ah(async (req, res) => {
  if (!await ownClient(req.session.userId, req.params.id)) return res.sendStatus(404);
  let q = sb.from('items').select('*').eq('client_id', req.params.id).order('position').order('id');
  if (req.query.deleted !== '1') q = q.is('deleted_at', null);
  const { data, error } = await q;
  if (error) throw error;
  const items = data || [];
  if (items.length) {
    const ids = items.map(i => i.id);
    const { data: links } = await sb.from('item_folders').select('item_id, folder_id').in('item_id', ids);
    const byItem = new Map();
    (links || []).forEach(l => { if (!byItem.has(l.item_id)) byItem.set(l.item_id, []); byItem.get(l.item_id).push(l.folder_id); });
    items.forEach(it => { it.folder_ids = byItem.get(it.id) || []; });
  }
  res.json(items);
}));

// ─── Folders ───
app.get('/api/clients/:id/moodboard', requireAuth, ah(async (req, res) => {
  if (!await ownClient(req.session.userId, req.params.id)) return res.sendStatus(404);
  const rows = await dbList('client_moodboard', { where: { client_id: req.params.id }, order: [{ col: 'position', asc: true }, { col: 'id', asc: false }] });
  res.json(rows || []);
}));
app.delete('/api/clients/:id/moodboard/:mid', requireAuth, ah(async (req, res) => {
  if (!await ownClient(req.session.userId, req.params.id)) return res.sendStatus(404);
  await dbDelete('client_moodboard', { id: req.params.mid, client_id: req.params.id });
  res.json({ ok: true });
}));
app.get('/api/clients/:id/folders', requireAuth, ah(async (req, res) => {
  if (!await ownClient(req.session.userId, req.params.id)) return res.sendStatus(404);
  const rows = await dbList('folders', { where: { client_id: req.params.id }, order: [{ col: 'position', asc: true }, { col: 'created_at', asc: true }] });
  res.json(rows || []);
}));
app.post('/api/clients/:id/folders', requireAuth, ah(async (req, res) => {
  if (!await ownClient(req.session.userId, req.params.id)) return res.sendStatus(404);
  const { name, kind, date_from, date_to, description } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name requis' });
  const max = await dbMaxPos('folders', { client_id: req.params.id });
  const f = await dbInsert('folders', { client_id: req.params.id, name: name.trim(), kind: kind || null, date_from: date_from || null, date_to: date_to || null, description: description || null, position: max + 1 });
  res.json(f);
}));
async function getFolderForUser(userId, folderId) {
  const f = await dbFirst('folders', { id: folderId });
  if (!f) return null;
  const c = await dbFirst('clients', { id: f.client_id, user_id: userId }, { select: 'id' });
  return c ? f : null;
}
app.put('/api/folders/:id', requireAuth, ah(async (req, res) => {
  const f = await getFolderForUser(req.session.userId, req.params.id);
  if (!f) return res.sendStatus(404);
  const patch = {};
  for (const k of ['name', 'kind', 'date_from', 'date_to', 'description', 'position'])
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  const updated = await dbUpdate('folders', { id: f.id }, patch);
  res.json(updated);
}));
app.delete('/api/folders/:id', requireAuth, ah(async (req, res) => {
  const f = await getFolderForUser(req.session.userId, req.params.id);
  if (!f) return res.sendStatus(404);
  await dbDelete('folders', { id: f.id });
  res.json({ ok: true });
}));
app.put('/api/items/:id/folders', requireAuth, ah(async (req, res) => {
  const it = await getItemForUser(req.session.userId, req.params.id);
  if (!it) return res.sendStatus(404);
  const ids = Array.isArray(req.body?.folder_ids) ? req.body.folder_ids.map(Number).filter(Boolean) : [];
  await sb.from('item_folders').delete().eq('item_id', it.id);
  if (ids.length) {
    const rows = ids.map(folder_id => ({ item_id: it.id, folder_id }));
    await sb.from('item_folders').insert(rows);
  }
  res.json({ ok: true, folder_ids: ids });
}));

app.post('/api/clients/:id/items', requireAuth, ah(async (req, res) => {
  if (!await ownClient(req.session.userId, req.params.id)) return res.sendStatus(404);
  const { cat, brand, name, price, link, image, description, images } = req.body || {};
  const max = await dbMaxPos('items', { client_id: req.params.id });
  const { amount, currency } = priceToAmount(price);
  const imgs = Array.isArray(images) ? images.filter(Boolean) : [];
  const it = await dbInsert('items', {
    client_id: req.params.id, cat, brand, name, price, link,
    image: image || imgs[0] || null, images: imgs, description,
    position: max + 1, amount, currency, updated_at: new Date().toISOString()
  });
  await dbInsert('notifications', {
    client_id: +req.params.id, kind: 'new_item', ref_id: it.id,
    title: 'Nouvelle pièce ajoutée', body: `${brand || ''} ${name || ''}`.trim()
  });
  res.json(it);
}));

async function getItemForUser(userId, itemId) {
  const it = await dbFirst('items', { id: itemId });
  if (!it) return null;
  const c = await dbFirst('clients', { id: it.client_id, user_id: userId }, { select: 'id' });
  return c ? it : null;
}

app.put('/api/items/:id', requireAuth, ah(async (req, res) => {
  const it = await getItemForUser(req.session.userId, req.params.id);
  if (!it) return res.sendStatus(404);
  const f = req.body || {};
  const { amount, currency } = priceToAmount(f.price !== undefined ? f.price : it.price);
  const patch = { amount, currency, updated_at: new Date().toISOString() };
  for (const k of ['cat', 'brand', 'name', 'price', 'link', 'image', 'description'])
    if (f[k] !== undefined) patch[k] = f[k];
  if (Array.isArray(f.images)) {
    patch.images = f.images.filter(Boolean);
    if (!patch.image) patch.image = patch.images[0] || null;
  }
  const updated = await dbUpdate('items', { id: it.id }, patch);
  res.json(updated);
}));

app.delete('/api/items/:id', requireAuth, ah(async (req, res) => {
  const it = await getItemForUser(req.session.userId, req.params.id);
  if (!it) return res.sendStatus(404);
  if (req.query.hard === '1') await dbDelete('items', { id: it.id });
  else await dbUpdate('items', { id: it.id }, { deleted_at: new Date().toISOString() });
  res.json({ ok: true });
}));
app.post('/api/items/:id/restore', requireAuth, ah(async (req, res) => {
  const it = await getItemForUser(req.session.userId, req.params.id);
  if (!it) return res.sendStatus(404);
  await dbUpdate('items', { id: it.id }, { deleted_at: null });
  res.json({ ok: true });
}));

app.put('/api/items/:id/status', requireAuth, ah(async (req, res) => {
  const it = await getItemForUser(req.session.userId, req.params.id);
  if (!it) return res.sendStatus(404);
  const allowed = ['proposed', 'validated', 'bought', 'rejected', null, ''];
  const s = req.body?.status;
  if (!allowed.includes(s)) return res.status(400).json({ error: 'statut invalide' });
  await dbUpdate('items', { id: it.id }, { item_status: s || null, updated_at: new Date().toISOString() });
  res.json({ ok: true });
}));

/* ═══════════════════════════════════════════ */
/*               INSPIRATIONS                  */
/* ═══════════════════════════════════════════ */
async function buildInspiration(id) {
  const ins = await dbFirst('inspirations', { id });
  if (!ins) return null;
  const pieces = await dbList('pieces', { where: { inspiration_id: id }, order: [{ col: 'position', asc: true }, { col: 'id', asc: true }] });
  await Promise.all(pieces.map(async p => {
    p.refs = await dbList('refs', { where: { piece_id: p.id }, order: [{ col: 'position', asc: true }, { col: 'id', asc: true }] });
  }));
  ins.pieces = pieces;
  return ins;
}

app.get('/api/clients/:id/inspirations', requireAuth, ah(async (req, res) => {
  if (!await ownClient(req.session.userId, req.params.id)) return res.sendStatus(404);
  const list = await dbList('inspirations', { where: { client_id: req.params.id }, order: [{ col: 'position', asc: true }, { col: 'id', asc: true }] });
  res.json(await Promise.all(list.map(i => buildInspiration(i.id))));
}));
app.post('/api/clients/:id/inspirations', requireAuth, ah(async (req, res) => {
  if (!await ownClient(req.session.userId, req.params.id)) return res.sendStatus(404);
  const { title, main_image } = req.body || {};
  const max = await dbMaxPos('inspirations', { client_id: req.params.id });
  const ins = await dbInsert('inspirations', { client_id: +req.params.id, title, main_image, position: max + 1 });
  await dbInsert('notifications', {
    client_id: +req.params.id, kind: 'new_inspiration', ref_id: ins.id,
    title: 'Nouvelle inspiration', body: title || 'Nouveau look'
  });
  res.json(await buildInspiration(ins.id));
}));

async function getInspForUser(userId, inspId) {
  const ins = await dbFirst('inspirations', { id: inspId });
  if (!ins) return null;
  const c = await dbFirst('clients', { id: ins.client_id, user_id: userId }, { select: 'id' });
  return c ? ins : null;
}

app.put('/api/inspirations/:id', requireAuth, ah(async (req, res) => {
  const ins = await getInspForUser(req.session.userId, req.params.id);
  if (!ins) return res.sendStatus(404);
  const { title, main_image } = req.body || {};
  const patch = {};
  if (title !== undefined) patch.title = title;
  if (main_image !== undefined) patch.main_image = main_image;
  if (Object.keys(patch).length) await dbUpdate('inspirations', { id: ins.id }, patch);
  res.json(await buildInspiration(ins.id));
}));
app.delete('/api/inspirations/:id', requireAuth, ah(async (req, res) => {
  const ins = await getInspForUser(req.session.userId, req.params.id);
  if (!ins) return res.sendStatus(404);
  await dbDelete('inspirations', { id: ins.id });
  res.json({ ok: true });
}));

/* ─── Templates ─── */
app.get('/api/templates', requireAuth, ah(async (req, res) => {
  // sub-select : on récup les clients du user, puis les inspirations templates
  const myClients = await dbList('clients', { where: { user_id: req.session.userId }, select: 'id' });
  if (!myClients.length) return res.json([]);
  const { data: insps, error } = await sb.from('inspirations')
    .select('*').in('client_id', myClients.map(c => c.id)).eq('is_template', true).order('id', { ascending: false });
  if (error) throw error;
  res.json(await Promise.all((insps || []).map(i => buildInspiration(i.id))));
}));
app.put('/api/inspirations/:id/template', requireAuth, ah(async (req, res) => {
  const ins = await getInspForUser(req.session.userId, req.params.id);
  if (!ins) return res.sendStatus(404);
  const flag = !!req.body?.is_template;
  await dbUpdate('inspirations', { id: ins.id }, { is_template: flag });
  res.json({ ok: true, is_template: flag });
}));
app.post('/api/templates/:id/apply', requireAuth, ah(async (req, res) => {
  const ins = await getInspForUser(req.session.userId, req.params.id);
  if (!ins) return res.sendStatus(404);
  const targetClientId = req.body?.client_id;
  if (!await ownClient(req.session.userId, targetClientId)) return res.status(400).json({ error: 'client cible invalide' });
  await cloneInspiration(ins, targetClientId, ins.title);
  res.json({ ok: true });
}));
app.post('/api/inspirations/:id/duplicate', requireAuth, ah(async (req, res) => {
  const ins = await getInspForUser(req.session.userId, req.params.id);
  if (!ins) return res.sendStatus(404);
  const newId = await cloneInspiration(ins, ins.client_id, (ins.title || 'Look') + ' (copie)');
  res.json({ id: newId });
}));

async function cloneInspiration(srcIns, targetClientId, title) {
  const max = await dbMaxPos('inspirations', { client_id: targetClientId });
  const newIns = await dbInsert('inspirations', {
    client_id: targetClientId, title, main_image: srcIns.main_image, position: max + 1, is_template: false
  });
  const pieces = await dbList('pieces', { where: { inspiration_id: srcIns.id }, order: 'position' });
  for (const p of pieces) {
    const np = await dbInsert('pieces', {
      inspiration_id: newIns.id, label: p.label, anchor_x: p.anchor_x, anchor_y: p.anchor_y, position: p.position
    });
    const refs = await dbList('refs', { where: { piece_id: p.id }, order: 'position' });
    for (const r of refs) {
      await dbInsert('refs', {
        piece_id: np.id, brand: r.brand, name: r.name, link: r.link, image: r.image, position: r.position
      });
    }
  }
  return newIns.id;
}

/* ═══════════════════════════════════════════ */
/*              PIECES + REFS                  */
/* ═══════════════════════════════════════════ */
async function getPieceForUser(userId, pieceId) {
  const p = await dbFirst('pieces', { id: pieceId });
  if (!p) return null;
  if (!await getInspForUser(userId, p.inspiration_id)) return null;
  return p;
}
async function getRefForUser(userId, refId) {
  const r = await dbFirst('refs', { id: refId });
  if (!r) return null;
  if (!await getPieceForUser(userId, r.piece_id)) return null;
  return r;
}

app.post('/api/inspirations/:id/pieces', requireAuth, ah(async (req, res) => {
  const ins = await getInspForUser(req.session.userId, req.params.id);
  if (!ins) return res.sendStatus(404);
  const { label, anchor_x, anchor_y } = req.body || {};
  const max = await dbMaxPos('pieces', { inspiration_id: ins.id });
  const p = await dbInsert('pieces', {
    inspiration_id: ins.id, label, anchor_x: anchor_x ?? 50, anchor_y: anchor_y ?? 50, position: max + 1
  });
  res.json(p);
}));
app.put('/api/pieces/:id', requireAuth, ah(async (req, res) => {
  const p = await getPieceForUser(req.session.userId, req.params.id);
  if (!p) return res.sendStatus(404);
  const f = req.body || {};
  const patch = {};
  for (const k of ['label', 'anchor_x', 'anchor_y']) if (f[k] !== undefined) patch[k] = f[k];
  if (Object.keys(patch).length) await dbUpdate('pieces', { id: p.id }, patch);
  const updated = await dbFirst('pieces', { id: p.id });
  res.json(updated);
}));
app.delete('/api/pieces/:id', requireAuth, ah(async (req, res) => {
  const p = await getPieceForUser(req.session.userId, req.params.id);
  if (!p) return res.sendStatus(404);
  await dbDelete('pieces', { id: p.id });
  res.json({ ok: true });
}));

app.post('/api/pieces/:id/refs', requireAuth, ah(async (req, res) => {
  const p = await getPieceForUser(req.session.userId, req.params.id);
  if (!p) return res.sendStatus(404);
  const { brand, name, link, image } = req.body || {};
  const max = await dbMaxPos('refs', { piece_id: p.id });
  const r = await dbInsert('refs', { piece_id: p.id, brand, name, link, image, position: max + 1 });
  res.json(r);
}));
app.put('/api/refs/:id', requireAuth, ah(async (req, res) => {
  const r = await getRefForUser(req.session.userId, req.params.id);
  if (!r) return res.sendStatus(404);
  const f = req.body || {};
  const patch = {};
  for (const k of ['brand', 'name', 'link', 'image']) if (f[k] !== undefined) patch[k] = f[k];
  if (Object.keys(patch).length) await dbUpdate('refs', { id: r.id }, patch);
  const updated = await dbFirst('refs', { id: r.id });
  res.json(updated);
}));
app.delete('/api/refs/:id', requireAuth, ah(async (req, res) => {
  const r = await getRefForUser(req.session.userId, req.params.id);
  if (!r) return res.sendStatus(404);
  await dbDelete('refs', { id: r.id });
  res.json({ ok: true });
}));

/* ═══════════════════════════════════════════ */
/*               UPLOADS                       */
/* ═══════════════════════════════════════════ */
app.post('/api/upload', requireAuth, upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'aucun fichier' });
  const url = await uploadToSupabase(req.file);
  res.json({ url });
}));
app.post('/api/upload/multi', requireAuth, upload.array('files', 10), ah(async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'aucun fichier' });
  const urls = await Promise.all(req.files.map(uploadToSupabase));
  res.json({ urls });
}));
app.post('/api/public/:slug/upload', upload.single('file'), ah(async (req, res) => {
  const c = await dbFirst('clients', { slug: req.params.slug }, { select: 'id' });
  if (!c) return res.sendStatus(404);
  if (!req.file) return res.status(400).json({ error: 'aucun fichier' });
  const url = await uploadToSupabase(req.file);
  res.json({ url });
}));

/* ─── Moodboard client ─── */
app.get('/api/public/:slug/moodboard', ah(async (req, res) => {
  const c = await dbFirst('clients', { slug: req.params.slug }, { select: 'id' });
  if (!c) return res.sendStatus(404);
  const rows = await dbList('client_moodboard', { where: { client_id: c.id }, order: [{ col: 'position', asc: true }, { col: 'id', asc: false }] });
  res.json(rows || []);
}));
app.post('/api/public/:slug/moodboard', ah(async (req, res) => {
  const c = await dbFirst('clients', { slug: req.params.slug }, { select: 'id' });
  if (!c) return res.sendStatus(404);
  const { image_url, caption } = req.body || {};
  if (!image_url) return res.status(400).json({ error: 'image_url requise' });
  const max = await dbMaxPos('client_moodboard', { client_id: c.id });
  const row = await dbInsert('client_moodboard', { client_id: c.id, image_url, caption: caption || null, position: max + 1 });
  res.json(row);
}));
app.post('/api/public/:slug/moodboard/from-url', ah(async (req, res) => {
  const c = await dbFirst('clients', { slug: req.params.slug }, { select: 'id' });
  if (!c) return res.sendStatus(404);
  const url = (req.body?.url || '').toString().trim();
  if (!url) return res.status(400).json({ error: 'url requise' });
  let imageUrl = '';
  if (/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url)) {
    imageUrl = url;
  } else {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }, redirect: 'follow' });
      const html = await r.text();
      const meta = (...names) => {
        for (const n of names) {
          const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*content=["']([^"']*)["']`, 'i');
          const m = html.match(re); if (m && m[1]) return m[1].trim();
        }
        return '';
      };
      imageUrl = meta('og:image', 'og:image:secure_url', 'twitter:image');
    } catch {}
    if (!imageUrl) {
      try {
        const proxy = await fetch('https://r.jina.ai/' + url, { headers: { 'Accept': 'text/plain' } });
        if (proxy.ok) {
          const md = await proxy.text();
          const m = md.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/);
          if (m) imageUrl = m[1];
        }
      } catch {}
    }
  }
  if (!imageUrl) return res.status(422).json({ error: 'Image introuvable depuis cette URL.' });
  const max = await dbMaxPos('client_moodboard', { client_id: c.id });
  const row = await dbInsert('client_moodboard', { client_id: c.id, image_url: imageUrl, caption: url, position: max + 1 });
  res.json(row);
}));
app.delete('/api/public/:slug/moodboard/:id', ah(async (req, res) => {
  const c = await dbFirst('clients', { slug: req.params.slug }, { select: 'id' });
  if (!c) return res.sendStatus(404);
  const row = await dbFirst('client_moodboard', { id: req.params.id });
  if (!row || row.client_id !== c.id) return res.sendStatus(404);
  await dbDelete('client_moodboard', { id: row.id });
  res.json({ ok: true });
}));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

/* ═══════════════════════════════════════════ */
/*      NOTIFICATIONS + EVENTS + HEATMAP       */
/* ═══════════════════════════════════════════ */
app.get('/api/clients/:id/notifications', requireAuth, ah(async (req, res) => {
  if (!await ownClient(req.session.userId, req.params.id)) return res.sendStatus(404);
  const { data, error } = await sb.from('notifications').select('*').eq('client_id', req.params.id).order('id', { ascending: false }).limit(50);
  if (error) throw error;
  res.json(data || []);
}));
app.post('/api/public/:slug/event', ah(async (req, res) => {
  const c = await dbFirst('clients', { slug: req.params.slug }, { select: 'id' });
  if (!c) return res.sendStatus(404);
  const { kind, target_id, x, y, duration_ms, meta } = req.body || {};
  await dbInsert('events', {
    client_id: c.id, kind: kind || 'unknown', target_id: target_id || null,
    x: x ?? null, y: y ?? null, duration_ms: duration_ms ?? null, meta: meta || null
  });
  if (kind === 'view_page') {
    await dbUpdate('clients', { id: c.id }, { last_viewed_at: new Date().toISOString() });
  }
  res.json({ ok: true });
}));
app.post('/api/public/:slug/notifications/read', ah(async (req, res) => {
  const c = await dbFirst('clients', { slug: req.params.slug }, { select: 'id' });
  if (!c) return res.sendStatus(404);
  await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('client_id', c.id).is('read_at', null);
  res.json({ ok: true });
}));

app.get('/api/inspirations/:id/heatmap', requireAuth, ah(async (req, res) => {
  const ins = await getInspForUser(req.session.userId, req.params.id);
  if (!ins) return res.sendStatus(404);
  const { data, error } = await sb.from('events')
    .select('x, y').eq('target_id', ins.id).in('kind', ['click_hotspot', 'click_image']);
  if (error) throw error;
  // agrégation côté serveur
  const map = new Map();
  (data || []).forEach(e => {
    if (e.x == null || e.y == null) return;
    const key = `${Math.round(e.x * 10) / 10},${Math.round(e.y * 10) / 10}`;
    map.set(key, (map.get(key) || 0) + 1);
  });
  res.json([...map.entries()].map(([k, w]) => {
    const [x, y] = k.split(',').map(Number);
    return { x, y, w };
  }));
}));

/* ═══════════════════════════════════════════ */
/*               DASHBOARD                     */
/* ═══════════════════════════════════════════ */
app.get('/api/dashboard', requireAuth, ah(async (req, res) => {
  const userId = req.session.userId;
  const myClients = await dbList('clients', { where: { user_id: userId }, select: 'id, name, slug, last_viewed_at, status, birthday, next_action, next_action_at' });
  const clientIds = myClients.map(c => c.id);

  if (!clientIds.length) {
    return res.json({
      clients_count: 0, items_count: 0, revenue_estimated: 0,
      top_brands: [], top_cats: [], events: {},
      dormant_clients: [], upcoming_birthdays: [], actions: []
    });
  }

  // Items pour aggregation
  const { data: items } = await sb.from('items').select('brand, cat, amount').in('client_id', clientIds).is('deleted_at', null);
  const allItems = items || [];

  // Events pour stats
  const { data: events } = await sb.from('events').select('kind').in('client_id', clientIds);
  const eventsMap = {};
  (events || []).forEach(e => { eventsMap[e.kind] = (eventsMap[e.kind] || 0) + 1; });

  // Top brands + cats (agrégation en JS)
  const topBrands = aggregate(allItems, 'brand');
  const topCats   = aggregate(allItems, 'cat');

  // Revenue
  const revenue = Math.round(allItems.reduce((s, i) => s + (Number(i.amount) || 0), 0));

  // Clients dormants
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const dormant = myClients
    .filter(c => !c.last_viewed_at || c.last_viewed_at < thirtyDaysAgo)
    .sort((a, b) => (a.last_viewed_at || '').localeCompare(b.last_viewed_at || ''))
    .slice(0, 10);

  // Anniversaires
  const today = new Date();
  const upcomingBirthdays = myClients
    .filter(c => c.birthday)
    .map(c => {
      const [, m, d] = (c.birthday || '').split('-');
      if (!m || !d) return null;
      const next = new Date(today.getFullYear(), parseInt(m) - 1, parseInt(d));
      if (next < today) next.setFullYear(today.getFullYear() + 1);
      const days = Math.round((next - today) / 86400000);
      return { id: c.id, name: c.name, birthday: c.birthday, in_days: days };
    })
    .filter(Boolean).filter(b => b.in_days <= 30).sort((a, b) => a.in_days - b.in_days);

  // Actions
  const actions = myClients
    .filter(c => c.next_action)
    .sort((a, b) => (a.next_action_at || '').localeCompare(b.next_action_at || ''))
    .slice(0, 20)
    .map(c => ({ id: c.id, name: c.name, next_action: c.next_action, next_action_at: c.next_action_at }));

  res.json({
    clients_count: myClients.length,
    items_count: allItems.length,
    revenue_estimated: revenue,
    top_brands: topBrands,
    top_cats: topCats,
    events: eventsMap,
    dormant_clients: dormant,
    upcoming_birthdays: upcomingBirthdays,
    actions
  });
}));

function aggregate(arr, key) {
  const map = new Map();
  arr.forEach(r => {
    const v = r[key];
    if (!v) return;
    map.set(v, (map.get(v) || 0) + 1);
  });
  return [...map.entries()].map(([k, n]) => ({ [key]: k, n })).sort((a, b) => b.n - a.n).slice(0, 10);
}

/* ═══════════════════════════════════════════ */
/*              RAPPORT CLIENT                 */
/* ═══════════════════════════════════════════ */
app.get('/api/clients/:id/report', requireAuth, ah(async (req, res) => {
  const c = await dbFirst('clients', { id: req.params.id, user_id: req.session.userId });
  if (!c) return res.sendStatus(404);
  const [items, insps, eventsArr] = await Promise.all([
    dbList('items', { where: { client_id: c.id }, is: { deleted_at: null }, order: 'position' }),
    dbList('inspirations', { where: { client_id: c.id }, order: 'position' }),
    dbList('events', { where: { client_id: c.id }, select: 'kind, target_id' })
  ]);
  const eventsMap = {};
  eventsArr.forEach(e => { eventsMap[e.kind] = (eventsMap[e.kind] || 0) + 1; });

  // top items cliqués
  const clickMap = new Map();
  eventsArr.filter(e => e.kind === 'click_item' && e.target_id).forEach(e =>
    clickMap.set(e.target_id, (clickMap.get(e.target_id) || 0) + 1));
  const sortedIds = [...clickMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
  let topItems = [];
  if (sortedIds.length) {
    const { data } = await sb.from('items').select('id, brand, name, image').in('id', sortedIds);
    topItems = (data || []).map(it => ({ ...it, clicks: clickMap.get(it.id) || 0 }))
      .sort((a, b) => b.clicks - a.clicks);
  }

  const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const user = await dbFirst('users', { id: c.user_id }, { select: 'studio_name, name, photo_url' });
  const studioName = (user.studio_name || 'STUDIO').toUpperCase();

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Rapport — ${esc(c.name)}</title>
<link rel="stylesheet" href="/css/style.css">
<style>
  body { background: #fff; }
  .report { max-width: 880px; margin: 40px auto; padding: 0 32px 80px; }
  .report header { border-bottom: 1px solid var(--hairline); padding-bottom: 24px; margin-bottom: 32px; display:flex; justify-content:space-between; align-items:flex-end; }
  .report h1 { font-family:'Cormorant Garamond',serif; font-weight:400; font-size:42px; }
  .report h2 { font-family:'Cormorant Garamond',serif; font-weight:400; font-size:24px; margin: 32px 0 14px; padding-bottom:8px; border-bottom: 1px solid var(--hairline); }
  .stats { display:grid; grid-template-columns: repeat(4,1fr); gap:14px; }
  .stat { background:var(--bg-soft); padding:18px; border:1px solid var(--hairline); }
  .stat .v { font-family:'Cormorant Garamond',serif; font-size:28px; }
  .stat .l { font-size:10px; letter-spacing:0.16em; text-transform:uppercase; color:var(--muted); margin-top:4px; }
  .igrid { display:grid; grid-template-columns: repeat(3,1fr); gap:16px; }
  .icard { border:1px solid var(--hairline); padding:10px; }
  .icard .thumb { aspect-ratio:1/1; background:var(--visual); margin-bottom:8px; overflow:hidden; position:relative; }
  .icard .thumb img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .icard .b { font-size:11px; letter-spacing:0.14em; text-transform:uppercase; font-weight:600; }
  .icard .n { font-family:'Cormorant Garamond',serif; font-size:14px; color:var(--ink-soft); margin-top:2px; }
  .icard .p { font-family:'Cormorant Garamond',serif; font-size:13px; margin-top:4px; }
  .print { position: fixed; top: 16px; right: 16px; z-index: 10; }
  @media print { .print { display:none; } body { background:#fff; } .report { margin:0; max-width:none; } }
</style></head><body>
<button class="btn print" onclick="window.print()">⎙ Imprimer / PDF</button>
<div class="report">
  <header>
    <div>
      <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:var(--muted);">Rapport mensuel</div>
      <h1>${esc(c.name)}</h1>
      <div style="font-style:italic;color:var(--muted);font-family:'Cormorant Garamond',serif;margin-top:4px;">${today}</div>
    </div>
    <div style="text-align:right;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;">
      ${esc(studioName)}<br>
      <span style="font-style:italic;text-transform:none;letter-spacing:0;font-family:'Cormorant Garamond',serif;color:var(--muted);">${esc(user.name || '')}</span>
    </div>
  </header>
  <div class="stats">
    <div class="stat"><div class="v">${items.length}</div><div class="l">Pièces actives</div></div>
    <div class="stat"><div class="v">${insps.length}</div><div class="l">Inspirations</div></div>
    <div class="stat"><div class="v">${eventsMap.view_page || 0}</div><div class="l">Visites</div></div>
    <div class="stat"><div class="v">${Math.round(total).toLocaleString('fr-CH')}</div><div class="l">Valeur estimée</div></div>
  </div>
  <h2>Pièces les plus consultées</h2>
  <div class="igrid">
    ${topItems.length ? topItems.map(i => `
      <div class="icard">
        <div class="thumb">${i.image ? `<img src="${esc(i.image)}">` : ''}</div>
        <div class="b">${esc(i.brand || '')}</div>
        <div class="n">${esc(i.name || '')}</div>
        <div class="p"><em>${i.clicks} clic${i.clicks > 1 ? 's' : ''}</em></div>
      </div>`).join('') : '<div style="grid-column:1/-1;font-style:italic;color:var(--muted);font-family:\'Cormorant Garamond\',serif;">Aucun clic enregistré.</div>'}
  </div>
  <h2>Sélection complète</h2>
  <div class="igrid">
    ${items.map(i => `
      <div class="icard">
        <div class="thumb">${i.image ? `<img src="${esc(i.image)}">` : ''}</div>
        <div class="b">${esc(i.brand || '')}</div>
        <div class="n">${esc(i.name || '')}</div>
        <div class="p">${esc(i.price || '')}</div>
      </div>`).join('') || '<div style="grid-column:1/-1;font-style:italic;color:var(--muted);">Aucune pièce.</div>'}
  </div>
</div>
</body></html>`);
}));

/* ═══════════════════════════════════════════ */
/*               AUTH CLIENT                   */
/* ═══════════════════════════════════════════ */
async function clientFromSession(req) {
  if (!req.session?.clientId) return null;
  return await dbFirst('clients', { id: req.session.clientId });
}

app.post('/api/clients/:id/invite', requireAuth, ah(async (req, res) => {
  const c = await dbFirst('clients', { id: req.params.id, user_id: req.session.userId });
  if (!c) return res.sendStatus(404);
  const email = req.body?.email || c.email;
  if (!email) return res.status(400).json({ error: 'email requis' });
  const token = nanoid(40);
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  await dbUpdate('clients', { id: c.id }, {
    email: email.toLowerCase().trim(), magic_token: token, magic_expires: expires
  });
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const url = `${proto}://${host}/c/auth/magic/${token}`;
  console.log(`\n📩 Lien magique pour ${email} :\n   ${url}\n`);
  res.json({ ok: true, url, email, expires });
}));

app.get('/c/auth/magic/:token', ah(async (req, res) => {
  const c = await dbFirst('clients', { magic_token: req.params.token });
  if (!c) return res.status(401).send('<p style="font-family:sans-serif;padding:60px;text-align:center;">Lien invalide ou déjà utilisé.</p>');
  if (c.magic_expires && new Date(c.magic_expires) < new Date()) {
    return res.status(401).send('<p style="font-family:sans-serif;padding:60px;text-align:center;">Lien expiré. Demandez-en un nouveau via la page de connexion.</p>');
  }
  req.session.clientId = c.id;
  const now = new Date().toISOString();
  await dbUpdate('clients', { id: c.id }, {
    claimed_at: c.claimed_at || now, last_login_at: now,
    magic_token: null, magic_expires: null
  });
  res.redirect(`/c/${c.slug}`);
}));

app.post('/c/auth/magic-link', ah(async (req, res) => {
  const email = (req.body?.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'email requis' });
  const c = await dbFirst('clients', { email }, { select: 'id, slug' });
  if (c) {
    const token = nanoid(40);
    const expires = new Date(Date.now() + 1000 * 60 * 30).toISOString();
    await dbUpdate('clients', { id: c.id }, { magic_token: token, magic_expires: expires });
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const url = `${proto}://${host}/c/auth/magic/${token}`;
    console.log(`\n📩 Magic link pour ${email} :\n   ${url}\n`);
  }
  res.json({ ok: true });
}));

app.post('/c/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email + mot de passe requis' });
  const c = await dbFirst('clients', { email: email.toLowerCase().trim() });
  if (!c || !c.password_hash || !bcrypt.compareSync(password, c.password_hash)) {
    return res.status(401).json({ error: 'identifiants invalides' });
  }
  req.session.clientId = c.id;
  const now = new Date().toISOString();
  await dbUpdate('clients', { id: c.id }, {
    last_login_at: now, claimed_at: c.claimed_at || now
  });
  res.json({ ok: true, slug: c.slug });
}));

app.post('/c/auth/logout', (req, res) => { delete req.session.clientId; res.json({ ok: true }); });

app.post('/c/auth/set-password', ah(async (req, res) => {
  const c = await clientFromSession(req);
  if (!c) return res.status(401).json({ error: 'non connecté' });
  const { password, current } = req.body || {};
  if (!password || password.length < 6) return res.status(400).json({ error: 'mot de passe trop court (min 6)' });
  if (c.password_hash) {
    if (!current || !bcrypt.compareSync(current, c.password_hash)) {
      return res.status(400).json({ error: 'mot de passe actuel invalide' });
    }
  }
  await dbUpdate('clients', { id: c.id }, { password_hash: bcrypt.hashSync(password, 10) });
  res.json({ ok: true });
}));

app.get('/c/auth/me', ah(async (req, res) => {
  const c = await clientFromSession(req);
  if (!c) return res.json({ logged: false });
  res.json({
    logged: true,
    id: c.id, slug: c.slug, name: c.name, email: c.email,
    has_password: !!c.password_hash
  });
}));

/* ═══════════════════════════════════════════ */
/*           MARKETPLACE PUBLIQUE              */
/* ═══════════════════════════════════════════ */
const SHOPPER_PUBLIC_FIELDS = 'id, name, studio_name, studio_logo, accent_color, photo_url, bio, portfolio, specialties, years_experience, public_slug, public_tagline, public_city';

/* ─── Fil d'actualité mode (RSS, cache 30 min) ─── */
const FASHION_FEEDS = [
  { source: 'Hypebeast', url: 'https://hypebeast.com/feed' },
  { source: 'Vogue',     url: 'https://www.vogue.com/feed/rss' },
  { source: 'BoF',       url: 'https://www.businessoffashion.com/feed/' },
  { source: 'Highsnobiety', url: 'https://www.highsnobiety.com/feed/' },
];
let fashionCache = { at: 0, items: [] };
function parseRssItems(xml, source) {
  const items = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const b of blocks.slice(0, 8)) {
    const pick = (re) => { const m = b.match(re); return m ? m[1].trim() : ''; };
    const decodeCdata = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
    let title = decodeCdata(pick(/<title>([\s\S]*?)<\/title>/i));
    let link  = pick(/<link>([\s\S]*?)<\/link>/i) || pick(/<link[^>]*href=["']([^"']+)["']/i);
    const date = pick(/<pubDate>([\s\S]*?)<\/pubDate>/i) || pick(/<dc:date>([\s\S]*?)<\/dc:date>/i);
    let img = pick(/<media:content[^>]*url=["']([^"']+)["']/i)
           || pick(/<media:thumbnail[^>]*url=["']([^"']+)["']/i)
           || pick(/<enclosure[^>]*url=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
    if (!img) { const d = pick(/<description>([\s\S]*?)<\/description>/i); const im = d.match(/<img[^>]+src=["']([^"']+)["']/i); if (im) img = im[1]; }
    title = title.replace(/&amp;/g,'&').replace(/&#8217;/g,'’').replace(/&#8211;/g,'–').replace(/&quot;/g,'"').replace(/&#039;/g,"'");
    if (title && link) items.push({ source, title: title.slice(0, 140), link: link.trim(), date, image: img || '' });
  }
  return items;
}
app.get('/api/fashion-news', ah(async (req, res) => {
  const now = Date.now();
  if (now - fashionCache.at < 30 * 60 * 1000 && fashionCache.items.length) {
    return res.json({ items: fashionCache.items, cached: true });
  }
  const results = await Promise.allSettled(FASHION_FEEDS.map(async f => {
    const ctrl = AbortSignal.timeout ? AbortSignal.timeout(7000) : undefined;
    const r = await fetch(f.url, { headers: { 'User-Agent': 'Mozilla/5.0 StudioBot', 'Accept': 'application/rss+xml,application/xml,text/xml' }, signal: ctrl });
    if (!r.ok) throw new Error(f.source + ' ' + r.status);
    return parseRssItems(await r.text(), f.source);
  }));
  let merged = [];
  results.forEach(r => { if (r.status === 'fulfilled') merged.push(...r.value.slice(0, 4)); });
  // entrelacer par source + trier par date
  merged.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  merged = merged.slice(0, 14);
  if (merged.length) fashionCache = { at: now, items: merged };
  res.json({ items: merged.length ? merged : fashionCache.items, cached: false });
}));

// Agrégation des notes pour une liste de shoppers → { [id]: { avg, count } }
async function ratingsFor(shopperIds) {
  const out = {};
  if (!shopperIds.length) return out;
  const { data } = await sb.from('shopper_ratings').select('shopper_id, stars').in('shopper_id', shopperIds);
  (data || []).forEach(r => {
    const o = out[r.shopper_id] || (out[r.shopper_id] = { sum: 0, count: 0 });
    o.sum += r.stars; o.count++;
  });
  Object.keys(out).forEach(k => { out[k] = { avg: out[k].sum / out[k].count, count: out[k].count }; });
  return out;
}

app.get('/api/discover', ah(async (req, res) => {
  const { data, error } = await sb.from('users')
    .select(SHOPPER_PUBLIC_FIELDS)
    .eq('is_public', true)
    .not('public_slug', 'is', null)
    .order('id', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  const ratings = await ratingsFor(rows.map(r => r.id));
  rows.forEach(r => { const rt = ratings[r.id]; r.rating_avg = rt ? rt.avg : null; r.rating_count = rt ? rt.count : 0; });
  res.json(rows);
}));

app.get('/api/shoppers/:slug', ah(async (req, res) => {
  const u = await dbFirst('users', { public_slug: req.params.slug, is_public: true }, { select: SHOPPER_PUBLIC_FIELDS });
  if (!u) return res.sendStatus(404);
  const ratings = await ratingsFor([u.id]);
  const rt = ratings[u.id];
  u.rating_avg = rt ? rt.avg : null;
  u.rating_count = rt ? rt.count : 0;
  // avis récents (avec prénom du client)
  const { data: reviews } = await sb.from('shopper_ratings')
    .select('stars, review, created_at, client_id')
    .eq('shopper_id', u.id).not('review', 'is', null).order('created_at', { ascending: false }).limit(10);
  const cIds = [...new Set((reviews || []).map(r => r.client_id))];
  const names = {};
  if (cIds.length) { const { data: cs } = await sb.from('clients').select('id, name').in('id', cIds); (cs||[]).forEach(c => names[c.id] = c.name); }
  u.reviews = (reviews || []).filter(r => (r.review || '').trim()).map(r => ({
    stars: r.stars, review: r.review, created_at: r.created_at,
    author: (names[r.client_id] || 'Client').split(' ')[0]
  }));
  // Le visiteur connecté (client) peut-il noter ce shopper ? (= il est client de ce shopper)
  let canRate = false, myRating = null;
  if (req.session?.clientId) {
    const c = await dbFirst('clients', { id: req.session.clientId }, { select: 'id, user_id' });
    if (c && c.user_id === u.id) {
      canRate = true;
      myRating = await dbFirst('shopper_ratings', { shopper_id: u.id, client_id: c.id }, { select: 'stars, review' });
    }
  }
  u.can_rate = canRate;
  u.my_rating = myRating || null;
  res.json(u);
}));

// Un client connecté note SON styliste
app.post('/api/shoppers/:slug/rate', ah(async (req, res) => {
  if (!req.session?.clientId) return res.status(401).json({ error: 'Connectez-vous pour noter.' });
  const u = await dbFirst('users', { public_slug: req.params.slug, is_public: true }, { select: 'id' });
  if (!u) return res.sendStatus(404);
  const c = await dbFirst('clients', { id: req.session.clientId }, { select: 'id, user_id' });
  if (!c || c.user_id !== u.id) return res.status(403).json({ error: 'Vous ne pouvez noter que votre styliste.' });
  const stars = parseInt(req.body?.stars, 10);
  if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: 'Note entre 1 et 5.' });
  const review = (req.body?.review || '').slice(0, 1000).trim() || null;
  const now = new Date().toISOString();
  const existing = await dbFirst('shopper_ratings', { shopper_id: u.id, client_id: c.id }, { select: 'id' });
  if (existing) await dbUpdate('shopper_ratings', { id: existing.id }, { stars, review, updated_at: now });
  else await dbInsert('shopper_ratings', { shopper_id: u.id, client_id: c.id, stars, review });
  res.json({ ok: true });
}));

// Demande d'accès d'un nouveau client à un shopper
app.post('/api/shoppers/:slug/request', ah(async (req, res) => {
  const u = await dbFirst('users', { public_slug: req.params.slug, is_public: true }, { select: 'id, name, studio_name' });
  if (!u) return res.sendStatus(404);

  const email = (req.body?.email || '').toLowerCase().trim();
  const name = (req.body?.name || '').trim();
  const message = (req.body?.message || '').slice(0, 1000);
  if (!email || !name) return res.status(400).json({ error: 'email et nom requis' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'email invalide' });

  // Vérifie si un client avec cet email existe déjà chez ce shopper
  const existing = await dbFirst('clients', { user_id: u.id, email });
  if (existing) {
    return res.status(409).json({ error: 'Vous avez déjà été contacté par ce styliste. Connectez-vous via /c/login.' });
  }

  // Crée le client + magic link
  const slug = nanoid(8).toLowerCase();
  const token = nanoid(40);
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  const c = await dbInsert('clients', {
    user_id: u.id,
    slug,
    name,
    email,
    request_message: message || null,
    magic_token: token,
    magic_expires: expires
  });
  // Notif au shopper
  await dbInsert('notifications', {
    client_id: c.id, kind: 'new_request', ref_id: c.id,
    title: `Nouveau client : ${name}`,
    body: message || 'A demandé un accès via votre profil public.'
  });

  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const magicUrl = `${proto}://${host}/c/auth/magic/${token}`;
  console.log(`\n📩 Nouveau client ${email} pour ${u.studio_name || u.name} :\n   ${magicUrl}\n`);

  res.json({
    ok: true,
    magic_url: magicUrl,
    message: `Votre demande a été envoyée à ${u.studio_name || u.name}. Voici votre lien d'accès — gardez-le précieusement.`
  });
}));

/* ═══════════════════════════════════════════ */
/*                  PUBLIC                     */
/* ═══════════════════════════════════════════ */
app.get('/api/public/:slug', ah(async (req, res) => {
  const c = await dbFirst('clients', { slug: req.params.slug }, {
    select: 'id, user_id, slug, name, note, welcome_message, photo_url, profile_filled_by'
  });
  if (!c) return res.sendStatus(404);
  const u = await dbFirst('users', { id: c.user_id }, { select: 'name, studio_name, studio_logo, accent_color, photo_url, bio' });

  const [items, insps, folders] = await Promise.all([
    dbList('items', { where: { client_id: c.id }, is: { deleted_at: null }, order: [{ col: 'position', asc: true }, { col: 'id', asc: true }] }),
    dbList('inspirations', { where: { client_id: c.id }, order: [{ col: 'position', asc: true }, { col: 'id', asc: true }] }),
    dbList('folders', { where: { client_id: c.id }, order: [{ col: 'position', asc: true }, { col: 'created_at', asc: true }] })
  ]);
  if (items.length) {
    const { data: links } = await sb.from('item_folders').select('item_id, folder_id').in('item_id', items.map(i => i.id));
    const byItem = new Map();
    (links || []).forEach(l => { if (!byItem.has(l.item_id)) byItem.set(l.item_id, []); byItem.get(l.item_id).push(l.folder_id); });
    items.forEach(it => { it.folder_ids = byItem.get(it.id) || []; });
  }

  // pièces + refs pour chaque inspiration
  await Promise.all(insps.map(async i => {
    i.pieces = await dbList('pieces', { where: { inspiration_id: i.id }, order: [{ col: 'position', asc: true }, { col: 'id', asc: true }] });
    await Promise.all(i.pieces.map(async p => {
      p.refs = await dbList('refs', { where: { piece_id: p.id }, order: [{ col: 'position', asc: true }, { col: 'id', asc: true }] });
    }));
  }));

  // unread notifications
  const { count: unread } = await sb.from('notifications').select('id', { count: 'exact', head: true }).eq('client_id', c.id).is('read_at', null);

  // pièces récentes (7 derniers jours)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  items.forEach(it => it.is_new = it.created_at && it.created_at > sevenDaysAgo);

  delete c.user_id;
  res.json({ client: c, studio: u, items, inspirations: insps, folders: folders || [], unread_notifications: unread || 0 });
}));

app.get('/api/public/:slug/profile', ah(async (req, res) => {
  const c = await dbFirst('clients', { slug: req.params.slug }, { select: 'name, profile_json, profile_filled_by' });
  if (!c) return res.sendStatus(404);
  res.json({ name: c.name, profile: c.profile_json || null, filled_by: c.profile_filled_by });
}));

app.post('/api/public/:slug/profile', ah(async (req, res) => {
  const c = await dbFirst('clients', { slug: req.params.slug }, { select: 'id, profile_filled_by' });
  if (!c) return res.sendStatus(404);
  const { profile, photo_url } = req.body || {};
  if (photo_url !== undefined) {
    await dbUpdate('clients', { id: c.id }, { photo_url: photo_url || null });
  }
  if (profile) {
    if (c.profile_filled_by === 'shopper') {
      return res.status(403).json({ error: 'Profil déjà complété par votre styliste.' });
    }
    await dbUpdate('clients', { id: c.id }, { profile_json: profile, profile_filled_by: 'client' });
  }
  res.json({ ok: true });
}));

/* Like / commentaire public — notifie le shopper */
app.post('/api/public/:slug/items/:id/like', ah(async (req, res) => {
  const c = await dbFirst('clients', { slug: req.params.slug }, { select: 'id, name' });
  if (!c) return res.sendStatus(404);
  const it = await dbFirst('items', { id: req.params.id, client_id: c.id });
  if (!it || it.deleted_at) return res.sendStatus(404);
  const next = !it.liked;
  await dbUpdate('items', { id: it.id }, { liked: next });
  // notif au shopper uniquement quand le client like (pas quand il retire le like)
  if (next) {
    await dbInsert('notifications', {
      client_id: c.id, kind: 'client_like', ref_id: it.id,
      title: `${c.name} a aimé une pièce`,
      body: `${it.brand || ''} ${it.name || ''}`.trim() || 'Pièce sans nom'
    });
  }
  res.json({ liked: next });
}));
app.post('/api/public/:slug/items/:id/comment', ah(async (req, res) => {
  const c = await dbFirst('clients', { slug: req.params.slug }, { select: 'id, name' });
  if (!c) return res.sendStatus(404);
  const it = await dbFirst('items', { id: req.params.id, client_id: c.id });
  if (!it || it.deleted_at) return res.sendStatus(404);
  const text = (req.body?.comment || '').slice(0, 1000);
  await dbUpdate('items', { id: it.id }, { comment: text || null });
  if (text) {
    await dbInsert('notifications', {
      client_id: c.id, kind: 'client_comment', ref_id: it.id,
      title: `${c.name} a commenté`,
      body: text.slice(0, 200) + (text.length > 200 ? '…' : '')
    });
  }
  res.json({ ok: true });
}));

/* ═══════════════════════════════════════════ */
/*           BOÎTE DE RÉCEPTION SHOPPER        */
/* ═══════════════════════════════════════════ */
app.get('/api/inbox', requireAuth, ah(async (req, res) => {
  const myClients = await dbList('clients', { where: { user_id: req.session.userId }, select: 'id, name, slug, photo_url' });
  if (!myClients.length) return res.json({ items: [], unread: 0 });
  const clientById = Object.fromEntries(myClients.map(c => [c.id, c]));

  // filtre par kinds = côté client uniquement
  const { data: notifs, error } = await sb.from('notifications')
    .select('*')
    .in('client_id', myClients.map(c => c.id))
    .in('kind', ['client_like', 'client_comment', 'new_request'])
    .order('id', { ascending: false })
    .limit(200);
  if (error) throw error;

  const items = (notifs || []).map(n => ({
    ...n,
    client_name: clientById[n.client_id]?.name || '—',
    client_slug: clientById[n.client_id]?.slug,
    client_photo: clientById[n.client_id]?.photo_url
  }));
  const unread = items.filter(n => !n.read_at).length;
  res.json({ items, unread });
}));

app.post('/api/inbox/:id/read', requireAuth, ah(async (req, res) => {
  // vérifie ownership
  const n = await dbFirst('notifications', { id: req.params.id });
  if (!n) return res.sendStatus(404);
  const c = await ownClient(req.session.userId, n.client_id);
  if (!c) return res.sendStatus(404);
  await dbUpdate('notifications', { id: n.id }, { read_at: new Date().toISOString() });
  res.json({ ok: true });
}));

app.post('/api/inbox/read-all', requireAuth, ah(async (req, res) => {
  const myClients = await dbList('clients', { where: { user_id: req.session.userId }, select: 'id' });
  if (myClients.length) {
    await sb.from('notifications').update({ read_at: new Date().toISOString() })
      .in('client_id', myClients.map(c => c.id))
      .in('kind', ['client_like', 'client_comment', 'new_request'])
      .is('read_at', null);
  }
  res.json({ ok: true });
}));

/* ═══════════════════════════════════════════ */
/*                  SCRAPING                   */
/* ═══════════════════════════════════════════ */
// Quotas de scraping par user (in-memory, reset au redémarrage du serveur)
const SCRAPE_LIMIT_FREE = parseInt(process.env.SCRAPE_LIMIT_FREE || '30', 10);
const scrapeUsage = new Map(); // userId → { day, count, plan }
function getUsage(userId) {
  const today = new Date().toISOString().slice(0, 10);
  let u = scrapeUsage.get(userId);
  if (!u || u.day !== today) {
    u = { day: today, count: 0, plan: 'free' };
    scrapeUsage.set(userId, u);
  }
  return u;
}

app.get('/api/scrape/quota', requireAuth, (req, res) => {
  const u = getUsage(req.session.userId);
  res.json({
    plan: u.plan,
    used: u.count,
    limit: u.plan === 'pro' ? null : SCRAPE_LIMIT_FREE,
    remaining: u.plan === 'pro' ? null : Math.max(0, SCRAPE_LIMIT_FREE - u.count)
  });
});

app.post('/api/scrape', requireAuth, ah(async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url requise' });

  const usage = getUsage(req.session.userId);
  if (usage.plan !== 'pro' && usage.count >= SCRAPE_LIMIT_FREE) {
    return res.status(402).json({
      error: 'quota',
      message: `Vous avez atteint votre quota gratuit de ${SCRAPE_LIMIT_FREE} imports par jour. Passez en plan Pro pour des imports illimités.`,
      used: usage.count, limit: SCRAPE_LIMIT_FREE
    });
  }
  usage.count++;

  try {
    let html, parsed;
    const SCRAPINGBEE_KEY = process.env.SCRAPINGBEE_API_KEY;

    if (SCRAPINGBEE_KEY) {
      // Via ScrapingBee (rendu JS + anti-bot)
      const sbUrl = `https://app.scrapingbee.com/api/v1/?api_key=${SCRAPINGBEE_KEY}&url=${encodeURIComponent(url)}&render_js=true&block_ads=true`;
      const sbRes = await fetch(sbUrl);
      if (!sbRes.ok) throw new Error('ScrapingBee error ' + sbRes.status);
      html = await sbRes.text();
    } else {
      // Fetch direct (gratuit, marche pour ~30% des sites)
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
          'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none',
          'Upgrade-Insecure-Requests': '1'
        },
        redirect: 'follow'
      });
      html = await r.text();
    }

    parsed = parseProduct(html, url);

    // Détecter les titres "erreur" et les vider pour déclencher le fallback
    if (/^\s*(access denied|not found|404|403|moteur de recherche|search|home|accueil)/i.test(parsed.name || '')) parsed.name = '';

    const isEmpty = p => !((p.name||'').trim()) && !p.image && !p.price;

    // Fallback Jina (extrait le markdown de la page rendue, gratuit, sans clé)
    if (isEmpty(parsed)) {
      try {
        const proxy = await fetch('https://r.jina.ai/' + url, { headers: { 'Accept': 'text/plain' } });
        if (proxy.ok) {
          const md = await proxy.text();
          const fb = parseMarkdown(md, url);
          parsed = {
            brand: parsed.brand || fb.brand,
            name: ((parsed.name||'').trim()) || fb.name,
            price: parsed.price || fb.price,
            image: parsed.image || fb.image,
            description: parsed.description || fb.description,
            cat: parsed.cat || mapCategory((fb.name||'') + ' ' + (fb.description||'')),
            link: url
          };
        }
      } catch {}
    }
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: 'scraping échoué : ' + e.message });
  }
}));

function cleanAmount(raw) { if (raw == null) return ''; const m = String(raw).match(/\d+(?:[.,]\d{1,2})?/); return m ? m[0] : ''; }
function detectCurrency(raw) {
  if (!raw) return '';
  const s = String(raw).toUpperCase();
  if (s.includes('€') || s.includes('EUR')) return '€';
  if (s.includes('£') || s.includes('GBP')) return '£';
  if (s.includes('$') || s.includes('USD')) return '$';
  if (s.includes('CHF')) return 'CHF';
  return '';
}
function looksLikeDomain(s) { return /^[a-z0-9-]+(\.[a-z]{2,})+(\/.*)?$/i.test((s || '').trim()); }
const CATEGORY_KEYWORDS = [
  ['chaussures', /\b(chaussures?|sneakers?|baskets?|boots?|loafers?|mocassins?|escarpins?|sandales?|derby|richelieu|shoes?|footwear)\b/i],
  ['training',   /\b(training|jogging|legging|tracksuit|activewear|yoga|running)\b/i],
  ['accessoire', /\b(ceinture|sac|bag|écharpe|chapeau|casquette|bonnet|cravate|gants|lunettes?|bijou|montre|portefeuille|belt|scarf)\b/i],
  ['veste',      /\b(veste|manteau|blazer|blouson|parka|trench|doudoune|jacket|coat|cardigan)\b/i],
  ['pull',       /\b(pull|sweat|hoodie|sweatshirt|sweat-shirt|jumper|pullover|knit|maille)\b/i],
  ['short',      /\bshorts?\b/i],
  ['pantalon',   /\b(pantalons?|jeans?|chino|trousers?|pants|denim|jogger)\b/i],
  ['tshirt',     /\b(t-shirts?|tshirts?|tee-shirts?|polo|débardeur|tank top|crewneck|crew\s*neck)\b/i],
  ['chemise',    /\b(chemise|chemisier|blouse|button-?up|button-?down|dress\s*shirt)\b/i],
];
function mapCategory(raw) {
  if (!raw) return '';
  const s = String(raw);
  for (const [slug, re] of CATEGORY_KEYWORDS) if (re.test(s)) return slug;
  return '';
}
function brandFromHost(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./,'').split('.')[0];
    const MARKETPLACE = /zalando|amazon|asos|farfetch|net-a-porter|mrporter|urbanoutfitters|ebay|vinted|aliexpress/i;
    if (MARKETPLACE.test(h)) {
      const seg = (u.pathname.split('/').filter(Boolean)[0] || '').split('-')[0];
      if (seg && seg.length >= 2 && !/^p\d|^\d/.test(seg)) return seg.charAt(0).toUpperCase() + seg.slice(1);
      return '';
    }
    return h.charAt(0).toUpperCase() + h.slice(1);
  } catch { return ''; }
}
function scoreImage(u) {
  if (!u) return -1;
  const s = u.toLowerCase();
  let score = 0;
  if (/logo|icon|favicon|sprite|placeholder|thumb|swatch|transparent|pixel|tracking|tracker|beacon|spacer|blank|empty/.test(s)) return -1;
  if (/\.svg(\?|$)|\.gif(\?|$)/.test(s)) return -1;
  if (/\/akam\/|\/analytics\/|\/track\//.test(s)) return -1;
  if (/(?:model|mannequin|lookbook|outfit|lifestyle|worn|editorial|campaign|video|_e\d|-e\d)/.test(s)) score -= 5;
  if (/(?:packshot|still[-_]?life|stilllife|product|front|_p\d|-p\d|\/p\d|_1\.|-1\.|_01|_a\.|_a1|main|hero)/.test(s)) score += 5;
  return score;
}
function pickImages(candidates, sourceHost = '', primary = '') {
  const seen = new Set(), out = [];
  const fingerprint = u => {
    try {
      const p = new URL(u).pathname;
      return p.replace(/[_-]?\d{2,4}x?\d{0,4}(\.|$)/, '$1').replace(/@\dx/, '');
    } catch { return u.split('?')[0]; }
  };
  // Tokens distinctifs de l'image principale (SKU, hash de dossier…) pour exclure les recommandations
  const primaryTokens = (() => {
    if (!primary) return [];
    try {
      const path = new URL(primary).pathname.toLowerCase();
      const skipCommon = t => /^(image|images|public|assets|media|static|cdn|product|jpg|jpeg|png|webp|main|hero|gallery|fashion|original|large|medium|small|zoom|content|catalog|spp|article|item)$/.test(t);
      const toks = [...path.matchAll(/[a-z0-9]{5,}/g)].map(m => m[0]).filter(t => !skipCommon(t));
      // Tokens qui apparaissent ≥2 fois (typiquement le SKU répété dans le path) = signal fort
      const counts = {};
      toks.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
      const repeated = [...new Set(toks)].filter(t => counts[t] >= 2);
      if (repeated.length) return repeated.slice(0, 3);
      // Sinon : tokens majoritairement numériques (SKU)
      const numeric = toks.filter(t => /^\d+$/.test(t) || (t.length >= 6 && (t.match(/\d/g) || []).length / t.length >= 0.5));
      if (numeric.length) return [...new Set(numeric)].slice(0, 2);
      // Dernier fallback : les 2 plus longs
      return [...new Set(toks)].sort((a,b) => b.length - a.length).slice(0, 2);
    } catch { return []; }
  })();
  for (const c of candidates) {
    if (!c) continue;
    let u = c;
    try { u = new URL(c).toString(); } catch { continue; }
    const fp = fingerprint(u);
    if (seen.has(fp)) continue;
    if (scoreImage(u) < 0) continue;
    if (sourceHost) {
      try { const h = new URL(u).hostname.replace(/^www\./,''); if (h !== sourceHost && !h.endsWith('.' + sourceHost.split('.').slice(-2).join('.'))) {
        if (!/^(?:static|img|images?|cdn|media|assets|i)\./.test(h)) continue;
      } } catch {}
    }
    // Filtre par tokens : on garde l'image seulement si elle partage un token distinctif avec l'image principale
    if (primaryTokens.length) {
      const low = u.toLowerCase();
      if (!primaryTokens.some(t => low.includes(t))) continue;
    }
    seen.add(fp); out.push(u);
  }
  return out.sort((a,b) => scoreImage(b) - scoreImage(a)).slice(0, 12);
}
function parseProduct(html, sourceUrl) {
  const result = { brand: '', name: '', price: '', image: '', description: '', link: sourceUrl, cat: '', images: [] };
  let categoryRaw = '';
  const imgCandidates = [];
  const meta = (...names) => {
    for (const n of names) {
      const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*content=["']([^"']*)["']`, 'i');
      const m = html.match(re); if (m && m[1]) return decode(m[1].trim());
      const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i');
      const m2 = html.match(re2); if (m2 && m2[1]) return decode(m2[1].trim());
    }
    return '';
  };
  result.name        = meta('og:title', 'twitter:title') || titleTag(html);
  result.description = meta('og:description', 'description', 'twitter:description');
  result.image       = meta('og:image', 'og:image:secure_url', 'twitter:image');
  if (result.image) imgCandidates.push(result.image);
  const ogAllRe = /<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/gi;
  let ogm; while ((ogm = ogAllRe.exec(html))) imgCandidates.push(ogm[1]);
  result.brand       = meta('product:brand', 'og:brand', 'og:site_name');
  categoryRaw        = meta('product:category', 'article:section');
  const amount       = meta('product:price:amount', 'og:price:amount', 'twitter:data1');
  const currencyRaw  = meta('product:price:currency', 'og:price:currency');
  if (amount) {
    const cleaned = cleanAmount(amount);
    const cur = detectCurrency(currencyRaw) || detectCurrency(amount);
    if (cleaned) result.price = cur ? `${cur} ${cleaned}` : cleaned;
  }
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRe.exec(html))) {
    try {
      const data = JSON.parse(m[1].trim());
      const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
      for (const obj of items) {
        const t = obj['@type'];
        if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) {
          if (!result.name && obj.name) result.name = obj.name;
          const ldImgs = typeof obj.image === 'string' ? [obj.image] : (Array.isArray(obj.image) ? obj.image.map(i => typeof i==='string'?i:(i?.url||'')) : (obj.image?.url ? [obj.image.url] : []));
          ldImgs.forEach(u => u && imgCandidates.push(u));
          result.image = result.image || ldImgs[0] || '';
          result.brand = result.brand || (typeof obj.brand === 'string' ? obj.brand : (obj.brand?.name || ''));
          result.description = result.description || obj.description || '';
          if (!categoryRaw && obj.category) categoryRaw = Array.isArray(obj.category) ? obj.category.join(' ') : String(obj.category);
          const offer = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers;
          if (offer && !result.price) {
            const p = offer.price || offer.lowPrice;
            const c = detectCurrency(offer.priceCurrency) || detectCurrency(p);
            const cleaned = cleanAmount(p);
            if (cleaned) result.price = c ? `${c} ${cleaned}` : cleaned;
          }
        }
      }
    } catch {}
  }
  if (/zalando|amazon|asos|net-a-porter|mrporter|farfetch|urbanoutfitters|urban outfitters/i.test(result.brand)) result.brand = '';
  if (!result.brand) result.brand = brandFromHost(sourceUrl);
  // Catégorie depuis breadcrumb JSON-LD ou fil d'ariane HTML
  if (!categoryRaw) {
    const bc = html.match(/"BreadcrumbList"[\s\S]{0,2000}?"itemListElement"\s*:\s*(\[[\s\S]*?\])/i);
    if (bc) { try { const items = JSON.parse(bc[1]); categoryRaw = items.map(i => i.name || i.item?.name || '').join(' '); } catch {} }
  }
  if (!categoryRaw) {
    const crumb = html.match(/breadcrumb[^>]*>([\s\S]{0,1500}?)<\/(?:nav|ol|ul|div)/i);
    if (crumb) categoryRaw = crumb[1].replace(/<[^>]+>/g,' ');
  }
  let urlPath = ''; try { urlPath = decodeURIComponent(new URL(sourceUrl).pathname).replace(/[-_/]/g,' '); } catch {}
  result.cat = mapCategory(categoryRaw + ' ' + result.name + ' ' + result.description + ' ' + urlPath);

  // Élargir : <img src>, srcset, et données JSON inline (très utile sur Zara/Zalando/H&M où la galerie est en JS)
  const sourceHost = (() => { try { return new URL(sourceUrl).hostname.replace(/^www\./,''); } catch { return ''; } })();
  const imgTagRe = /<img\b[^>]+(?:src|data-src|data-lazy-src|data-image-src)=["']([^"']+)["'][^>]*>/gi;
  let im; while ((im = imgTagRe.exec(html))) {
    const u = im[1];
    if (/^(?:https?:)?\/\//.test(u) || u.startsWith('/')) {
      const abs = u.startsWith('//') ? 'https:' + u : (u.startsWith('/') ? `https://${sourceHost}${u}` : u);
      imgCandidates.push(abs);
    }
  }
  // srcset
  const srcsetRe = /\bsrcset=["']([^"']+)["']/gi;
  let ss; while ((ss = srcsetRe.exec(html))) {
    ss[1].split(',').forEach(part => {
      const u = part.trim().split(/\s+/)[0];
      if (u && /^(?:https?:)?\/\//.test(u)) imgCandidates.push(u.startsWith('//') ? 'https:' + u : u);
    });
  }
  // Toutes les URLs d'image trouvées dans les blocs JSON inline (Zara, Zalando, etc.)
  const jsonUrlRe = /["'](https?:\/\/[^"'\s]+\.(?:jpe?g|png|webp)(?:\?[^"'\s]*)?)["']/gi;
  let ju; while ((ju = jsonUrlRe.exec(html))) imgCandidates.push(ju[1]);

  result.images = pickImages(imgCandidates, sourceHost, result.image);
  if (result.images.length) result.image = result.images[0];
  if (looksLikeDomain(result.name)) result.name = '';
  if (result.name) {
    const split = result.name.split(/\s+[|\-–—]\s+/);
    if (split.length > 1 && split[0].length > 4) result.name = split[0];
  }
  return result;
}
function titleTag(html) { const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m ? decode(m[1].trim()) : ''; }

// Parse le markdown retourné par r.jina.ai
function parseMarkdown(md, sourceUrl) {
  const result = { brand: '', name: '', price: '', image: '', description: '', link: sourceUrl };
  const title = md.match(/^Title:\s*(.+)$/m);
  if (title) {
    let n = title[1].trim();
    const parts = n.split(/\s+[|\-–—]\s+/);
    if (parts.length > 1 && parts[0].length > 4) n = parts[0];
    if (!looksLikeDomain(n) && !/moteur de recherche|search|home|accueil|404|not found|access/i.test(n)) {
      result.name = n;
    }
  }
  // Première image markdown (skip svg, logos…)
  const imgs = [...md.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)];
  for (const m of imgs) {
    const u = m[1];
    if (!/logo|icon|favicon|sprite|\.svg(\?|$)/i.test(u)) { result.image = u; break; }
  }
  // Prix
  const p1 = md.match(/(\d{1,5}(?:[.,]\d{1,2})?)\s*(€|EUR|CHF|\$|USD|£|GBP)\b/i);
  const p2 = md.match(/(€|EUR|CHF|\$|USD|£|GBP)\s*(\d{1,5}(?:[.,]\d{1,2})?)/i);
  const pm = p1 || (p2 ? [p2[0], p2[2], p2[1]] : null);
  if (pm) {
    const cur = detectCurrency(pm[2]);
    const amt = cleanAmount(pm[1]);
    if (amt) result.price = cur ? `${cur} ${amt}` : amt;
  }
  // Description : 1er paragraphe de texte significatif (en évitant les warnings Jina)
  const body = md.replace(/^Title:.*$/m,'').replace(/^URL Source:.*$/m,'').replace(/^Markdown Content:.*$/m,'').replace(/^Warning:.*$/gm,'');
  const lines = body.split('\n').map(l=>l.trim()).filter(l => l && !l.startsWith('!') && !l.startsWith('[') && !l.startsWith('#') && !l.startsWith('*') && !/^warning/i.test(l) && l.length > 30);
  if (lines.length) result.description = lines[0].slice(0, 300);
  return result;
}
function decode(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#x27;/g,"'")
    .replace(/&nbsp;/g,' ').replace(/&euro;/g,'€').replace(/&pound;/g,'£');
}

/* ═══════════════════════════════════════════ */
/*                  TRY-ON                     */
/* ═══════════════════════════════════════════ */
app.post('/api/tryon', requireAuth, ah(async (req, res) => {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(503).json({ error: 'not_configured', message: 'Définir REPLICATE_API_TOKEN pour activer le try-on.' });
  const { human_url, garment_url, category } = req.body || {};
  if (!human_url || !garment_url) return res.status(400).json({ error: 'human_url + garment_url requis' });
  const start = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: 'c871bb9b046607b680449b698388e3cb35e1edab98e9eb7d33c6ddd3a13d3c9d',
      input: { human_img: human_url, garm_img: garment_url, garment_des: category || 'a garment' }
    })
  });
  const pred = await start.json();
  if (pred.error) return res.status(500).json({ error: pred.error });
  let out = pred;
  for (let i = 0; i < 30 && out.status !== 'succeeded' && out.status !== 'failed'; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const p = await fetch(out.urls.get, { headers: { 'Authorization': `Token ${token}` } });
    out = await p.json();
  }
  if (out.status === 'succeeded') res.json({ image: Array.isArray(out.output) ? out.output[0] : out.output });
  else res.status(500).json({ error: 'tryon failed', detail: out.error || out.status });
}));

/* ═══════════════════════════════════════════ */
/*           STATIC + PAGE ROUTES              */
/* ═══════════════════════════════════════════ */
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/admin/templates', (req, res) => res.sendFile(path.join(__dirname, 'public', 'templates.html')));
app.get('/admin/inbox', (req, res) => res.sendFile(path.join(__dirname, 'public', 'inbox.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/discover', (req, res) => res.sendFile(path.join(__dirname, 'public', 'discover.html')));
app.get('/s/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shopper.html')));
app.get('/c/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'client-login.html')));

app.get('/c/:slug', ah(async (req, res) => {
  const slug = req.params.slug;
  const c = await dbFirst('clients', { slug }, { select: 'id, slug' });
  if (!c) return res.sendFile(path.join(__dirname, 'public', 'index.html')); // gestion d'erreur côté front

  const expected = codeFromSlug(slug);
  // Si le client a une session active → accès direct
  if (req.session.clientId === c.id) return res.sendFile(path.join(__dirname, 'public', 'index.html'));

  // ?code=XXX dans l'URL → on valide, on pose un cookie, on redirige (URL propre)
  const qCode = (req.query.code || '').toString().trim().toUpperCase();
  if (qCode) {
    if (qCode === expected) {
      res.cookie(`access_${c.id}`, expected, {
        httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30
      });
      return res.redirect(`/c/${slug}`);
    }
    return res.status(401).send(gateHtml(slug, 'Code invalide.'));
  }

  // Cookie déjà posé → accès
  if (req.cookies[`access_${c.id}`] === expected) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }

  // Pas de code → gate
  res.send(gateHtml(slug));
}));

app.post('/c/:slug/code', ah(async (req, res) => {
  const slug = req.params.slug;
  const c = await dbFirst('clients', { slug }, { select: 'id, slug' });
  if (!c) return res.sendStatus(404);
  const code = (req.body?.code || '').toString().trim().toUpperCase();
  if (code !== codeFromSlug(slug)) {
    return res.status(401).json({ error: 'Code invalide.' });
  }
  res.cookie(`access_${c.id}`, code, {
    httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30
  });
  res.json({ ok: true });
}));

function gateHtml(slug, errorMsg = '') {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Studio — Code d'accès</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="/css/style.css">
</head><body>
<div class="login-wrap">
  <form class="login-card" id="codeForm" style="max-width:420px;">
    <div class="logo-wrap"><div class="logo">S</div></div>
    <h1>Accès privé</h1>
    <div class="sub">Cette sélection nécessite un code d'accès</div>

    <p style="font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--muted);font-size:13px;text-align:center;margin-bottom:18px;line-height:1.5;">
      Entrez le code que votre styliste vous a transmis.<br>
      (Format : 6 caractères — lettres et chiffres)
    </p>

    <div class="field">
      <label>Code d'accès</label>
      <input name="code" required autocomplete="off" maxlength="6"
        style="text-transform:uppercase;letter-spacing:0.18em;font-family:monospace;font-size:18px;text-align:center;">
    </div>

    <button class="btn" type="submit">Accéder à ma sélection</button>
    <div class="err" id="err" style="${errorMsg ? '' : 'display:none;'}">${errorMsg}</div>

    <div class="alt-links">
      <span>Vous avez un compte ?</span>
      <a href="/c/login">Se connecter avec votre email</a>
    </div>
  </form>
</div>
<style>
.alt-links { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--hairline); text-align: center; font-family: 'Cormorant Garamond', serif; font-size: 14px; color: var(--muted); }
.alt-links a { margin-left: 6px; color: var(--ink); text-decoration: underline; text-underline-offset: 3px; font-style: italic; }
.alt-links a:hover { color: var(--accent); }
</style>
<script>
document.getElementById('codeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const code = (fd.get('code')||'').toString().trim().toUpperCase();
  const err = document.getElementById('err');
  err.style.display = 'none';
  const r = await fetch('/c/${slug}/code', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ code })
  });
  if (r.ok) location.href = '/c/${slug}';
  else {
    const d = await r.json().catch(()=>({}));
    err.textContent = d.error || 'Code invalide.';
    err.style.display = 'block';
  }
});
</script>
</body></html>`;
}
app.get('/c/:slug/profile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/', (req, res) => res.redirect('/admin'));

app.listen(PORT, () => console.log(`▸ Studio (Supabase) lancé sur http://localhost:${PORT}`));
