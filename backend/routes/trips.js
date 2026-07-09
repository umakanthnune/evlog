const express = require("express");
const db = require("../db");
const { generateTripCollage } = require("../collageGenerator");
const router = express.Router();

// All routes expect a device id, sent as header X-Device-Id.
// This is how trips stay scoped to "your" trips without requiring login.
function requireDevice(req, res, next) {
  const deviceId = req.header("X-Device-Id");
  if (!deviceId) return res.status(400).json({ error: "Missing X-Device-Id header" });
  req.deviceId = deviceId;
  next();
}

/** GET /api/trips — list this device's trips with rollup totals */
router.get("/trips", requireDevice, async (req, res) => {
  const { rows } = await db.query(
    `SELECT t.*,
            COALESCE(SUM(s.cost), 0) + COALESCE((SELECT SUM(amount) FROM trip_expenses WHERE trip_id = t.id), 0) AS total_cost,
            COALESCE(SUM(s.kwh), 0) AS total_kwh,
            COUNT(s.id) AS stop_count
     FROM trips t
     LEFT JOIN trip_stops s ON s.trip_id = t.id
     WHERE t.device_id = $1
     GROUP BY t.id
     ORDER BY t.start_date DESC NULLS LAST, t.created_at DESC`,
    [req.deviceId]
  );
  res.json(rows);
});

/** POST /api/trips — create a trip */
router.post("/trips", requireDevice, async (req, res) => {
  const { title, startDate, endDate, distanceKm } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "Title is required" });
  const { rows } = await db.query(
    `INSERT INTO trips (device_id, title, start_date, end_date, distance_km)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.deviceId, title.trim(), startDate || null, endDate || null, distanceKm || 0]
  );
  res.status(201).json(rows[0]);
});

/** GET /api/trips/:id — full trip detail (stops + expenses) */
router.get("/trips/:id", requireDevice, async (req, res) => {
  const trip = await fetchTripOr404(req, res);
  if (!trip) return;
  const [stops, expenses] = await Promise.all([
    db.query(`SELECT * FROM trip_stops WHERE trip_id = $1 ORDER BY created_at ASC`, [trip.id]),
    db.query(`SELECT * FROM trip_expenses WHERE trip_id = $1 ORDER BY created_at ASC`, [trip.id]),
  ]);
  res.json({ ...trip, stops: stops.rows, expenses: expenses.rows });
});

/** DELETE /api/trips/:id */
router.delete("/trips/:id", requireDevice, async (req, res) => {
  const trip = await fetchTripOr404(req, res);
  if (!trip) return;
  await db.query(`DELETE FROM trips WHERE id = $1`, [trip.id]);
  res.status(204).end();
});

/** POST /api/trips/:id/photos — append trip-level photos (base64 data URLs) */
router.post("/trips/:id/photos", requireDevice, async (req, res) => {
  const trip = await fetchTripOr404(req, res);
  if (!trip) return;
  const { photos } = req.body; // array of data URLs
  const updated = [...(trip.photos || []), ...(photos || [])];
  const { rows } = await db.query(
    `UPDATE trips SET photos = $1 WHERE id = $2 RETURNING *`,
    [JSON.stringify(updated), trip.id]
  );
  res.json(rows[0]);
});

/** POST /api/trips/:id/stops — add a charging stop (also writes the charger review) */
router.post("/trips/:id/stops", requireDevice, async (req, res) => {
  const trip = await fetchTripOr404(req, res);
  if (!trip) return;

  const { chargerName, network, kwh, ratePerKwh, waitMin, rating, notes, photos } = req.body;
  if (!chargerName || !chargerName.trim()) {
    return res.status(400).json({ error: "Charger name is required" });
  }

  const charger = await findOrCreateCharger(chargerName.trim(), network);

  const kwhNum = Number(kwh || 0);
  const rateNum = Number(ratePerKwh || 0);
  const cost = kwhNum * rateNum; // computed here, never trusted directly from the client

  const { rows } = await db.query(
    `INSERT INTO trip_stops
      (trip_id, charger_id, charger_name, kwh, rate_per_kwh, cost, wait_min, rating, notes, photos, trip_title)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      trip.id, charger.id, charger.name,
      kwhNum, rateNum, cost, waitMin || 0, rating || 5,
      (notes || "").trim(), JSON.stringify(photos || []), trip.title,
    ]
  );
  res.status(201).json(rows[0]);
});

