# Installation & Setup Guide

Complete installation instructions for TrackTrail.

---

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Pre-Installation Checklist](#pre-installation-checklist)
3. [Backend Setup](#backend-setup)
4. [Frontend Setup](#frontend-setup)
5. [Database Configuration](#database-configuration)
6. [Environment Setup](#environment-setup)
7. [Running the Application](#running-the-application)
8. [Verification](#verification)
9. [Troubleshooting](#troubleshooting)

---

## System Requirements

### Minimum Requirements

| Requirement | Version                                                                       | Download                                        |
| ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| Node.js     | 18.x or higher                                                                | [nodejs.org](https://nodejs.org)                |
| npm         | 9.x or higher                                                                 | Comes with Node.js                              |
| PostgreSQL  | Hosted instance (Neon, Supabase, Render, etc.)                                | No local install needed — just a connection URL |
| Redis       | Local or hosted (Upstash, etc.) — required for the worker process             | [redis.io](https://redis.io)                    |
| Git         | Latest                                                                        | [git-scm.com](https://git-scm.com)              |

### Recommended Specifications

- **OS**: Windows 10+, macOS 10.15+, or Ubuntu 20.04+
- **RAM**: 4GB minimum
- **Storage**: 2GB free space
- **Browser**: Chrome, Firefox, Safari, or Edge (latest versions)

---

## Pre-Installation Checklist

- [ ] Node.js installed and accessible via terminal
- [ ] npm installed
- [ ] A hosted PostgreSQL connection string ready (no local Postgres install needed)
- [ ] A Redis instance ready (local or hosted) if you plan to run the background workers
- [ ] Git installed
- [ ] Code editor (VSCode recommended)
- [ ] 2GB free disk space
- [ ] Stable internet connection

**Verify installations:**

```bash
# Check Node.js version
node --version
# Expected: v18.0.0 or higher

# Check npm version
npm --version
# Expected: 9.0.0 or higher

# Check Git version
git --version
# Expected: git version 2.x.x or higher
```

---

## Backend Setup

### Step 1: Navigate to Server Directory

```bash
cd TrackTrail
cd server
```

### Step 2: Install Dependencies

```bash
npm install
```

**Expected output:**

```
added XXX packages, and audited XXX packages in Xs
```

### Step 3: Verify Installation

```bash
npm list
```

This shows all installed packages and their versions.

### Step 4: Create `.env` File (inside `server/`)

```bash
cp .env.example .env
```

Edit `.env` with your Postgres connection string, JWT secret, and (optionally)
Gmail/Redis/Resend configuration — see [Environment Setup](#environment-setup) below.

### Step 5 (one-time): Set Up the Database with Prisma

This project uses **Prisma**, not a hand-written SQL schema file.

```bash
npx prisma generate       # generates the Prisma client from prisma/schema.prisma
npx prisma migrate deploy # applies the committed migrations against DATABASE_URL
```

Safe to re-run. Creates every table the app needs, both the auth/tracker
tables and the intelligent job-application engine's tables.

> `npm run db:migrate` also exists in `package.json` but is dead code from an
> earlier, pre-Prisma version of this project — it tries to read a
> `db/schema.sql` file that no longer exists in the repository and will
> fail. Use the `prisma` commands above instead.

---

## Frontend Setup

### Step 1: Navigate to Client Directory

```bash
cd client
```

### Step 2: Install Dependencies

```bash
npm install
```

**Expected output:**

```
added XXX packages, and audited XXX packages in Xs
```

### Step 3: Verify Installation

```bash
npm list
```

### Step 4: Environment Configuration (Optional)

If you need to point the frontend at a specific backend, create/edit `.env` in
the `client` directory:

```env
VITE_API_BASE_URL=https://your-deployed-backend.example.com
```

Falls back to `http://localhost:5000` if unset.

---

## Database Configuration

This project uses a **single hosted PostgreSQL database** — there is no local
Postgres server to install or run. Pick any provider that gives you a
connection URL:

### Option A: Neon (recommended — generous free tier)

1. Go to [neon.tech](https://neon.tech) and create a free account.
2. Create a project/database.
3. Copy the connection string shown in the dashboard (it already includes
   `?sslmode=require`).

### Option B: Supabase

1. Go to [supabase.com](https://supabase.com) and create a free project.
2. Go to **Project Settings → Database** and copy the connection string
   (use the "Connection pooling" URI for serverless-style usage, or the
   direct URI for a long-running server).

### Option C: Render Postgres

1. In the [Render dashboard](https://render.com), create a new **PostgreSQL**
   instance.
2. Copy the **External Connection String** (or **Internal** if your app is
   also hosted on Render).

### Whichever provider you choose

Put the connection string in `server/.env`:

```env
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

Then apply the schema once:

```bash
cd server
npx prisma generate
npx prisma migrate deploy
```

### Verify Database Connection

```bash
# From project root, go to server
cd server

# Start server
npm start
```

Expected output:

```
Postgres connected
job_sources seeded (manual/linkedin/indeed/gmail/extension)
Server Running on 5000
```

---

## Environment Setup

### Create `.env` File

Inside the `server` directory, create a `.env` file:

```bash
cd server
cp .env.example .env
```

### Configure Environment Variables

Edit `server/.env` with proper values:

```env
# ===== DATABASE (required) =====
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

# ===== SERVER (required) =====
PORT=5000
JWT_SECRET=your_super_secret_key_min_32_characters_long_here_12345
CLIENT_URL=http://localhost:5173

# ===== REDIS (optional, but required to run `npm run worker`) =====
REDIS_URL=

# ===== GMAIL INTEGRATION (optional — leave blank to disable) =====
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

# ===== PLAYWRIGHT APPLY ENGINE (optional) =====
PLAYWRIGHT_PROFILE_DIR=./playwright-profile
PLAYWRIGHT_HEADLESS=true

# ===== FORGOT-PASSWORD EMAILS (optional) =====
RESEND_API_KEY=
RESEND_FROM_EMAIL=

# ===== LINKEDIN/INDEED PARTNER APIS (optional, provider-specific) =====
# Setting these only flips the adapters' "configured" flag — no official
# LinkedIn Talent Solutions or Indeed partner API call is implemented
# behind them yet, so setting these alone does not make search work.
LINKEDIN_TALENT_API_TOKEN=
INDEED_PARTNER_FEED_URL=
```

Remotive (the working Job Discovery provider) needs **no environment
variable at all** — it's a public API with no auth requirement.

### Variable Definitions

| Variable                                                            | Required?             | Purpose                                                                   |
| --------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`                                                       | Required               | Hosted Postgres connection URL (used via Prisma) — used by everything, auth included |
| `PORT`                                                                | Required               | Server port                                                                |
| `JWT_SECRET`                                                          | Required               | Token secret (min 32 chars)                                               |
| `CLIENT_URL`                                                          | Required               | Frontend URL(s) for CORS, comma-separated                                 |
| `REDIS_URL`                                                           | Optional (required for `npm run worker`) | Queue backend for discovery/matching/apply/analytics; defaults to `redis://127.0.0.1:6379` if unset |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`  | Optional               | Gmail OAuth — see [GMAIL_INTEGRATION.md](GMAIL_INTEGRATION.md)            |
| `PLAYWRIGHT_PROFILE_DIR` / `PLAYWRIGHT_HEADLESS`                     | Optional               | Apply-engine browser session config                                       |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL`                                | Optional               | Forgot-password emails; skipped (logged, not sent) if unset               |
| `SERVER_URL` / `EXTENSION_REDIRECT_URL`                              | Optional               | Gmail OAuth redirect handling for the browser extension flow              |
| `LINKEDIN_TALENT_API_TOKEN` / `INDEED_PARTNER_FEED_URL`               | Optional, provider-specific | Only flips an availability flag — no real API call is implemented behind either yet |

**Security Note**: Never commit `.env` to version control. It's already in `.gitignore`.

---

## Running the Application

### Prerequisites Met?

- [ ] Node.js and npm installed
- [ ] `DATABASE_URL` configured and schema applied (`npx prisma migrate deploy`)
- [ ] `.env` file configured
- [ ] Dependencies installed for both server and client

### Method 1: Running Locally (Development)

**Terminal 1 - Start Backend:**

```bash
cd server
npm start
```

Expected output:

```
Postgres connected
job_sources seeded (manual/linkedin/indeed/gmail/extension)
Server Running on 5000
```

**Terminal 2 - Start Frontend:**

```bash
cd client
npm run dev
```

Expected output:

```
  VITE v6.x.x  ready in XXX ms

  ➜  Local:   http://localhost:5173/
  ➜  press h to show help
```

**Terminal 3 (recommended) - Background Engine Workers:**

```bash
cd server
npm run worker
```

Required if you want Job Discovery, matching, the apply engine, and
analytics rollups running — the core tracker (register, login, add/edit/
delete jobs) works without it. Needs Redis to be reachable.

### Method 2: Production Build

```bash
# Build frontend
cd client
npm run build

# Start server
cd ../server
npm start
```

---

## Verification

### Step 1: Check Server Health

```bash
curl http://localhost:5000
```

Expected: `Backend Running`

### Step 2: Access Frontend

Open browser and visit:

```
http://localhost:5173
```

Expected: Landing/login page loads without errors

### Step 3: Test Authentication

1. Click "Register"
2. Create account with:
   - Name: `Test User`
   - Email: `test@example.com`
   - Password: `Test@1234`
3. Submit

Expected: Account created, then redirected to log in

### Step 4: Login

Use credentials from Step 3.

Expected: Dashboard loads successfully

### Step 5: Test Job Creation

1. Click "Add Job"
2. Fill in form:
   - Company: `Test Corp`
   - Role: `Developer`
   - Status: `Applied`
3. Save

Expected: Job appears in your Applied Jobs list

### Step 6: Test Job Discovery (optional, requires the worker running)

1. Go to `/job-discovery`
2. Search for a role (Remotive is on by default)
3. Poll status until it reaches `succeeded`

Expected: Real Remotive listings appear; LinkedIn/Indeed (if selected) show as "unavailable"

### Verification Checklist

- [ ] Server running on port 5000
- [ ] Frontend running on port 5173
- [ ] Postgres connected (check server startup log)
- [ ] Login page accessible
- [ ] Account registration works
- [ ] Login works
- [ ] Dashboard displays
- [ ] Can add job application
- [ ] No console errors

---

## Troubleshooting

### Problem: "Cannot find module" errors

**Solution:**

```bash
# Delete node_modules and reinstall
rm -r node_modules
npm install

# Clear npm cache
npm cache clean --force
```

### Problem: Postgres Connection Error

**Error:** `Postgres connection error ...` or `ECONNREFUSED`

**Solution:**

- Verify `DATABASE_URL` in `server/.env` is the exact URL your provider gave you
- Make sure `?sslmode=require` is included if your provider needs it (most hosted providers do)
- Confirm the database is active (some free tiers pause after inactivity)
- Run `npx prisma migrate deploy` again to confirm the schema applied cleanly

### Problem: "Table does not exist" / Prisma errors on startup

**Solution:** Run `npx prisma generate && npx prisma migrate deploy` — the
Prisma client or the database schema hasn't been set up yet.

### Problem: Port Already in Use

**Error:** `Error: listen EADDRINUSE: address already in use :::5000`

**Solution:**

```bash
# Windows - Find and kill process
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# Mac/Linux - Find and kill process
lsof -i :5000
kill -9 <PID>

# Or change PORT in .env
PORT=5001
```

### Problem: CORS Errors

**Error:** `Access to XMLHttpRequest blocked by CORS policy`

**Solution:**
Verify `.env` has correct URLs:

```env
CLIENT_URL=http://localhost:5173
```

Restart server after changing.

### Problem: Environment Variables Not Loading

**Error:** `process.env.X is undefined`

**Solution:**

1. Make sure `.env` file exists inside `server/`
2. Restart server after creating/modifying `.env`
3. Check file is named exactly `.env` (not `.env.example`)

### Problem: npm install Takes Too Long

**Solution:**

```bash
# Clear cache
npm cache clean --force

# Try with legacy peer deps
npm install --legacy-peer-deps

# Use npm ci instead
npm ci
```

### Problem: React/Vite Not Starting

**Error:** `TypeError: Cannot read properties of undefined`

**Solution:**

```bash
cd client
npm install
npm run dev
```

### Problem: Login Not Working

**Causes & Solutions:**

1. Check `JWT_SECRET` in `.env` is set
2. Confirm `npx prisma migrate deploy` ran successfully (the `users` table must exist)
3. Check browser console for errors
4. Restart both servers

### Problem: Job Discovery runs stay "queued"

**Solution:** The worker process (`npm run worker`) isn't running, or can't
reach Redis (`REDIS_URL`). Start it in a third terminal.

### Getting Help

1. **Check Console Errors**
   - Browser: F12 → Console
   - Server: Terminal where `npm start` runs

2. **Verify All Services**
   - Postgres: reachable via `DATABASE_URL`
   - Server: Terminal shows "Server Running on 5000" and "Postgres connected"
   - Frontend: Terminal shows "Local: http://localhost:5173"

3. **Check Ports**
   - Server: http://localhost:5000
   - Client: http://localhost:5173

---

## Next Steps

1. ✅ Installation complete
2. 📖 Read [GETTING_STARTED.md](GETTING_STARTED.md)
3. 📚 Review [API_ENDPOINTS.md](API_ENDPOINTS.md)
4. 💻 Explore the codebase
5. 🚀 Deploy to production (see [DEPLOYMENT.md](DEPLOYMENT.md))

---

## Quick Reference Commands

```bash
# Install all dependencies
npm install

# Set up / re-apply the Prisma schema
npx prisma generate
npx prisma migrate deploy

# Start development server
npm start

# Start background engine workers
npm run worker

# Build for production
npm run build

# Stop server
Ctrl + C

# Update npm
npm install -g npm@latest

# Check for security vulnerabilities
npm audit

# Fix vulnerabilities
npm audit fix
```

---

**Last Updated**: August 25, 2026
