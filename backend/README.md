# UKLabs EV Trip Log — API

Express + Postgres backend. Trips are scoped to an anonymous device id (no login
needed for v1); chargers and reviews are shared globally across all users.

## Local setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL
npm run migrate        # creates tables from schema.sql
npm start               # runs on :3000
```

## Deploying (Render — free tier works for this)

1. Push this `backend/` folder to a GitHub repo.
2. On Render: **New → PostgreSQL** — create a free Postgres instance, copy its
   "Internal Database URL".
3. On Render: **New → Web Service** — point at your repo, root directory
   `backend/`, build command `npm install`, start command `npm start`.
4. Add environment variable `DATABASE_URL` = the internal URL from step 2.
5. Once deployed, run the migration once from Render's shell tab:
   `npm run migrate`
6. Your API is live at `https://your-service.onrender.com`.

Railway and Fly.io work the same way — provision Postgres, set `DATABASE_URL`,
deploy this folder, run the migration once.

## Wiring the frontend

In `uklabs-ev-trip-log.html`, set:

```js
const API_BASE = "https://your-service.onrender.com";
```

That's the only change needed to point the existing single-file app at your
live API instead of localStorage.

## Known limitations (v1, by design — see notes below on upgrading)

- **Photos are stored as base64 inside Postgres** (`photos` JSONB columns).
  This is the fastest path to ship and fine at hobby scale, but every photo
  bloats your DB and slows queries as the app grows. When that starts to
  hurt: swap to uploading photos to S3/Cloudflare R2 first, store just the
  URL in these columns, and change the collage route to fetch photo bytes
  from those URLs instead of decoding base64.
- **No authentication.** Anyone with a device id UUID can read/write that
  device's trips (the UUID isn't guessable, but it isn't a security boundary
  either). Add real auth before this handles anything sensitive.
- **CORS is wide open** (`app.use(cors())`). Restrict to your deployed
  frontend's origin before sharing the URL publicly.
