/* Studio Personal Shopping — backend Express + SQLite */
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 8) || '.jpg';
      cb(null, `${Date.now()}-${nanoid(8)}${ext}`);
    }
  }),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12 MB
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('image only'));
    cb(null, true);
  }
});

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'studio.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ─────────── Schéma ─────────── */
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  cat TEXT,
  brand TEXT,
  name TEXT,
  price TEXT,
  link TEXT,
  image TEXT,
  description TEXT,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS inspirations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT,
  main_image TEXT,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pieces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspiration_id INTEGER NOT NULL REFERENCES inspirations(id) ON DELETE CASCADE,
  label TEXT,
  anchor_x REAL DEFAULT 50,
  anchor_y REAL DEFAULT 50,
  position INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  brand TEXT,
  name TEXT,
  link TEXT,
  image TEXT,
  position INTEGER DEFAULT 0
);
`);

/* ─────────── Migrations additives (idempotentes) ─────────── */
function ensureColumn(table, col, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
}
// white-label / profil shopper
ensureColumn('users', 'studio_name',  'TEXT');
ensureColumn('users', 'studio_logo',  'TEXT');     // 1 lettre ou court
ensureColumn('users', 'accent_color', 'TEXT');     // hex
ensureColumn('users', 'photo_url',    'TEXT');
ensureColumn('users', 'bio',          'TEXT');
// profil client riche
ensureColumn('clients', 'profile_json',     'TEXT');   // JSON: mensurations + préférences
ensureColumn('clients', 'profile_filled_by','TEXT');   // 'shopper' | 'client' | null
ensureColumn('clients', 'welcome_message',  'TEXT');
ensureColumn('clients', 'photo_url',        'TEXT');   // photo perso pour try-on
// ordering + tags
ensureColumn('clients', 'position',       'INTEGER DEFAULT 0');
ensureColumn('clients', 'tags',           'TEXT');     // JSON array [{label,color}]
// Auth client
ensureColumn('clients', 'email',          'TEXT');
ensureColumn('clients', 'password_hash',  'TEXT');
ensureColumn('clients', 'magic_token',    'TEXT');
ensureColumn('clients', 'magic_expires',  'TEXT');
ensureColumn('clients', 'claimed_at',     'TEXT');
ensureColumn('clients', 'last_login_at',  'TEXT');
// auth client (email + password)
ensureColumn('clients', 'email',              'TEXT');
ensureColumn('clients', 'password_hash',      'TEXT');
ensureColumn('clients', 'activation_token',   'TEXT');
ensureColumn('clients', 'activation_expires', 'TEXT');
ensureColumn('clients', 'reset_token',        'TEXT');
ensureColumn('clients', 'reset_expires',      'TEXT');
ensureColumn('clients', 'last_login_at',      'TEXT');
// CRM
ensureColumn('clients', 'status',         'TEXT');     // active | dormant | prospect | archived
ensureColumn('clients', 'birthday',       'TEXT');     // YYYY-MM-DD
ensureColumn('clients', 'last_contact_at','TEXT');     // ISO
ensureColumn('clients', 'next_action',    'TEXT');
ensureColumn('clients', 'next_action_at', 'TEXT');     // ISO date
ensureColumn('clients', 'last_viewed_at', 'TEXT');     // mis à jour quand le client ouvre /c/<slug>
// soft-delete + métadonnées items
ensureColumn('items',   'deleted_at',     'TEXT');
ensureColumn('items',   'updated_at',     'TEXT');
ensureColumn('items',   'currency',       'TEXT');     // pour stats
ensureColumn('items',   'amount',         'REAL');     // pour CA estimé
// templates inspiration
ensureColumn('inspirations', 'is_template', 'INTEGER DEFAULT 0');
ensureColumn('inspirations', 'tags',        'TEXT');
// likes / commentaires / statut par pièce
ensureColumn('items', 'liked',         'INTEGER DEFAULT 0');
ensureColumn('items', 'liked_at',      'TEXT');
ensureColumn('items', 'comment',       'TEXT');
ensureColumn('items', 'commented_at',  'TEXT');
ensureColumn('items', 'item_status',   'TEXT'); // proposed | validated | bought | rejected

// Tables additionnelles
db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,         -- 'view_page' | 'view_inspiration' | 'click_item' | 'click_ref' | 'click_hotspot' | 'time'
  target_id INTEGER,          -- item_id / inspiration_id / piece_id / ref_id
  x REAL,                     -- pour heatmap
  y REAL,
  duration_ms INTEGER,        -- pour time tracking
  meta TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_client ON events(client_id);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,         -- 'new_item' | 'new_inspiration' | 'message'
  ref_id INTEGER,
  title TEXT,
  body TEXT,
  read_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notif_client ON notifications(client_id);
`);

/* ─────────── Admin seed ─────────── */
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const email = 'admin@studio.local';
  const pwd = 'studio2026';
  db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?,?,?)')
    .run(email, bcrypt.hashSync(pwd, 10), 'Studio');
  console.log('\n────────────────────────────────────────');
  console.log('  Premier compte personal shopper créé :');
  console.log('  email    :', email);
  console.log('  password :', pwd);
  console.log('  (à changer après la première connexion)');
  console.log('────────────────────────────────────────\n');
}

/* ─────────── App ─────────── */
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'studio-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000*60*60*24*30 }
}));

const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'unauthorized' });
  next();
};

/* ─────────── Auth ─────────── */
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'champs requis' });
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!u || !bcrypt.compareSync(password, u.password_hash)) {
    return res.status(401).json({ error: 'identifiants invalides' });
  }
  req.session.userId = u.id;
  res.json({ id: u.id, email: u.email, name: u.name });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', requireAuth, (req, res) => {
  const u = db.prepare(`SELECT id, email, name, studio_name, studio_logo, accent_color, photo_url, bio
    FROM users WHERE id = ?`).get(req.session.userId);
  res.json(u);
});
app.put('/api/me/settings', requireAuth, (req, res) => {
  const f = req.body || {};
  db.prepare(`UPDATE users SET
    studio_name = COALESCE(?, studio_name),
    studio_logo = COALESCE(?, studio_logo),
    accent_color = COALESCE(?, accent_color),
    photo_url = COALESCE(?, photo_url),
    bio = COALESCE(?, bio),
    name = COALESCE(?, name)
    WHERE id = ?`).run(f.studio_name, f.studio_logo, f.accent_color, f.photo_url, f.bio, f.name, req.session.userId);
  const u = db.prepare(`SELECT id, email, name, studio_name, studio_logo, accent_color, photo_url, bio
    FROM users WHERE id = ?`).get(req.session.userId);
  res.json(u);
});
app.put('/api/me/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(current || '', u.password_hash)) return res.status(400).json({ error: 'mot de passe actuel invalide' });
  if (!next || next.length < 6) return res.status(400).json({ error: 'mot de passe trop court (min 6)' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), u.id);
  res.json({ ok: true });
});

