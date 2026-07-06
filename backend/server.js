require("dotenv").config();
const express = require("express");
const cors = require("cors");

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
app.listen(PORT, () => console.log(`UKLabs EV Trip Log API running on :${PORT}`));
