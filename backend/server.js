require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const db = require("./db");

const app = express();

app.use(cors()); // tighten to your deployed frontend origin before going live
app.use(express.json({ limit: "15mb" })); // photos arrive as base64 — bump the default 100kb limit

app.use("/api", require("./routes/trips"));
app.use("/api", require("./routes/chargers"));

app.get("/", (req, res) => {
  res.json({
    service: "UKLabs EV Trip Log API",
    status: "running",
    try: ["/api/health", "/api/chargers"],
  });
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;

// Auto-migrate on boot. schema.sql uses CREATE TABLE IF NOT EXISTS, so this
// is safe to run on every deploy/restart — it only creates what's missing.
// This matters specifically because Render's free tier has no Shell tab to
// run `npm run migrate` manually.
async function start() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await db.query(schema);
    console.log("✓ Schema is up to date");
  } catch (err) {
    console.error("✗ Migration failed on boot:", err.message);
    // Don't crash the server over this — health checks and logs still work,
    // and you can see the real error in the logs to fix DATABASE_URL etc.
  }
  app.listen(PORT, () => console.log(`UKLabs EV Trip Log API running on :${PORT}`));
}

start();