/* ─────────── Clients ─────────── */
app.get('/api/clients', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM items WHERE client_id = c.id AND deleted_at IS NULL) AS items_count,
      (SELECT COUNT(*) FROM inspirations WHERE client_id = c.id) AS insp_count,
      (SELECT COUNT(*) FROM items WHERE client_id = c.id AND liked = 1 AND deleted_at IS NULL) AS likes_count
    FROM clients c WHERE c.user_id = ?
    ORDER BY c.position ASC, c.created_at DESC
  `).all(req.session.userId);
  rows.forEach(c => {
    c.tags = c.tags ? JSON.parse(c.tags) : [];
    c.has_password = !!c.password_hash;
    c.is_claimed = !!c.claimed_at;
    delete c.password_hash;
    delete c.magic_token;
  });
  // jusqu'à 8 vignettes par client (moodboard)
  const thumb = db.prepare(`SELECT image FROM items
    WHERE client_id = ? AND deleted_at IS NULL AND image IS NOT NULL AND image <> ''
    ORDER BY position LIMIT 8`);
  rows.forEach(c => {
    c.preview = thumb.all(c.id).map(r => r.image);
    if (c.preview.length === 0) {
      // fallback : image principale d'inspiration
      const ins = db.prepare(`SELECT main_image FROM inspirations
        WHERE client_id = ? AND main_image IS NOT NULL AND main_image <> ''
        ORDER BY position LIMIT 1`).get(c.id);
      if (ins) c.preview = [ins.main_image];
    }
  });
  res.json(rows);
});
app.post('/api/clients', requireAuth, (req, res) => {
  const { name, note } = req.body || {};
  if (!name) return res.status(400).json({ error: 'nom requis' });
  const slug = nanoid(8).toLowerCase();
  const info = db.prepare('INSERT INTO clients (user_id, slug, name, note) VALUES (?,?,?,?)')
    .run(req.session.userId, slug, name, note || null);
  res.json(db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid));
});
app.put('/api/clients/reorder', requireAuth, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids requis' });
  const upd = db.prepare('UPDATE clients SET position = ? WHERE id = ? AND user_id = ?');
  const tx = db.transaction((arr, uid) => arr.forEach((id, i) => upd.run(i + 1, id, uid)));
  tx(ids, req.session.userId);
  res.json({ ok: true });
});

app.put('/api/clients/:id/tags', requireAuth, (req, res) => {
  const c = db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!c) return res.sendStatus(404);
  const tags = Array.isArray(req.body?.tags) ? req.body.tags : [];
  // sanitize
  const clean = tags.filter(t => t && t.label).map(t => ({
    label: String(t.label).slice(0, 30),
    color: /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : '#b8915a'
  }));
  db.prepare('UPDATE clients SET tags = ? WHERE id = ?').run(JSON.stringify(clean), c.id);
  res.json({ tags: clean });
});

app.put('/api/clients/:id', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!c) return res.sendStatus(404);
  const { name, note, welcome_message, photo_url } = req.body || {};
  const f = req.body || {};
  db.prepare(`UPDATE clients SET
    name = COALESCE(?, name),
    note = COALESCE(?, note),
    welcome_message = COALESCE(?, welcome_message),
    photo_url = COALESCE(?, photo_url),
    status = COALESCE(?, status),
    birthday = COALESCE(?, birthday),
    last_contact_at = COALESCE(?, last_contact_at),
    next_action = COALESCE(?, next_action),
    next_action_at = COALESCE(?, next_action_at)
    WHERE id = ?`).run(name, note, welcome_message, photo_url,
      f.status, f.birthday, f.last_contact_at, f.next_action, f.next_action_at, c.id);
  res.json(db.prepare('SELECT * FROM clients WHERE id = ?').get(c.id));
});

/* ─────────── Profil client (mensurations + préférences) ─────────── */
app.get('/api/clients/:id/profile', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!c) return res.sendStatus(404);
  res.json({
    profile: c.profile_json ? JSON.parse(c.profile_json) : null,
    filled_by: c.profile_filled_by,
    welcome_message: c.welcome_message,
    photo_url: c.photo_url
  });
});
app.put('/api/clients/:id/profile', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!c) return res.sendStatus(404);
  const { profile } = req.body || {};
  db.prepare('UPDATE clients SET profile_json = ?, profile_filled_by = ? WHERE id = ?')
    .run(JSON.stringify(profile || {}), 'shopper', c.id);
  res.json({ ok: true });
});
app.delete('/api/clients/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

/* ─────────── Items ─────────── */
const ownClient = (userId, clientId) =>
  db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(clientId, userId);

// Extrait montant et devise depuis "CHF 120" ou "120 €"
function priceToAmount(price) {
  if (!price) return { amount: null, currency: null };
  const m = String(price).match(/([A-Z€$£¥]{1,3})?\s*([\d.,]+)\s*([A-Z€$£¥]{1,3})?/i);
  if (!m) return { amount: null, currency: null };
  return {
    currency: (m[1] || m[3] || '').toUpperCase() || null,
    amount: parseFloat(m[2].replace(/,/g, '.')) || null
  };
}

app.get('/api/clients/:id/items', requireAuth, (req, res) => {
  if (!ownClient(req.session.userId, req.params.id)) return res.sendStatus(404);
  const incl = req.query.deleted === '1';
  const q = incl
    ? 'SELECT * FROM items WHERE client_id = ? ORDER BY position, id'
    : 'SELECT * FROM items WHERE client_id = ? AND deleted_at IS NULL ORDER BY position, id';
  res.json(db.prepare(q).all(req.params.id));
});
app.post('/api/clients/:id/items', requireAuth, (req, res) => {
  if (!ownClient(req.session.userId, req.params.id)) return res.sendStatus(404);
  const { cat, brand, name, price, link, image, description } = req.body || {};
  const max = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM items WHERE client_id = ?').get(req.params.id).m;
  const { amount, currency } = priceToAmount(price);
  const info = db.prepare(`INSERT INTO items (client_id, cat, brand, name, price, link, image, description, position, amount, currency, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`).run(
    req.params.id, cat, brand, name, price, link, image, description, max + 1, amount, currency);
  // notification
  db.prepare(`INSERT INTO notifications (client_id, kind, ref_id, title, body)
    VALUES (?, 'new_item', ?, ?, ?)`).run(req.params.id, info.lastInsertRowid,
      'Nouvelle pièce ajoutée', `${brand || ''} ${name || ''}`.trim());
  res.json(db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid));
});
app.put('/api/items/:id', requireAuth, (req, res) => {
  const it = db.prepare(`SELECT i.* FROM items i JOIN clients c ON c.id = i.client_id
    WHERE i.id = ? AND c.user_id = ?`).get(req.params.id, req.session.userId);
  if (!it) return res.sendStatus(404);
  const f = req.body || {};
  const { amount, currency } = priceToAmount(f.price || it.price);
  db.prepare(`UPDATE items SET cat=COALESCE(?,cat), brand=COALESCE(?,brand), name=COALESCE(?,name),
    price=COALESCE(?,price), link=COALESCE(?,link), image=COALESCE(?,image), description=COALESCE(?,description),
    amount=?, currency=?, updated_at=datetime('now')
    WHERE id = ?`).run(f.cat, f.brand, f.name, f.price, f.link, f.image, f.description, amount, currency, it.id);
  res.json(db.prepare('SELECT * FROM items WHERE id = ?').get(it.id));
});
// soft-delete par défaut, ?hard=1 pour purge
app.delete('/api/items/:id', requireAuth, (req, res) => {
  const it = db.prepare(`SELECT i.id FROM items i JOIN clients c ON c.id = i.client_id
    WHERE i.id = ? AND c.user_id = ?`).get(req.params.id, req.session.userId);
  if (!it) return res.sendStatus(404);
  if (req.query.hard === '1') {
    db.prepare('DELETE FROM items WHERE id = ?').run(it.id);
  } else {
    db.prepare("UPDATE items SET deleted_at = datetime('now') WHERE id = ?").run(it.id);
  }
  res.json({ ok: true });
});
// restaurer
app.post('/api/items/:id/restore', requireAuth, (req, res) => {
  const it = db.prepare(`SELECT i.id FROM items i JOIN clients c ON c.id = i.client_id
    WHERE i.id = ? AND c.user_id = ?`).get(req.params.id, req.session.userId);
  if (!it) return res.sendStatus(404);
  db.prepare('UPDATE items SET deleted_at = NULL WHERE id = ?').run(it.id);
  res.json({ ok: true });
});

/* ─────────── Inspirations ─────────── */
const buildInspiration = (id) => {
  const ins = db.prepare('SELECT * FROM inspirations WHERE id = ?').get(id);
  if (!ins) return null;
  ins.pieces = db.prepare('SELECT * FROM pieces WHERE inspiration_id = ? ORDER BY position, id').all(id);
  ins.pieces.forEach(p => {
    p.refs = db.prepare('SELECT * FROM refs WHERE piece_id = ? ORDER BY position, id').all(p.id);
  });
  return ins;
};

app.get('/api/clients/:id/inspirations', requireAuth, (req, res) => {
  if (!ownClient(req.session.userId, req.params.id)) return res.sendStatus(404);
  const list = db.prepare('SELECT * FROM inspirations WHERE client_id = ? ORDER BY position, id').all(req.params.id);
  res.json(list.map(i => buildInspiration(i.id)));
});
app.post('/api/clients/:id/inspirations', requireAuth, (req, res) => {
  if (!ownClient(req.session.userId, req.params.id)) return res.sendStatus(404);
  const { title, main_image } = req.body || {};
  const max = db.prepare('SELECT COALESCE(MAX(position),0) AS m FROM inspirations WHERE client_id = ?').get(req.params.id).m;
  const info = db.prepare('INSERT INTO inspirations (client_id, title, main_image, position) VALUES (?,?,?,?)')
    .run(req.params.id, title, main_image, max + 1);
  db.prepare(`INSERT INTO notifications (client_id, kind, ref_id, title, body)
    VALUES (?, 'new_inspiration', ?, ?, ?)`).run(req.params.id, info.lastInsertRowid,
      'Nouvelle inspiration', title || 'Nouveau look');
  res.json(buildInspiration(info.lastInsertRowid));
});
app.put('/api/inspirations/:id', requireAuth, (req, res) => {
  const ins = db.prepare(`SELECT i.* FROM inspirations i JOIN clients c ON c.id = i.client_id
    WHERE i.id = ? AND c.user_id = ?`).get(req.params.id, req.session.userId);
  if (!ins) return res.sendStatus(404);
  const { title, main_image } = req.body || {};
  db.prepare('UPDATE inspirations SET title=COALESCE(?,title), main_image=COALESCE(?,main_image) WHERE id=?')
    .run(title, main_image, ins.id);
  res.json(buildInspiration(ins.id));
});
app.delete('/api/inspirations/:id', requireAuth, (req, res) => {
  db.prepare(`DELETE FROM inspirations WHERE id IN (
    SELECT i.id FROM inspirations i JOIN clients c ON c.id = i.client_id WHERE i.id = ? AND c.user_id = ?
  )`).run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

/* ─────────── Pieces ─────────── */
const ownInspiration = (userId, inspId) =>
  db.prepare(`SELECT i.id FROM inspirations i JOIN clients c ON c.id = i.client_id
    WHERE i.id = ? AND c.user_id = ?`).get(inspId, userId);

app.post('/api/inspirations/:id/pieces', requireAuth, (req, res) => {
  if (!ownInspiration(req.session.userId, req.params.id)) return res.sendStatus(404);
  const { label, anchor_x, anchor_y } = req.body || {};
  const max = db.prepare('SELECT COALESCE(MAX(position),0) AS m FROM pieces WHERE inspiration_id = ?').get(req.params.id).m;
  const info = db.prepare('INSERT INTO pieces (inspiration_id, label, anchor_x, anchor_y, position) VALUES (?,?,?,?,?)')
    .run(req.params.id, label, anchor_x ?? 50, anchor_y ?? 50, max + 1);
  res.json(db.prepare('SELECT * FROM pieces WHERE id = ?').get(info.lastInsertRowid));
});
app.put('/api/pieces/:id', requireAuth, (req, res) => {
  const p = db.prepare(`SELECT p.* FROM pieces p
    JOIN inspirations i ON i.id = p.inspiration_id
    JOIN clients c ON c.id = i.client_id
    WHERE p.id = ? AND c.user_id = ?`).get(req.params.id, req.session.userId);
  if (!p) return res.sendStatus(404);
  const { label, anchor_x, anchor_y } = req.body || {};
  db.prepare('UPDATE pieces SET label=COALESCE(?,label), anchor_x=COALESCE(?,anchor_x), anchor_y=COALESCE(?,anchor_y) WHERE id=?')
    .run(label, anchor_x, anchor_y, p.id);
  res.json(db.prepare('SELECT * FROM pieces WHERE id = ?').get(p.id));
});
app.delete('/api/pieces/:id', requireAuth, (req, res) => {
  db.prepare(`DELETE FROM pieces WHERE id IN (
    SELECT p.id FROM pieces p
    JOIN inspirations i ON i.id = p.inspiration_id
    JOIN clients c ON c.id = i.client_id
    WHERE p.id = ? AND c.user_id = ?
  )`).run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

/* ─────────── Refs ─────────── */
app.post('/api/pieces/:id/refs', requireAuth, (req, res) => {
  const p = db.prepare(`SELECT p.id FROM pieces p
    JOIN inspirations i ON i.id = p.inspiration_id
    JOIN clients c ON c.id = i.client_id
    WHERE p.id = ? AND c.user_id = ?`).get(req.params.id, req.session.userId);
  if (!p) return res.sendStatus(404);
  const { brand, name, link, image } = req.body || {};
  const max = db.prepare('SELECT COALESCE(MAX(position),0) AS m FROM refs WHERE piece_id = ?').get(req.params.id).m;
  const info = db.prepare('INSERT INTO refs (piece_id, brand, name, link, image, position) VALUES (?,?,?,?,?,?)')
    .run(req.params.id, brand, name, link, image, max + 1);
  res.json(db.prepare('SELECT * FROM refs WHERE id = ?').get(info.lastInsertRowid));
});
app.put('/api/refs/:id', requireAuth, (req, res) => {
  const r = db.prepare(`SELECT r.* FROM refs r
    JOIN pieces p ON p.id = r.piece_id
    JOIN inspirations i ON i.id = p.inspiration_id
    JOIN clients c ON c.id = i.client_id
    WHERE r.id = ? AND c.user_id = ?`).get(req.params.id, req.session.userId);
  if (!r) return res.sendStatus(404);
  const f = req.body || {};
  db.prepare('UPDATE refs SET brand=COALESCE(?,brand), name=COALESCE(?,name), link=COALESCE(?,link), image=COALESCE(?,image) WHERE id=?')
    .run(f.brand, f.name, f.link, f.image, r.id);
  res.json(db.prepare('SELECT * FROM refs WHERE id = ?').get(r.id));
});
app.delete('/api/refs/:id', requireAuth, (req, res) => {
  db.prepare(`DELETE FROM refs WHERE id IN (
    SELECT r.id FROM refs r
    JOIN pieces p ON p.id = r.piece_id
    JOIN inspirations i ON i.id = p.inspiration_id
    JOIN clients c ON c.id = i.client_id
    WHERE r.id = ? AND c.user_id = ?
  )`).run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

/* ─────────── Upload d'images ─────────── */
app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'aucun fichier' });
  res.json({ url: `/uploads/${req.file.filename}` });
});
// Upload multiple
app.post('/api/upload/multi', requireAuth, upload.array('files', 10), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'aucun fichier' });
  res.json({ urls: req.files.map(f => `/uploads/${f.filename}`) });
});
// Upload public (sans auth) — pour qu'un client puisse ajouter sa photo de profil
app.post('/api/public/:slug/upload', upload.single('file'), (req, res) => {
  const c = db.prepare('SELECT id FROM clients WHERE slug = ?').get(req.params.slug);
  if (!c) return res.sendStatus(404);
  if (!req.file) return res.status(400).json({ error: 'aucun fichier' });
  res.json({ url: `/uploads/${req.file.filename}` });
});
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

/* ─────────── Statut, like, commentaire pièce (mix shopper + client) ─────────── */
app.put('/api/items/:id/status', requireAuth, (req, res) => {
  const ok = db.prepare(`SELECT i.id FROM items i JOIN clients c ON c.id = i.client_id
    WHERE i.id = ? AND c.user_id = ?`).get(req.params.id, req.session.userId);
  if (!ok) return res.sendStatus(404);
  const allowed = ['proposed','validated','bought','rejected', null, ''];
  const s = req.body?.status;
  if (!allowed.includes(s)) return res.status(400).json({ error: 'statut invalide' });
  db.prepare("UPDATE items SET item_status = ?, updated_at = datetime('now') WHERE id = ?").run(s || null, ok.id);
  res.json({ ok: true });
});
// Like / commentaire public (client)
app.post('/api/public/:slug/items/:id/like', (req, res) => {
  const c = db.prepare('SELECT id FROM clients WHERE slug = ?').get(req.params.slug);
  if (!c) return res.sendStatus(404);
  const it = db.prepare('SELECT id, liked FROM items WHERE id = ? AND client_id = ? AND deleted_at IS NULL').get(req.params.id, c.id);
  if (!it) return res.sendStatus(404);
  const next = it.liked ? 0 : 1;
  db.prepare("UPDATE items SET liked = ?, liked_at = datetime('now') WHERE id = ?").run(next, it.id);
  res.json({ liked: !!next });
});
app.post('/api/public/:slug/items/:id/comment', (req, res) => {
  const c = db.prepare('SELECT id FROM clients WHERE slug = ?').get(req.params.slug);
  if (!c) return res.sendStatus(404);
  const it = db.prepare('SELECT id FROM items WHERE id = ? AND client_id = ? AND deleted_at IS NULL').get(req.params.id, c.id);
  if (!it) return res.sendStatus(404);
  const text = (req.body?.comment || '').slice(0, 1000);
  db.prepare("UPDATE items SET comment = ?, commented_at = datetime('now') WHERE id = ?").run(text || null, it.id);
  res.json({ ok: true });
});

/* ─────────── Duplication d'inspiration ─────────── */
app.post('/api/inspirations/:id/duplicate', requireAuth, (req, res) => {
  const ins = db.prepare(`SELECT i.* FROM inspirations i JOIN clients c ON c.id = i.client_id
    WHERE i.id = ? AND c.user_id = ?`).get(req.params.id, req.session.userId);
  if (!ins) return res.sendStatus(404);
  const max = db.prepare('SELECT COALESCE(MAX(position),0) AS m FROM inspirations WHERE client_id = ?').get(ins.client_id).m;
  const info = db.prepare(`INSERT INTO inspirations (client_id, title, main_image, position, is_template)
    VALUES (?,?,?,?,0)`).run(ins.client_id, (ins.title || 'Look') + ' (copie)', ins.main_image, max + 1);
  const pieces = db.prepare('SELECT * FROM pieces WHERE inspiration_id = ? ORDER BY position').all(ins.id);
  for (const p of pieces) {
    const np = db.prepare(`INSERT INTO pieces (inspiration_id, label, anchor_x, anchor_y, position)
      VALUES (?,?,?,?,?)`).run(info.lastInsertRowid, p.label, p.anchor_x, p.anchor_y, p.position);
    const refs = db.prepare('SELECT * FROM refs WHERE piece_id = ?').all(p.id);
    for (const r of refs) {
      db.prepare(`INSERT INTO refs (piece_id, brand, name, link, image, position)
        VALUES (?,?,?,?,?,?)`).run(np.lastInsertRowid, r.brand, r.name, r.link, r.image, r.position);
    }
  }
  res.json({ id: info.lastInsertRowid });
});

/* ─────────── Templates de looks ─────────── */
app.get('/api/templates', requireAuth, (req, res) => {
  // Inspirations is_template = 1 appartenant à un client du shopper
  const rows = db.prepare(`SELECT i.* FROM inspirations i
    JOIN clients c ON c.id = i.client_id
    WHERE c.user_id = ? AND i.is_template = 1
    ORDER BY i.id DESC`).all(req.session.userId);
  res.json(rows.map(i => buildInspiration(i.id)));
});
app.put('/api/inspirations/:id/template', requireAuth, (req, res) => {
  const ins = db.prepare(`SELECT i.id FROM inspirations i JOIN clients c ON c.id = i.client_id
    WHERE i.id = ? AND c.user_id = ?`).get(req.params.id, req.session.userId);
  if (!ins) return res.sendStatus(404);
  const flag = req.body?.is_template ? 1 : 0;
  db.prepare('UPDATE inspirations SET is_template = ? WHERE id = ?').run(flag, ins.id);
  res.json({ ok: true, is_template: flag });
});
app.post('/api/templates/:id/apply', requireAuth, (req, res) => {
  // Cloner une inspiration vers un autre client
  const tplId = req.params.id;
  const targetClientId = req.body?.client_id;
  const tpl = db.prepare(`SELECT i.* FROM inspirations i JOIN clients c ON c.id = i.client_id
    WHERE i.id = ? AND c.user_id = ?`).get(tplId, req.session.userId);
  if (!tpl) return res.sendStatus(404);
  if (!ownClient(req.session.userId, targetClientId)) return res.status(400).json({ error: 'client cible invalide' });
  const max = db.prepare('SELECT COALESCE(MAX(position),0) AS m FROM inspirations WHERE client_id = ?').get(targetClientId).m;
  const newIns = db.prepare(`INSERT INTO inspirations (client_id, title, main_image, position, is_template)
    VALUES (?,?,?,?,0)`).run(targetClientId, tpl.title, tpl.main_image, max + 1);
  // cloner pièces + refs
  const pieces = db.prepare('SELECT * FROM pieces WHERE inspiration_id = ? ORDER BY position').all(tpl.id);
  for (const p of pieces) {
    const np = db.prepare(`INSERT INTO pieces (inspiration_id, label, anchor_x, anchor_y, position)
      VALUES (?,?,?,?,?)`).run(newIns.lastInsertRowid, p.label, p.anchor_x, p.anchor_y, p.position);
    const refs = db.prepare('SELECT * FROM refs WHERE piece_id = ? ORDER BY position').all(p.id);
    for (const r of refs) {
      db.prepare(`INSERT INTO refs (piece_id, brand, name, link, image, position)
        VALUES (?,?,?,?,?,?)`).run(np.lastInsertRowid, r.brand, r.name, r.link, r.image, r.position);
    }
  }
  res.json({ ok: true, id: newIns.lastInsertRowid });
});

/* ─────────── Notifications ─────────── */
app.get('/api/clients/:id/notifications', requireAuth, (req, res) => {
  if (!ownClient(req.session.userId, req.params.id)) return res.sendStatus(404);
  res.json(db.prepare('SELECT * FROM notifications WHERE client_id = ? ORDER BY id DESC LIMIT 50').all(req.params.id));
});

/* ─────────── Événements (analytics) ─────────── */
app.post('/api/public/:slug/event', (req, res) => {
  const c = db.prepare('SELECT id FROM clients WHERE slug = ?').get(req.params.slug);
  if (!c) return res.sendStatus(404);
  const { kind, target_id, x, y, duration_ms, meta } = req.body || {};
  db.prepare(`INSERT INTO events (client_id, kind, target_id, x, y, duration_ms, meta)
    VALUES (?,?,?,?,?,?,?)`).run(c.id, kind || 'unknown', target_id || null, x ?? null, y ?? null, duration_ms ?? null, meta ? JSON.stringify(meta) : null);
  // marquer derniere vue
  if (kind === 'view_page') {
    db.prepare("UPDATE clients SET last_viewed_at = datetime('now') WHERE id = ?").run(c.id);
  }
  res.json({ ok: true });
});
app.post('/api/public/:slug/notifications/read', (req, res) => {
  const c = db.prepare('SELECT id FROM clients WHERE slug = ?').get(req.params.slug);
  if (!c) return res.sendStatus(404);
  db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE client_id = ? AND read_at IS NULL").run(c.id);
  res.json({ ok: true });
});

/* ─────────── Heatmap ─────────── */
app.get('/api/inspirations/:id/heatmap', requireAuth, (req, res) => {
  const ins = db.prepare(`SELECT i.id FROM inspirations i JOIN clients c ON c.id = i.client_id
    WHERE i.id = ? AND c.user_id = ?`).get(req.params.id, req.session.userId);
  if (!ins) return res.sendStatus(404);
  const rows = db.prepare(`SELECT x, y, COUNT(*) AS w
    FROM events WHERE kind IN ('click_hotspot','click_image') AND target_id = ?
    GROUP BY ROUND(x,1), ROUND(y,1)`).all(req.params.id);
  res.json(rows);
});

/* ─────────── Dashboard / stats ─────────── */
app.get('/api/dashboard', requireAuth, (req, res) => {
  const u = req.session.userId;
  const clients = db.prepare('SELECT id, name, slug, last_viewed_at, status FROM clients WHERE user_id = ?').all(u);
  // CA estimé : somme amounts non-deleted * conversion (uniformisée 1.0)
  const revenue = db.prepare(`SELECT COALESCE(SUM(i.amount), 0) AS s, COUNT(*) AS n
    FROM items i JOIN clients c ON c.id = i.client_id
    WHERE c.user_id = ? AND i.deleted_at IS NULL`).get(u);
  // Top marques
  const topBrands = db.prepare(`SELECT brand, COUNT(*) AS n FROM items i
    JOIN clients c ON c.id = i.client_id
    WHERE c.user_id = ? AND i.deleted_at IS NULL AND brand IS NOT NULL AND brand <> ''
    GROUP BY brand ORDER BY n DESC LIMIT 10`).all(u);
  // Top catégories
  const topCats = db.prepare(`SELECT cat, COUNT(*) AS n FROM items i
    JOIN clients c ON c.id = i.client_id
    WHERE c.user_id = ? AND i.deleted_at IS NULL AND cat IS NOT NULL AND cat <> ''
    GROUP BY cat ORDER BY n DESC LIMIT 10`).all(u);
  // Vues totales / clics totaux
  const events = db.prepare(`SELECT kind, COUNT(*) AS n FROM events e
    JOIN clients c ON c.id = e.client_id
    WHERE c.user_id = ?
    GROUP BY kind`).all(u);
  // Clients dormants (>30j)
  const dormant = db.prepare(`SELECT id, name, slug, last_viewed_at FROM clients
    WHERE user_id = ?
      AND (last_viewed_at IS NULL OR last_viewed_at < datetime('now','-30 days'))
    ORDER BY COALESCE(last_viewed_at, '') ASC LIMIT 10`).all(u);
  // Anniversaires à venir (30 prochains jours, format MM-DD)
  const birthdays = db.prepare(`SELECT id, name, birthday FROM clients
    WHERE user_id = ? AND birthday IS NOT NULL AND birthday <> ''
  `).all(u);
  const upcomingBirthdays = birthdays.map(b => {
    const today = new Date();
    const [, m, d] = (b.birthday || '').split('-');
    if (!m || !d) return null;
    const next = new Date(today.getFullYear(), parseInt(m)-1, parseInt(d));
    if (next < today) next.setFullYear(today.getFullYear() + 1);
    const days = Math.round((next - today) / (1000*60*60*24));
    return { ...b, in_days: days };
  }).filter(Boolean).filter(b => b.in_days <= 30).sort((a,b) => a.in_days - b.in_days);
  // Actions à venir
  const actions = db.prepare(`SELECT id, name, next_action, next_action_at FROM clients
    WHERE user_id = ? AND next_action IS NOT NULL AND next_action <> ''
    ORDER BY COALESCE(next_action_at, '') ASC LIMIT 20`).all(u);
  res.json({
    clients_count: clients.length,
    items_count: revenue.n,
    revenue_estimated: Math.round(revenue.s),
    top_brands: topBrands,
    top_cats: topCats,
    events: Object.fromEntries(events.map(e => [e.kind, e.n])),
    dormant_clients: dormant,
    upcoming_birthdays: upcomingBirthdays,
    actions
  });
});

/* ─────────── Rapport client (HTML imprimable) ─────────── */
app.get('/api/clients/:id/report', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!c) return res.sendStatus(404);
  const items = db.prepare(`SELECT * FROM items WHERE client_id = ? AND deleted_at IS NULL ORDER BY position`).all(c.id);
  const insps = db.prepare('SELECT * FROM inspirations WHERE client_id = ? ORDER BY position').all(c.id);
  const events = db.prepare(`SELECT kind, COUNT(*) AS n FROM events WHERE client_id = ? GROUP BY kind`).all(c.id);
  const topItems = db.prepare(`SELECT i.brand, i.name, i.image, COUNT(e.id) AS clicks
    FROM events e JOIN items i ON i.id = e.target_id
    WHERE e.client_id = ? AND e.kind = 'click_item'
    GROUP BY i.id ORDER BY clicks DESC LIMIT 8`).all(c.id);
  const total = items.reduce((s, i) => s + (i.amount || 0), 0);
  const today = new Date().toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' });
  const user = db.prepare('SELECT studio_name, name, photo_url FROM users WHERE id = ?').get(c.user_id);
  const studioName = (user.studio_name || 'STUDIO').toUpperCase();
  const eventsMap = Object.fromEntries(events.map(e => [e.kind, e.n]));

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
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
        <div class="p"><em>${i.clicks} clic${i.clicks>1?'s':''}</em></div>
      </div>`).join('') : '<div style="grid-column:1/-1;font-style:italic;color:var(--muted);font-family:\'Cormorant Garamond\',serif;">Aucun clic enregistré pour le moment.</div>'}
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
});

