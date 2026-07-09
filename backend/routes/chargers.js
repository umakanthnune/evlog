const express = require("express");
const db = require("../db");
const router = express.Router();

/** GET /api/chargers?q=search — directory with aggregated stats, sorted by rating */
router.get("/chargers", async (req, res) => {
  const q = (req.query.q || "").trim();
  const { rows } = await db.query(
    `SELECT c.*,
            COUNT(s.id) AS review_count,
            COALESCE(AVG(s.rating), 0) AS avg_rating,
            COALESCE(AVG(s.wait_min), 0) AS avg_wait
     FROM chargers c
     LEFT JOIN trip_stops s ON s.charger_id = c.id
     WHERE ($1 = '' OR c.name ILIKE '%' || $1 || '%' OR c.network ILIKE '%' || $1 || '%')
     GROUP BY c.id
     ORDER BY avg_rating DESC, review_count DESC`,
    [q]
  );
  res.json(rows);
});

/** POST /api/chargers — manually add a charger (for route planning ahead of a visit) */
router.post("/chargers", async (req, res) => {
  const { name, network } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });

  const existing = await db.query(`SELECT * FROM chargers WHERE name_lower = lower($1)`, [name.trim()]);
  if (existing.rows[0]) return res.status(200).json(existing.rows[0]);

  const { rows } = await db.query(
    `INSERT INTO chargers (name, network) VALUES ($1,$2) RETURNING *`,
    [name.trim(), (network || "").trim() || null]
  );
  res.status(201).json(rows[0]);
});

/** GET /api/chargers/:id — detail + every driver's stop-review across all trips */
router.get("/chargers/:id", async (req, res) => {
  const chargerResult = await db.query(`SELECT * FROM chargers WHERE id = $1`, [req.params.id]);
  const charger = chargerResult.rows[0];
  if (!charger) return res.status(404).json({ error: "Charger not found" });

  const statsResult = await db.query(
    `SELECT COUNT(*) AS review_count,
            COALESCE(AVG(rating), 0) AS avg_rating,
            COALESCE(AVG(wait_min), 0) AS avg_wait,
            COUNT(DISTINCT trip_title) AS traveler_count
     FROM trip_stops WHERE charger_id = $1`,
    [charger.id]
  );
  const reviewsResult = await db.query(
    `SELECT trip_title, rating, wait_min, notes, kwh, rate_per_kwh, cost, created_at
     FROM trip_stops WHERE charger_id = $1 ORDER BY created_at DESC`,
    [charger.id]
  );

  res.json({ ...charger, stats: statsResult.rows[0], reviews: reviewsResult.rows });
});

module.exports = router;
