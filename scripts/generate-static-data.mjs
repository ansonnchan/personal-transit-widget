import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const zipPath = process.argv[2];
if (!zipPath) {
  console.error("Usage: npm run update-data -- /path/to/google_transit.zip");
  process.exit(1);
}

function readZipEntry(name) {
  return execFileSync("unzip", ["-p", resolve(zipPath), name], {
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift();
  return rows.filter((values) => values.length > 1).map((values) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] || "";
    });
    return record;
  });
}

function normalizeRoute(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^\d+$/.test(normalized) ? String(Number(normalized)) : normalized;
}

const routes = {};
for (const route of parseCsv(readZipEntry("routes.txt"))) {
  const key = normalizeRoute(route.route_short_name);
  if (!key) continue;
  if (!routes[key]) routes[key] = [];
  if (!routes[key].includes(route.route_id)) routes[key].push(route.route_id);
}

const stops = {};
for (const stop of parseCsv(readZipEntry("stops.txt"))) {
  if (!stop.stop_code || !stop.stop_id) continue;
  stops[stop.stop_code] = [stop.stop_id, stop.stop_name];
}

const output = [
  "// Generated from TransLink's current GTFS static feed. Do not edit by hand.",
  `const ROUTES = ${JSON.stringify(routes)};`,
  `const STOPS = ${JSON.stringify(stops)};`,
  "module.exports = { ROUTES, STOPS };",
  "",
].join("\n");

const outputPath = resolve("scriptable/TransitWidgetData.js");
writeFileSync(outputPath, output);
console.log(`Wrote ${Object.keys(routes).length} routes and ${Object.keys(stops).length} stops to ${outputPath}`);