/* ─────────── Auth client (magic link + email/password) ─────────── */
function clientFromSession(req) {
  if (!req.session?.clientId) return null;
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(req.session.clientId);
}

// Inviter un client par email — génère un magic link, retourne l'URL (à envoyer manuellement ou via Resend plus tard)
app.post('/api/clients/:id/invite', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!c) return res.sendStatus(404);
  const email = req.body?.email || c.email;
  if (!email) return res.status(400).json({ error: 'email requis' });
  const token = nanoid(40);
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(); // 7j
  db.prepare(`UPDATE clients SET email = ?, magic_token = ?, magic_expires = ? WHERE id = ?`)
    .run(email.toLowerCase().trim(), token, expires, c.id);
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const url = `${proto}://${host}/c/auth/magic/${token}`;
  console.log(`\n📩 Lien magique pour ${email} :\n   ${url}\n`);
  res.json({ ok: true, url, email, expires });
});

// Consommer un magic link — crée la session client + redirige vers son espace
app.get('/c/auth/magic/:token', (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE magic_token = ?').get(req.params.token);
  if (!c) return res.status(401).send('<p style="font-family:sans-serif;padding:60px;text-align:center;">Lien invalide ou déjà utilisé.</p>');
  if (c.magic_expires && new Date(c.magic_expires) < new Date()) {
    return res.status(401).send('<p style="font-family:sans-serif;padding:60px;text-align:center;">Lien expiré. Demandez-en un nouveau via la page de connexion.</p>');
  }
  // active la session
  req.session.clientId = c.id;
  const now = new Date().toISOString();
  db.prepare(`UPDATE clients SET
    claimed_at = COALESCE(claimed_at, ?),
    last_login_at = ?,
    magic_token = NULL,
    magic_expires = NULL
    WHERE id = ?`).run(now, now, c.id);
  res.redirect(`/c/${c.slug}`);
});

