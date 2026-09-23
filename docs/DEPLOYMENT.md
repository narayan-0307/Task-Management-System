# Task Management System — Full Deployment Guide

End-to-end, copy-paste deployment for the whole project:

| Component | Stack | Where it runs |
|---|---|---|
| **Task-Manager-Backend** | Node.js + Express + Sequelize + Socket.IO | Railway (web service) |
| **MySQL database** | MySQL 8 | Railway (managed plugin) |
| **Task-Manager-Frontend** | React + Vite (static SPA) | Railway (static server) / any static host |
| **Task-Monitoring-Agent** | Electron desktop app | Built locally, installed on each monitored PC |

> Railway is the reference target (matches `agent.config.json` and `docs/RAILWAY_DEPLOYMENT.md`). A generic VPS path is in [Appendix A](#appendix-a--deploy-on-a-plain-vps-ubuntu).

---

## 0. Prerequisites

```bash
# Tooling on your machine
node -v          # >= 18
npm -v
git --version

# Railway CLI (used for migrations + logs)
npm i -g @railway/cli
railway login
```

- Push the repo to GitHub — Railway deploys from a GitHub repo.
- Have your Google OAuth credentials ready if "Sign in with Google" is required
  (https://console.cloud.google.com/apis/credentials).

```bash
cd "Task Management System"
git add -A
git commit -m "Prepare for deployment"
git push origin main
```

---

## 1. Create the Railway project + MySQL

1. Railway dashboard → **New Project** → **Deploy MySQL** (or **New → Database → Add MySQL**).
2. Open the MySQL service → **Variables** tab. Railway auto-creates:
   `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`.
   You will reference these from the backend (do **not** copy-paste the values).

---

## 2. Deploy the Backend (`Task-Manager-Backend`)

### 2.1 Create the service

Dashboard → **New → GitHub Repo** → pick this repo. Then the service **Settings**:

| Setting | Value |
|---|---|
| **Root Directory** | `Task-Manager-Backend` |
| **Build Command** | *(leave empty — Nixpacks runs `npm install`)* |
| **Start Command** | `npm start` |

> `npm start` = `npm run migrate && node index.js` (see [package.json](../Task-Manager-Backend/package.json)).
> Migrations are idempotent (tracked in `SequelizeMeta`), so running them on every
> boot is safe.

### 2.2 Environment variables

Backend service → **Variables** → add:

```
DB_HOST=${{MySQL.MYSQLHOST}}
DB_PORT=${{MySQL.MYSQLPORT}}
DB_NAME=${{MySQL.MYSQLDATABASE}}
DB_USER=${{MySQL.MYSQLUSER}}
DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}

JWT_SECRET=<paste output of: openssl rand -hex 32>
JWT_EXPIRES_IN=7d
SESSION_SECRET=<paste output of: openssl rand -hex 32>

# Set AFTER the frontend domain exists (step 3), then redeploy:
FRONTEND_URL=https://<your-frontend>.up.railway.app

# Google OAuth — optional, only if using Google login:
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
GOOGLE_CALLBACK_URL=https://<your-backend>.up.railway.app/api/auth/google/callback
```

Generate secrets locally:

```bash
openssl rand -hex 32   # run twice — one for JWT_SECRET, one for SESSION_SECRET
```

> Do **not** set `PORT` — Railway injects it and the app reads `process.env.PORT`.

### 2.3 Public domain

Settings → **Networking** → **Generate Domain** → note the
`https://<your-backend>.up.railway.app` URL.

### 2.4 Run / verify migrations

`npm start` runs them automatically. To run them manually or re-check:

```bash
railway link                       # select this project
railway service                    # select Task-Manager-Backend
railway run npx sequelize-cli db:migrate --env production

# check status
railway run npx sequelize-cli db:migrate:status --env production
```

### 2.5 Verify backend

```bash
curl https://<your-backend>.up.railway.app/api/health
# -> {"status":"ok","message":"Server is running"}
```

Check logs if it fails: service → **Deployments** → **View Logs**, or:

```bash
railway logs
```

### 2.6 File uploads caveat

`index.js` serves `./uploads` from local disk. **Railway's filesystem is ephemeral** —
uploaded attachments are wiped on every redeploy. For real production, attach a
Railway **Volume** mounted at `Task-Manager-Backend/uploads`, or move storage to
S3 / Cloudflare R2.

---

## 3. Deploy the Frontend (`Task-Manager-Frontend`)

### 3.1 Create the service

Dashboard → **New → GitHub Repo** → same repo again (second service). **Settings**:

| Setting | Value |
|---|---|
| **Root Directory** | `Task-Manager-Frontend` |
| **Build Command** | `npm run build` |
| **Start Command** | `npx serve -s dist -l $PORT` |

### 3.2 Environment variable

Frontend service → **Variables**:

```
VITE_API_URL=https://<your-backend>.up.railway.app
```

> No `/api` suffix — `src/api/client.js` appends it. `VITE_*` vars are baked in at
> **build time**, so this must be set **before** the first build. Change it later →
> trigger a redeploy.

### 3.3 Public domain

Settings → **Networking** → **Generate Domain** → note the frontend URL.

### 3.4 Local build test (optional, before deploying)

```bash
cd Task-Manager-Frontend
npm install
VITE_API_URL=https://<your-backend>.up.railway.app npm run build
npx serve -s dist -l 4173     # open http://localhost:4173
```

---

## 4. Wire the two services together

1. Set the backend's `FRONTEND_URL` variable to the frontend domain → **redeploy backend**
   (Railway does this automatically on variable change).
2. Socket.IO needs no extra config — `src/lib/socket.js` derives the backend origin
   from `VITE_API_URL`.
3. If using Google Sign-In, add the redirect URI in Google Cloud Console →
   Credentials → your OAuth client → **Authorized redirect URIs**:
   ```
   https://<your-backend>.up.railway.app/api/auth/google/callback
   ```

---

## 5. Full deployment smoke test

```bash
# 1. Backend health
curl https://<your-backend>.up.railway.app/api/health

# 2. Register a user via the API
curl -X POST https://<your-backend>.up.railway.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","email":"admin@example.com","password":"Passw0rd!","organizationName":"Acme"}'
```

3. Open `https://<your-frontend>.up.railway.app` → register / log in → create a
   project and a task. Confirm the Network tab hits the backend domain and that
   real-time updates (Socket.IO) work across two browser tabs.

---

## 6. Deploy the Monitoring Agent (`Task-Monitoring-Agent`)

The agent is an **Electron desktop app** installed on each PC you want to monitor.
It talks to the deployed backend.

### 6.1 Point it at production

Edit [agent.config.json](../Task-Monitoring-Agent/agent.config.json):

```json
{
  "apiBaseUrl": "https://<your-backend>.up.railway.app/api",
  "agentUuid": "",
  "agentSecret": "",
  "heartbeatIntervalSeconds": 30,
  "activityPollIntervalSeconds": 5,
  "activityBufferMaxSize": 10,
  "idleThresholdSeconds": 60
}
```

Leave `agentUuid` / `agentSecret` blank — they are filled in during enrollment
(an admin generates an enrollment token in the app's Monitoring UI; the agent
exchanges it on first run and stores the credentials locally).

### 6.2 Build the Windows installer

```bash
cd Task-Monitoring-Agent
npm install
npm run build          # electron-builder -> NSIS installer
```

Output: `Task-Monitoring-Agent/dist/Task Monitoring Agent Setup <version>.exe`

### 6.3 Install & run on a monitored machine

1. Copy the `Setup .exe` to the target PC and run it (per-user install, creates
   desktop + start-menu shortcuts, configurable install dir).
2. Launch **Task Monitoring Agent**. It lives in the system tray.
3. Enter the enrollment token from an org admin. The agent enrolls, saves its
   credentials, and starts sending heartbeats + activity.

### 6.4 Test without building (dev)

```bash
cd Task-Monitoring-Agent
npm start                 # run the Electron app from source
npm run heartbeat         # one-off heartbeat check
npm run agent             # run the headless agent loop
npm run test:agent
```

---

## 7. Ongoing deploys

- **Backend / Frontend**: every push to `main` auto-redeploys the changed service
  (Railway scopes each service to its Root Directory, so a backend-only change
  won't rebuild the frontend).
- **New DB migration**: commit the file under `Task-Manager-Backend/migrations/`;
  it runs automatically on the next backend deploy via `npm start`.
- **Agent**: bump `version` in [package.json](../Task-Monitoring-Agent/package.json),
  `npm run build`, distribute the new installer.

---

## Appendix A — Deploy on a plain VPS (Ubuntu)

### A.1 Server setup

```bash
sudo apt update && sudo apt install -y nginx mysql-server
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```

### A.2 Database

```bash
sudo mysql -e "CREATE DATABASE task_manager CHARACTER SET utf8mb4;"
sudo mysql -e "CREATE USER 'tms'@'localhost' IDENTIFIED BY 'STRONG_PASSWORD';"
sudo mysql -e "GRANT ALL ON task_manager.* TO 'tms'@'localhost'; FLUSH PRIVILEGES;"
```

### A.3 Backend

```bash
git clone <repo-url> /var/www/tms
cd /var/www/tms/Task-Manager-Backend
npm ci --omit=dev
cp .env.example .env
nano .env      # set DB_*, JWT_SECRET, SESSION_SECRET, FRONTEND_URL, PORT=5000

npx sequelize-cli db:migrate --env production
pm2 start index.js --name tms-backend
pm2 save && pm2 startup
```

### A.4 Frontend

```bash
cd /var/www/tms/Task-Manager-Frontend
npm ci
echo "VITE_API_URL=https://api.yourdomain.com" > .env
npm run build
# serve dist/ with nginx
```

### A.5 Nginx

```nginx
# /etc/nginx/sites-available/tms
server {
    server_name yourdomain.com;
    root /var/www/tms/Task-Manager-Frontend/dist;
    index index.html;
    location / { try_files $uri /index.html; }
}

server {
    server_name api.yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;      # Socket.IO
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/tms /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d api.yourdomain.com
```

### A.6 Redeploy

```bash
cd /var/www/tms && git pull
cd Task-Manager-Backend && npm ci --omit=dev && npx sequelize-cli db:migrate --env production && pm2 restart tms-backend
cd ../Task-Manager-Frontend && npm ci && npm run build
```

---

## Environment variable reference

### Backend (`Task-Manager-Backend/.env`)

| Var | Required | Notes |
|---|---|---|
| `PORT` | VPS only | Railway injects it automatically |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | yes | MySQL connection |
| `JWT_SECRET` | yes | long random string |
| `JWT_EXPIRES_IN` | yes | e.g. `7d` |
| `SESSION_SECRET` | yes | long random string (passport session cookie) |
| `FRONTEND_URL` | yes | frontend origin — OAuth redirect + CORS hardening |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | optional | Google login only |

### Frontend (`Task-Manager-Frontend/.env`)

| Var | Required | Notes |
|---|---|---|
| `VITE_API_URL` | yes | backend origin, **no** `/api` suffix; baked in at build time |

### Monitoring Agent (`Task-Monitoring-Agent/agent.config.json`)

| Key | Notes |
|---|---|
| `apiBaseUrl` | backend origin **with** `/api` suffix |
| `agentUuid` / `agentSecret` | leave blank — set during enrollment |
| `heartbeatIntervalSeconds` / `activityPollIntervalSeconds` / `activityBufferMaxSize` / `idleThresholdSeconds` | tuning knobs |
