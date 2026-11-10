import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const zipPath = process.argv[2];
if (!zipPath) {
  console.error("Usage: npm run update-data -- /path/to/google_transit.zip");
  process.exit(1);
}

const scheduleStopCodes = new Set(
  JSON.parse(readFileSync(resolve("data/schedule-stops.json"), "utf8"))
);

function readZipEntry(name) {
  return execFileSync("unzip", ["-p", resolve(zipPath), name], {
    encoding: "utf8",
    maxBuffer: 300 * 1024 * 1024,
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

const routeRecords = parseCsv(readZipEntry("routes.txt"));
const routes = {};
const routeById = {};
for (const route of routeRecords) {
  const key = normalizeRoute(route.route_short_name);
  routeById[route.route_id] = { ...route, normalizedName: key };
  if (!key) continue;
  if (!routes[key]) routes[key] = [];
  if (!routes[key].includes(route.route_id)) routes[key].push(route.route_id);
}

const stopRecords = parseCsv(readZipEntry("stops.txt"));
const stops = {};
const stopCodeById = {};
for (const stop of stopRecords) {
  if (!stop.stop_code || !stop.stop_id) continue;
  stops[stop.stop_code] = [stop.stop_id, stop.stop_name];
  stopCodeById[stop.stop_id] = stop.stop_code;
}

const tripById = {};
for (const trip of parseCsv(readZipEntry("trips.txt"))) tripById[trip.trip_id] = trip;

function secondsFromGtfsTime(value) {
  const [hours, minutes, seconds] = value.split(":").map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

const headsigns = [];
const headsignIndex = {};
function indexForHeadsign(value) {
  if (headsignIndex[value] !== undefined) return headsignIndex[value];
  const index = headsigns.length;
  headsigns.push(value);
  headsignIndex[value] = index;
  return index;
}

const schedules = {};
const tripHeadsigns = {};
const usedServiceIds = new Set();
for (const stopTime of parseCsv(readZipEntry("stop_times.txt"))) {
  const stopCode = stopCodeById[stopTime.stop_id];
  if (!scheduleStopCodes.has(stopCode)) continue;
  const trip = tripById[stopTime.trip_id];
  const route = trip && routeById[trip.route_id];
  if (!trip || !route || !route.normalizedName || !stopTime.departure_time) continue;
  const key = `${stopCode}|${route.normalizedName}`;
  if (!schedules[key]) schedules[key] = [];
  const destinationIndex = indexForHeadsign(trip.trip_headsign || "");
  schedules[key].push([
    trip.trip_id,
    trip.service_id,
    secondsFromGtfsTime(stopTime.departure_time),
    Number(trip.direction_id),
    destinationIndex,
  ]);
  tripHeadsigns[trip.trip_id] = trip.trip_headsign || "";
  usedServiceIds.add(trip.service_id);
}

for (const entries of Object.values(schedules)) {
  entries.sort((left, right) => left[2] - right[2]);
}

const calendars = {};
for (const calendar of parseCsv(readZipEntry("calendar.txt"))) {
  if (!usedServiceIds.has(calendar.service_id)) continue;
  calendars[calendar.service_id] = [
    Number(calendar.monday),
    Number(calendar.tuesday),
    Number(calendar.wednesday),
    Number(calendar.thursday),
    Number(calendar.friday),
    Number(calendar.saturday),
    Number(calendar.sunday),
    calendar.start_date,
    calendar.end_date,
  ];
}

const exceptions = {};
for (const exception of parseCsv(readZipEntry("calendar_dates.txt"))) {
  if (!usedServiceIds.has(exception.service_id)) continue;
  if (!exceptions[exception.service_id]) exceptions[exception.service_id] = {};
  exceptions[exception.service_id][exception.date] = Number(exception.exception_type);
}

const output = [
  "// Generated from TransLink's current GTFS static feed. Do not edit by hand.",
  `const ROUTES = ${JSON.stringify(routes)};`,
  `const STOPS = ${JSON.stringify(stops)};`,
  `const HEADSIGNS = ${JSON.stringify(headsigns)};`,
  `const TRIP_HEADSIGNS = ${JSON.stringify(tripHeadsigns)};`,
  `const SCHEDULES = ${JSON.stringify(schedules)};`,
  `const CALENDARS = ${JSON.stringify(calendars)};`,
  `const EXCEPTIONS = ${JSON.stringify(exceptions)};`,
  "module.exports = { ROUTES, STOPS, HEADSIGNS, TRIP_HEADSIGNS, SCHEDULES, CALENDARS, EXCEPTIONS };",
  "",
].join("\n");

const outputPath = resolve("scriptable/TransitWidgetData.js");
writeFileSync(outputPath, output);
console.log(
  `Wrote ${Object.keys(routes).length} routes, ${Object.keys(stops).length} stops, and ` +
    `${Object.keys(schedules).length} personal schedule groups to ${outputPath}`
);