// Demande d'un nouveau lien magique par email (côté client public)
app.post('/c/auth/magic-link', (req, res) => {
  const email = (req.body?.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'email requis' });
  const c = db.prepare('SELECT id, slug FROM clients WHERE email = ?').get(email);
  // Pour ne pas révéler l'existence, on répond toujours OK — mais on génère que si compte trouvé.
  if (c) {
    const token = nanoid(40);
    const expires = new Date(Date.now() + 1000 * 60 * 30).toISOString(); // 30 min
    db.prepare('UPDATE clients SET magic_token = ?, magic_expires = ? WHERE id = ?').run(token, expires, c.id);
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const url = `${proto}://${host}/c/auth/magic/${token}`;
    console.log(`\n📩 Magic link pour ${email} :\n   ${url}\n`);
  }
  res.json({ ok: true });
});

// Login email + mot de passe
app.post('/c/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email + mot de passe requis' });
  const c = db.prepare('SELECT * FROM clients WHERE email = ?').get(email.toLowerCase().trim());
  if (!c || !c.password_hash || !bcrypt.compareSync(password, c.password_hash)) {
    return res.status(401).json({ error: 'identifiants invalides' });
  }
  req.session.clientId = c.id;
  const now = new Date().toISOString();
  db.prepare(`UPDATE clients SET last_login_at = ?, claimed_at = COALESCE(claimed_at, ?) WHERE id = ?`)
    .run(now, now, c.id);
  res.json({ ok: true, slug: c.slug });
});

