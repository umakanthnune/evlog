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

/** POST /api/chargers — manually add a charger (for route planning ahead of a visit,
 *  or for maintaining the Stations directory with infra specs) */
router.post("/chargers", async (req, res) => {
  const { name, network, chargerType, numChargers, capacityKw, chargePoints } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });

  const existing = await db.query(`SELECT * FROM chargers WHERE name_lower = lower($1)`, [name.trim()]);
  if (existing.rows[0]) return res.status(200).json(existing.rows[0]);

  const derived = chargePoints !== undefined
    ? derivePointStats(chargePoints)
    : { chargePoints: [], chargerType: normalizeChargerType(chargerType), numChargers: numChargers || null, capacityKw: capacityKw || null };

  const { rows } = await db.query(
    `INSERT INTO chargers (name, network, charger_type, num_chargers, capacity_kw, charge_points)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      name.trim(), (network || "").trim() || null,
      derived.chargerType, derived.numChargers, derived.capacityKw,
      JSON.stringify(derived.chargePoints),
    ]
  );
  res.status(201).json(rows[0]);
});

/** PATCH /api/chargers/:id — edit station specs (charging points, each with its own type + capacity) */
router.patch("/chargers/:id", async (req, res) => {
  const { name, network, chargerType, numChargers, capacityKw, chargePoints } = req.body;
  const existing = await db.query(`SELECT * FROM chargers WHERE id = $1`, [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: "Charger not found" });
  const c = existing.rows[0];

  const derived = chargePoints !== undefined
    ? derivePointStats(chargePoints)
    : {
        chargePoints: c.charge_points || [],
        chargerType: chargerType !== undefined ? normalizeChargerType(chargerType) : c.charger_type,
        numChargers: numChargers !== undefined ? (numChargers || null) : c.num_chargers,
        capacityKw: capacityKw !== undefined ? (capacityKw || null) : c.capacity_kw,
      };

  const { rows } = await db.query(
    `UPDATE chargers SET name = $1, network = $2, charger_type = $3, num_chargers = $4, capacity_kw = $5, charge_points = $6
     WHERE id = $7 RETURNING *`,
    [
      (name || c.name).trim(),
      network !== undefined ? (network || "").trim() || null : c.network,
      derived.chargerType, derived.numChargers, derived.capacityKw,
      JSON.stringify(derived.chargePoints),
      req.params.id,
    ]
  );
  res.json(rows[0]);
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
    `SELECT trip_title, rating, wait_min, notes, kwh, rate_per_kwh, cost, charge_type, created_at
     FROM trip_stops WHERE charger_id = $1 ORDER BY created_at DESC`,
    [charger.id]
  );

  res.json({ ...charger, stats: statsResult.rows[0], reviews: reviewsResult.rows });
});

function normalizeChargerType(t) {
  if (t === "AC" || t === "DC" || t === "Both") return t;
  return null;
}

/**
 * Given an array of individual charging points like [{type:'DC', capacityKw:60}, ...],
 * derive the summary fields the rest of the app displays:
 * - chargerType: 'AC' if all points are AC, 'DC' if all DC, 'Both' if mixed
 * - numChargers: how many valid points
 * - capacityKw: the highest single point's capacity (useful for "up to X kW" sorting/display)
 * Invalid/empty rows (no type and no capacity) are dropped.
 */
function derivePointStats(points) {
  const clean = (Array.isArray(points) ? points : [])
    .map((p) => ({
      type: p.type === "AC" || p.type === "DC" ? p.type : null,
      capacityKw: Number(p.capacityKw ?? p.capacity_kw ?? 0) || null,
    }))
    .filter((p) => p.type || p.capacityKw);

  if (clean.length === 0) {
    return { chargePoints: [], chargerType: null, numChargers: null, capacityKw: null };
  }

  const types = new Set(clean.map((p) => p.type).filter(Boolean));
  let chargerType = null;
  if (types.size === 1) chargerType = [...types][0];
  else if (types.size > 1) chargerType = "Both";

  const capacities = clean.map((p) => p.capacityKw).filter(Boolean);
  const capacityKw = capacities.length ? Math.max(...capacities) : null;

  return { chargePoints: clean, chargerType, numChargers: clean.length, capacityKw };
}

module.exports = router;