/** POST /api/trips/:id/expenses */
router.post("/trips/:id/expenses", requireDevice, async (req, res) => {
  const trip = await fetchTripOr404(req, res);
  if (!trip) return;
  const { category, amount, note } = req.body;
  if (!amount) return res.status(400).json({ error: "Amount is required" });
  const { rows } = await db.query(
    `INSERT INTO trip_expenses (trip_id, category, amount, note) VALUES ($1,$2,$3,$4) RETURNING *`,
    [trip.id, category || "other", amount, (note || "").trim()]
  );
  res.status(201).json(rows[0]);
});

/** GET /api/trips/:id/collage.png — server-rendered collage via sharp */
router.get("/trips/:id/collage.png", requireDevice, async (req, res) => {
  const trip = await fetchTripOr404(req, res);
  if (!trip) return;

  const [stopsResult, expensesResult] = await Promise.all([
    db.query(`SELECT * FROM trip_stops WHERE trip_id = $1 ORDER BY created_at ASC`, [trip.id]),
    db.query(`SELECT * FROM trip_expenses WHERE trip_id = $1`, [trip.id]),
  ]);
  const stops = stopsResult.rows;
  const expenses = expensesResult.rows;

  const allPhotos = [
    ...(trip.photos || []),
    ...stops.flatMap((s) => s.photos || []),
  ].slice(0, 6);

  if (allPhotos.length === 0) {
    return res.status(400).json({ error: "No photos on this trip yet" });
  }

  const photoBuffers = allPhotos.map(dataUrlToBuffer);
  const totalKwh = stops.reduce((s, x) => s + Number(x.kwh || 0), 0);
  const totalCost =
    stops.reduce((s, x) => s + Number(x.cost || 0), 0) +
    expenses.reduce((s, x) => s + Number(x.amount || 0), 0);

  const buffer = await generateTripCollage(
    {
      title: trip.title,
      dateRange: formatRange(trip.start_date, trip.end_date),
      distanceKm: String(trip.distance_km || 0),
      energyKwh: totalKwh.toFixed(1),
      cost: totalCost.toLocaleString("en-IN"),
    },
    photoBuffers
  );

  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "no-store");
  res.send(buffer);
});

// ---- helpers ----

async function fetchTripOr404(req, res) {
  const { rows } = await db.query(`SELECT * FROM trips WHERE id = $1 AND device_id = $2`, [
    req.params.id,
    req.deviceId,
  ]);
  if (!rows[0]) {
    res.status(404).json({ error: "Trip not found" });
    return null;
  }
  return rows[0];
}

async function findOrCreateCharger(name, network) {
  const existing = await db.query(`SELECT * FROM chargers WHERE name_lower = lower($1)`, [name]);
  if (existing.rows[0]) {
    if (network && !existing.rows[0].network) {
      const updated = await db.query(`UPDATE chargers SET network = $1 WHERE id = $2 RETURNING *`, [
        network, existing.rows[0].id,
      ]);
      return updated.rows[0];
    }
    return existing.rows[0];
  }
  const created = await db.query(
    `INSERT INTO chargers (name, network) VALUES ($1,$2) RETURNING *`,
    [name, network || null]
  );
  return created.rows[0];
}

function dataUrlToBuffer(dataUrl) {
  const base64 = dataUrl.split(",")[1] || dataUrl;
  return Buffer.from(base64, "base64");
}

function formatRange(start, end) {
  const opts = { day: "numeric", month: "short" };
  const s = start ? new Date(start).toLocaleDateString("en-GB", opts) : "";
  const e = end ? new Date(end).toLocaleDateString("en-GB", opts) : "";
  return [s, e].filter(Boolean).join(" – ");
}

module.exports = router;
