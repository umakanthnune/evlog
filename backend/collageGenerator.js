const sharp = require("sharp");

/**
 * Generates a shareable trip summary collage (1080x1350, portrait — fits IG feed/story).
 *
 * @param {Object} trip
 * @param {string} trip.title            e.g. "Hyderabad → Kurnool"
 * @param {string} trip.dateRange        e.g. "18 Jun – 19 Jun"
 * @param {string} trip.distanceKm       e.g. "214"
 * @param {string} trip.energyKwh        e.g. "55.5"
 * @param {string} trip.cost             e.g. "1,030"
 * @param {Buffer[]} photoBuffers        raw image buffers, already selected/ordered by caller
 *                                       (cap at 6 — pick top-rated/cover photos before calling)
 * @returns {Promise<Buffer>} PNG buffer of the finished collage
 */
async function generateTripCollage(trip, photoBuffers) {
  const W = 1080;
  const H = 1350;
  const HEADER_H = 190;
  const FOOTER_H = 190;
  const GRID_Y = HEADER_H;
  const GRID_H = H - HEADER_H - FOOTER_H;
  const GUTTER = 8;

  const photos = photoBuffers.slice(0, 6);
  const layout = gridLayout(photos.length, W, GRID_H, GUTTER);

  // 1. Base canvas — PCB board color
  const base = sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: { r: 10, g: 15, b: 12, alpha: 1 },
    },
  });

  // 2. Header + footer + divider chrome, drawn as one SVG overlay
  const chromeSvg = buildChromeSvg({ W, H, HEADER_H, FOOTER_H, trip });

  // 3. Prep each photo tile: cover-crop to its cell size + rounded-corner mask
  const photoComposites = await Promise.all(
    photos.map(async (buf, i) => {
      const cell = layout[i];
      const tile = await roundedTile(buf, cell.w, cell.h, 14);
      return {
        input: tile,
        left: Math.round(cell.x),
        top: Math.round(GRID_Y + cell.y),
      };
    })
  );

  const finalBuffer = await base
    .composite([
      { input: Buffer.from(chromeSvg), left: 0, top: 0 },
      ...photoComposites,
    ])
    .png()
    .toBuffer();

  return finalBuffer;
}

// ---- helpers ----

/** Crop a photo to cover (w,h) and apply rounded-corner alpha mask. */
async function roundedTile(inputBuffer, w, h, radius) {
  w = Math.round(w);
  h = Math.round(h);
  const resized = await sharp(inputBuffer)
    .resize(w, h, { fit: "cover" })
    .toBuffer();

  const mask = Buffer.from(
    `<svg width="${w}" height="${h}">
       <rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="#fff"/>
     </svg>`
  );

  return sharp(resized)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

/** Returns [{x,y,w,h}] cell rects for N photos within (W x H), gutter between cells. */
function gridLayout(n, W, H, gutter) {
  const full = (cols, rows, spans = {}) => {
    const cellW = (W - gutter * (cols - 1)) / cols;
    const cellH = (H - gutter * (rows - 1)) / rows;
    const cells = [];
    for (let i = 0; i < n; i++) {
      const span = spans[i] || { cw: 1, ch: 1 };
      const col = i % cols;
      const row = Math.floor(i / cols);
      cells.push({
        x: col * (cellW + gutter),
        y: row * (cellH + gutter),
        w: cellW * span.cw + gutter * (span.cw - 1),
        h: cellH * span.ch + gutter * (span.ch - 1),
      });
    }
    return cells;
  };

  switch (n) {
    case 1:
      return [{ x: 0, y: 0, w: W, h: H }];
    case 2:
      return full(1, 2);
    case 3:
      // one big left, two stacked right
      return [
        { x: 0, y: 0, w: W * 0.62 - gutter / 2, h: H },
        { x: W * 0.62 + gutter / 2, y: 0, w: W * 0.38 - gutter / 2, h: H / 2 - gutter / 2 },
        { x: W * 0.62 + gutter / 2, y: H / 2 + gutter / 2, w: W * 0.38 - gutter / 2, h: H / 2 - gutter / 2 },
      ];
    case 4:
      return full(2, 2);
    case 5:
      // top row 2 wide, bottom row 3
      return [...full(2, 2, {}).slice(0, 2).map((c) => ({ ...c, h: H * 0.48 })),
        ...topOffset(full(3, 1), H * 0.48 + gutter, W, gutter)];
    default:
      return full(3, 2);
  }
}

function topOffset(cells, offsetY) {
  return cells.map((c) => ({ ...c, y: offsetY }));
}

function buildChromeSvg({ W, H, HEADER_H, FOOTER_H, trip }) {
  const footerY = H - FOOTER_H;
  return `
  <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse">
        <circle cx="1.5" cy="1.5" r="1.4" fill="#6fcf97" opacity="0.18"/>
      </pattern>
    </defs>

    <!-- header -->
    <rect x="0" y="0" width="${W}" height="${HEADER_H}" fill="#0c1712"/>
    <rect x="0" y="0" width="${W}" height="${HEADER_H}" fill="url(#dots)"/>
    <text x="56" y="70" font-family="monospace" font-size="22" letter-spacing="4"
          fill="#6fcf97">TRIP TRACE · UKLABS</text>
    <text x="56" y="128" font-family="'Space Grotesk', Arial, sans-serif" font-size="52"
          font-weight="700" fill="#eef2ee">${escapeXml(trip.title)}</text>
    <text x="56" y="164" font-family="monospace" font-size="22" fill="#7d9285">
      ${escapeXml(trip.dateRange)} · ${escapeXml(trip.distanceKm)} km
    </text>
    <line x1="0" y1="${HEADER_H}" x2="${W}" y2="${HEADER_H}" stroke="#c98a4b"
          stroke-width="2" stroke-dasharray="6 6"/>

    <!-- footer -->
    <rect x="0" y="${footerY}" width="${W}" height="${FOOTER_H}" fill="#0e1a14"/>
    <line x1="0" y1="${footerY}" x2="${W}" y2="${footerY}" stroke="#2a3a30" stroke-width="2"/>

    ${statBlock(W * (1 / 6), footerY + 95, trip.distanceKm, "KM", "#f2a65a")}
    ${statBlock(W * (3 / 6), footerY + 95, trip.energyKwh, "KWH", "#f2a65a")}
    ${statBlock(W * (5 / 6), footerY + 95, "₹" + trip.cost, "SPENT", "#f2a65a")}

    <line x1="${W / 3}" y1="${footerY + 40}" x2="${W / 3}" y2="${footerY + 150}" stroke="#2a3a30" stroke-width="2"/>
    <line x1="${(W * 2) / 3}" y1="${footerY + 40}" x2="${(W * 2) / 3}" y2="${footerY + 150}" stroke="#2a3a30" stroke-width="2"/>
  </svg>`;
}

function statBlock(cx, cy, value, label, color) {
  return `
    <text x="${cx}" y="${cy}" font-family="monospace" font-size="46" font-weight="700"
          fill="${color}" text-anchor="middle">${escapeXml(String(value))}</text>
    <text x="${cx}" y="${cy + 34}" font-family="monospace" font-size="16" letter-spacing="3"
          fill="#6b8074" text-anchor="middle">${label}</text>
  `;
}

function escapeXml(str) {
  return String(str).replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  }[c]));
}

module.exports = { generateTripCollage };
