const { Pool } = require("pg");
require("dotenv").config();

// Render/Railway/Supabase all give you a single DATABASE_URL connection string.
// Most managed Postgres providers require SSL — the rejectUnauthorized:false
// below is the common setting for their self-signed certs.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