// Logout client
app.post('/c/auth/logout', (req, res) => {
  delete req.session.clientId;
  res.json({ ok: true });
});

// Le client définit / change son mot de passe (doit être connecté via magic ou pwd actuel)
app.post('/c/auth/set-password', (req, res) => {
  const c = clientFromSession(req);
  if (!c) return res.status(401).json({ error: 'non connecté' });
  const { password, current } = req.body || {};
  if (!password || password.length < 6) return res.status(400).json({ error: 'mot de passe trop court (min 6)' });
  if (c.password_hash) {
    // changement : vérifier le mot de passe actuel
    if (!current || !bcrypt.compareSync(current, c.password_hash)) {
      return res.status(400).json({ error: 'mot de passe actuel invalide' });
    }
  }
  db.prepare('UPDATE clients SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), c.id);
  res.json({ ok: true });
});

// Statut session client (utilisé par la vue publique)
app.get('/c/auth/me', (req, res) => {
  const c = clientFromSession(req);
  if (!c) return res.json({ logged: false });
  res.json({
    logged: true,
    id: c.id, slug: c.slug, name: c.name, email: c.email,
    has_password: !!c.password_hash
  });
});

/* ─────────── Public (sans auth) ─────────── */
app.get('/api/public/:slug', (req, res) => {
  const c = db.prepare(`SELECT id, user_id, slug, name, note, welcome_message, photo_url,
    profile_filled_by FROM clients WHERE slug = ?`).get(req.params.slug);
  if (!c) return res.sendStatus(404);
  const u = db.prepare(`SELECT name, studio_name, studio_logo, accent_color, photo_url, bio
    FROM users WHERE id = ?`).get(c.user_id);
  const items = db.prepare('SELECT * FROM items WHERE client_id = ? AND deleted_at IS NULL ORDER BY position, id').all(c.id);
  const insps = db.prepare('SELECT * FROM inspirations WHERE client_id = ? ORDER BY position, id').all(c.id);
  insps.forEach(i => {
    i.pieces = db.prepare('SELECT * FROM pieces WHERE inspiration_id = ? ORDER BY position, id').all(i.id);
    i.pieces.forEach(p => {
      p.refs = db.prepare('SELECT * FROM refs WHERE piece_id = ? ORDER BY position, id').all(p.id);
    });
  });
  const unread = db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE client_id = ? AND read_at IS NULL`).get(c.id).n;
  // récents = pièces ajoutées dans les 7 derniers jours
  const recentIds = new Set(db.prepare(`SELECT id FROM items WHERE client_id = ? AND created_at > datetime('now','-7 days') AND deleted_at IS NULL`).all(c.id).map(r => r.id));
  items.forEach(it => it.is_new = recentIds.has(it.id));
  delete c.user_id;
  res.json({ client: c, studio: u, items, inspirations: insps, unread_notifications: unread });
});

app.get('/api/public/:slug/profile', (req, res) => {
  const c = db.prepare('SELECT profile_json, profile_filled_by, name FROM clients WHERE slug = ?').get(req.params.slug);
  if (!c) return res.sendStatus(404);
  res.json({
    name: c.name,
    profile: c.profile_json ? JSON.parse(c.profile_json) : null,
    filled_by: c.profile_filled_by
  });
});

app.post('/api/public/:slug/profile', (req, res) => {
  const c = db.prepare('SELECT id, profile_filled_by FROM clients WHERE slug = ?').get(req.params.slug);
  if (!c) return res.sendStatus(404);
  const { profile, photo_url } = req.body || {};
  // Photo : toujours autorisée (même si shopper a rempli le reste)
  if (photo_url !== undefined) {
    db.prepare('UPDATE clients SET photo_url = ? WHERE id = ?').run(photo_url || null, c.id);
  }
  // Profil structuré : on refuse si shopper a rempli
  if (profile) {
    if (c.profile_filled_by === 'shopper') {
      return res.status(403).json({ error: 'Profil déjà complété par votre styliste.' });
    }
    db.prepare('UPDATE clients SET profile_json = ?, profile_filled_by = ? WHERE id = ?')
      .run(JSON.stringify(profile), 'client', c.id);
  }
  res.json({ ok: true });
});

/* ─────────── Scraping URL produit ─────────── */
app.post('/api/scrape', requireAuth, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url requise' });
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Studio/1.0'
      },
      redirect: 'follow'
    });
    const html = await r.text();
    const parsed = parseProduct(html, url);
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: 'scraping échoué : ' + e.message });
  }
});

// Extrait juste la partie numérique (et la décimale) d'un prix bruité
function cleanAmount(raw) {
  if (raw == null) return '';
  const m = String(raw).match(/\d+(?:[.,]\d{1,2})?/);
  return m ? m[0] : '';
}
function detectCurrency(raw) {
  if (!raw) return '';
  const s = String(raw).toUpperCase();
  if (s.includes('€') || s.includes('EUR')) return '€';
  if (s.includes('£') || s.includes('GBP')) return '£';
  if (s.includes('$') || s.includes('USD')) return '$';
  if (s.includes('CHF'))                    return 'CHF';
  return '';
}
function looksLikeDomain(s) {
  return /^[a-z0-9-]+(\.[a-z]{2,})+(\/.*)?$/i.test((s || '').trim());
}

function parseProduct(html, sourceUrl) {
  const result = { brand: '', name: '', price: '', image: '', description: '', link: sourceUrl };
  const meta = (...names) => {
    for (const n of names) {
      const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*content=["']([^"']*)["']`, 'i');
      const m = html.match(re);
      if (m && m[1]) return decode(m[1].trim());
      const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i');
      const m2 = html.match(re2);
      if (m2 && m2[1]) return decode(m2[1].trim());
    }
    return '';
  };
  result.name        = meta('og:title', 'twitter:title') || titleTag(html);
  result.description = meta('og:description', 'description', 'twitter:description');
  result.image       = meta('og:image', 'og:image:secure_url', 'twitter:image');
  result.brand       = meta('product:brand', 'og:brand', 'og:site_name');
  const amount       = meta('product:price:amount', 'og:price:amount', 'twitter:data1');
  const currencyRaw  = meta('product:price:currency', 'og:price:currency');
  if (amount) {
    const cleaned = cleanAmount(amount);
    const cur     = detectCurrency(currencyRaw) || detectCurrency(amount);
    if (cleaned) result.price = cur ? `${cur} ${cleaned}` : cleaned;
  }

  // JSON-LD product schema fallback
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
          result.image = result.image || (typeof obj.image === 'string' ? obj.image : (Array.isArray(obj.image) ? obj.image[0] : (obj.image?.url || '')));
          result.brand = result.brand || (typeof obj.brand === 'string' ? obj.brand : (obj.brand?.name || ''));
          result.description = result.description || obj.description || '';
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
  // Nettoyage marque (souvent = marketplace, pas la vraie marque)
  if (/zalando|amazon|asos|net-a-porter|mrporter|farfetch|urbanoutfitters|urban outfitters/i.test(result.brand)) result.brand = '';
  // Nettoyage nom : si c'est juste un domaine (urbanoutfitters.com), on vide
  if (looksLikeDomain(result.name)) result.name = '';
  // Nom souvent du type "Produit | Marque" ou "Produit - Marque" → on garde juste la partie avant
  if (result.name) {
    const split = result.name.split(/\s+[|\-–—]\s+/);
    if (split.length > 1 && split[0].length > 4) result.name = split[0];
  }
  return result;
}
function titleTag(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decode(m[1].trim()) : '';
}
function decode(s) {
  return s
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#x27;/g,"'")
    .replace(/&nbsp;/g,' ').replace(/&euro;/g,'€').replace(/&pound;/g,'£');
}

