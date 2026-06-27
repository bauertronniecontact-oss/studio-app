# Studio — Personal Shopping Platform

Plateforme full-stack pour personal shoppers :
- **Sélection** — liste de vêtements avec lien d'achat par client
- **Inspiration Style** — looks complets avec points d'ancrage cliquables reliés à des boxes de pièces (chaque box peut contenir plusieurs références navigables)

## Stack

- Node.js + Express
- SQLite (`better-sqlite3`) — fichier local, zéro config
- Sessions cookie (`express-session`) + `bcryptjs`
- Frontend vanilla JS (HTML/CSS/JS), pas de build

## Démarrer

```bash
cd studio-app
npm install
npm start
```

Premier lancement : un compte personal shopper est créé automatiquement et **les identifiants sont imprimés dans le terminal** :

```
email    : admin@studio.local
password : studio2026
```

Puis ouvre :
- `http://localhost:3000/login` — connexion shopper
- `http://localhost:3000/admin` — espace shopper
- `http://localhost:3000/c/<slug>` — vue publique d'un client (URL générée à la création du client)

## Utilisation

1. **Se connecter** sur `/login`.
2. **Créer un client** depuis la sidebar (+ Nouveau client).
3. **Sélection** : ajouter les pièces (marque, nom, prix, lien d'achat, image URL, description).
4. **Inspiration Style** :
   - Créer une inspiration avec un titre + URL de l'image du look complet.
   - Ajouter des pièces (Veste, Pantalon, Chaussures…) — chacune crée une box à droite.
   - **Sélectionner une pièce puis cliquer sur l'image** pour positionner son point d'ancrage. Un trait apparaîtra entre le point et la box.
   - Pour chaque pièce, ajouter **plusieurs références** (marque, nom, lien, image). Le client navigue entre elles avec ◀ ▶.
5. **Partager** : bouton "Copier le lien" en haut → envoie l'URL `/c/<slug>` au client.

## Structure

```
studio-app/
├── server.js             API REST + auth + statics
├── package.json
├── data/                 SQLite (créé au runtime)
└── public/
    ├── index.html        Vue publique client
    ├── admin.html        Espace shopper (SPA vanilla)
    ├── login.html
    ├── css/style.css
    └── js/
        ├── public.js
        └── admin.js
```

## Sécurité (avant déploiement réel)

- Changer `SESSION_SECRET` (env var)
- Changer le mot de passe admin par défaut
- Servir derrière HTTPS, cookie `secure: true`
- Rate-limiter `/api/auth/login`
- Sanitiser plus strictement les URLs uploadées (CSP)