/* ─────────── Try-on virtuel (Replicate IDM-VTON) ─────────── */
app.post('/api/tryon', requireAuth, async (req, res) => {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(503).json({ error: 'not_configured', message: 'Définir REPLICATE_API_TOKEN pour activer le try-on.' });
  const { human_url, garment_url, category } = req.body || {};
  if (!human_url || !garment_url) return res.status(400).json({ error: 'human_url + garment_url requis' });
  try {
    const start = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // IDM-VTON par cuuupid
        version: 'c871bb9b046607b680449b698388e3cb35e1edab98e9eb7d33c6ddd3a13d3c9d',
        input: {
          human_img:   human_url,
          garm_img:    garment_url,
          garment_des: category || 'a garment'
        }
      })
    });
    const pred = await start.json();
    if (pred.error) return res.status(500).json({ error: pred.error });
    // poll jusqu'à 60s
    let out = pred;
    for (let i = 0; i < 30 && out.status !== 'succeeded' && out.status !== 'failed'; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const p = await fetch(out.urls.get, { headers: { 'Authorization': `Token ${token}` } });
      out = await p.json();
    }
    if (out.status === 'succeeded') res.json({ image: Array.isArray(out.output) ? out.output[0] : out.output });
    else res.status(500).json({ error: 'tryon failed', detail: out.error || out.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ─────────── Static + routes pages ─────────── */
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/admin/templates', (req, res) => res.sendFile(path.join(__dirname, 'public', 'templates.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/c/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'client-login.html')));
app.get('/c/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/c/:slug/profile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/', (req, res) => res.redirect('/admin'));

app.listen(PORT, () => console.log(`▸ Studio est lancé sur http://localhost:${PORT}`));
