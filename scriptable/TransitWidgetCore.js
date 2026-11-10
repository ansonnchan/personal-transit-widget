/**
 * Pure data helpers shared by Scriptable and the Node test suite.
 * This file deliberately has no Scriptable-specific globals.
 */

class ProtobufReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.position = 0;
  }

  get done() {
    return this.position >= this.bytes.length;
  }

  readVarint() {
    let result = 0;
    let multiplier = 1;

    for (let index = 0; index < 10; index += 1) {
      if (this.done) throw new Error("Unexpected end of protobuf varint");
      const byte = this.bytes[this.position++];
      result += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) return result;
      multiplier *= 128;
    }

    throw new Error("Invalid protobuf varint");
  }

  readBytes() {
    const length = this.readVarint();
    const end = this.position + length;
    if (end > this.bytes.length) throw new Error("Invalid protobuf length");
    const value = this.bytes.slice(this.position, end);
    this.position = end;
    return value;
  }

  readString() {
    return decodeUtf8(this.readBytes());
  }

  skip(wireType) {
    if (wireType === 0) {
      this.readVarint();
      return;
    }
    if (wireType === 1) {
      this.position += 8;
      return;
    }
    if (wireType === 2) {
      const length = this.readVarint();
      this.position += length;
      return;
    }
    if (wireType === 5) {
      this.position += 4;
      return;
    }
    throw new Error(`Unsupported protobuf wire type: ${wireType}`);
  }
}

function decodeUtf8(bytes) {
  let output = "";

  for (let index = 0; index < bytes.length; index += 1) {
    const first = bytes[index];
    let codePoint;

    if (first < 0x80) {
      codePoint = first;
    } else if ((first & 0xe0) === 0xc0) {
      const second = bytes[++index];
      codePoint = ((first & 0x1f) << 6) | (second & 0x3f);
    } else if ((first & 0xf0) === 0xe0) {
      const second = bytes[++index];
      const third = bytes[++index];
      codePoint = ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f);
    } else {
      const second = bytes[++index];
      const third = bytes[++index];
      const fourth = bytes[++index];
      codePoint =
        ((first & 0x07) << 18) |
        ((second & 0x3f) << 12) |
        ((third & 0x3f) << 6) |
        (fourth & 0x3f);
    }

    if (codePoint <= 0xffff) {
      output += String.fromCharCode(codePoint);
    } else {
      codePoint -= 0x10000;
      output += String.fromCharCode(0xd800 + (codePoint >> 10));
      output += String.fromCharCode(0xdc00 + (codePoint & 0x3ff));
    }
  }

  return output;
}

function visitFields(bytes, visitor) {
  const reader = new ProtobufReader(bytes);
  while (!reader.done) {
    const tag = reader.readVarint();
    visitor(tag >>> 3, tag & 7, reader);
  }
}

function parseFeedHeader(bytes) {
  const header = { timestamp: null };
  visitFields(bytes, (field, wire, reader) => {
    if (field === 3 && wire === 0) header.timestamp = reader.readVarint();
    else reader.skip(wire);
  });
  return header;
}

function parseTripDescriptor(bytes) {
  const trip = {
    tripId: "",
    routeId: "",
    directionId: null,
    scheduleRelationship: 0,
  };

  visitFields(bytes, (field, wire, reader) => {
    if (field === 1 && wire === 2) trip.tripId = reader.readString();
    else if (field === 4 && wire === 0) trip.scheduleRelationship = reader.readVarint();
    else if (field === 5 && wire === 2) trip.routeId = reader.readString();
    else if (field === 6 && wire === 0) trip.directionId = reader.readVarint();
    else reader.skip(wire);
  });

  return trip;
}

function parseStopTimeEvent(bytes) {
  const event = { time: null, hasDelay: false };
  visitFields(bytes, (field, wire, reader) => {
    if (field === 1 && wire === 0) {
      event.hasDelay = true;
      reader.readVarint();
    } else if (field === 2 && wire === 0) {
      event.time = reader.readVarint();
    } else {
      reader.skip(wire);
    }
  });
  return event;
}

function parseStopTimeUpdate(bytes) {
  const update = {
    stopId: "",
    arrival: null,
    departure: null,
    scheduleRelationship: 0,
  };

  visitFields(bytes, (field, wire, reader) => {
    if (field === 2 && wire === 2) update.arrival = parseStopTimeEvent(reader.readBytes());
    else if (field === 3 && wire === 2) update.departure = parseStopTimeEvent(reader.readBytes());
    else if (field === 4 && wire === 2) update.stopId = reader.readString();
    else if (field === 5 && wire === 0) update.scheduleRelationship = reader.readVarint();
    else reader.skip(wire);
  });

  return update;
}

function parseTripUpdate(bytes) {
  const update = { trip: null, stops: [], timestamp: null };

  visitFields(bytes, (field, wire, reader) => {
    if (field === 1 && wire === 2) update.trip = parseTripDescriptor(reader.readBytes());
    else if (field === 2 && wire === 2) update.stops.push(parseStopTimeUpdate(reader.readBytes()));
    else if (field === 4 && wire === 0) update.timestamp = reader.readVarint();
    else reader.skip(wire);
  });

  return update;
}

function parseFeedEntity(bytes) {
  const entity = { deleted: false, tripUpdate: null };
  visitFields(bytes, (field, wire, reader) => {
    if (field === 2 && wire === 0) entity.deleted = Boolean(reader.readVarint());
    else if (field === 3 && wire === 2) entity.tripUpdate = parseTripUpdate(reader.readBytes());
    else reader.skip(wire);
  });
  return entity;
}

function decodeGtfsRealtime(bytes) {
  const feed = { timestamp: null, tripUpdates: [] };

  visitFields(bytes, (field, wire, reader) => {
    if (field === 1 && wire === 2) {
      feed.timestamp = parseFeedHeader(reader.readBytes()).timestamp;
    } else if (field === 2 && wire === 2) {
      const entity = parseFeedEntity(reader.readBytes());
      if (!entity.deleted && entity.tripUpdate && entity.tripUpdate.trip) {
        feed.tripUpdates.push(entity.tripUpdate);
      }
    } else {
      reader.skip(wire);
    }
  });

  return feed;
}

function findDepartures(feed, options) {
  const routeIds = {};
  for (const routeId of options.routeIds) routeIds[String(routeId)] = true;
  const stopId = String(options.stopId);
  const directionId = options.directionId;
  const destinationQuery = String(options.headsignContains || "").trim().toLowerCase();
  const headsignByTrip = options.headsignByTrip || {};
  const now = options.nowSeconds || Math.floor(Date.now() / 1000);
  const departures = [];
  const seen = {};

  for (const update of feed.tripUpdates) {
    const trip = update.trip;
    if (!routeIds[String(trip.routeId)]) continue;
    if (trip.scheduleRelationship === 3 || trip.scheduleRelationship === 7) continue;
    if (directionId !== null && directionId !== undefined && trip.directionId !== directionId) continue;
    if (destinationQuery) {
      const headsign = String(headsignByTrip[trip.tripId] || "").toLowerCase();
      if (!headsign.includes(destinationQuery)) continue;
    }

    for (const stop of update.stops) {
      if (String(stop.stopId) !== stopId || stop.scheduleRelationship === 1) continue;
      const event = stop.departure || stop.arrival;
      if (!event || !event.time || event.time < now - 60) continue;
      const key = `${trip.tripId}:${event.time}`;
      if (seen[key]) continue;
      seen[key] = true;
      departures.push({
        time: event.time,
        tripId: trip.tripId,
        routeId: trip.routeId,
        hasDelay: event.hasDelay,
        kind: "realtime",
      });
    }
  }

  departures.sort((left, right) => left.time - right.time);
  return departures;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function isServiceActive(serviceId, date, calendars, exceptions) {
  const key = dateKey(date);
  const exception = exceptions[serviceId] && exceptions[serviceId][key];
  if (exception === 1) return true;
  if (exception === 2) return false;

  const calendar = calendars[serviceId];
  if (!calendar || key < calendar[7] || key > calendar[8]) return false;
  const weekdayIndex = (date.getDay() + 6) % 7;
  return Boolean(calendar[weekdayIndex]);
}

function findScheduledDepartures(scheduleEntries, transitData, options) {
  if (!scheduleEntries || !scheduleEntries.length) return [];
  const nowDate = options.nowDate || new Date();
  const nowSeconds = Math.floor(nowDate.getTime() / 1000);
  const horizonSeconds = (options.horizonMinutes || 240) * 60;
  const directionId = options.directionId;
  const destinationQuery = String(options.headsignContains || "").trim().toLowerCase();
  const departures = [];

  for (const dayOffset of [-1, 0, 1]) {
    const serviceDate = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate() + dayOffset,
      0,
      0,
      0,
      0
    );

    for (const entry of scheduleEntries) {
      const [tripId, serviceId, departureSeconds, entryDirectionId, headsignIndex] = entry;
      if (!isServiceActive(serviceId, serviceDate, transitData.CALENDARS, transitData.EXCEPTIONS)) continue;
      if (directionId !== null && directionId !== undefined && entryDirectionId !== directionId) continue;
      const headsign = transitData.HEADSIGNS[headsignIndex] || "";
      if (destinationQuery && !headsign.toLowerCase().includes(destinationQuery)) continue;

      const departureDate = new Date(serviceDate.getTime());
      departureDate.setSeconds(departureSeconds);
      const departureEpoch = Math.floor(departureDate.getTime() / 1000);
      if (departureEpoch < nowSeconds - 60 || departureEpoch > nowSeconds + horizonSeconds) continue;

      departures.push({
        time: departureEpoch,
        tripId,
        routeId: options.routeId || "",
        hasDelay: false,
        kind: "scheduled",
        headsign,
      });
    }
  }

  departures.sort((left, right) => left.time - right.time);
  return departures;
}

function mergeDepartures(realtime, scheduled) {
  const byTrip = {};
  for (const departure of scheduled) byTrip[departure.tripId] = departure;
  for (const departure of realtime) byTrip[departure.tripId] = departure;
  return Object.values(byTrip).sort((left, right) => left.time - right.time);
}

function calculateCatchable(departures, options) {
  const now = options.nowSeconds || Math.floor(Date.now() / 1000);
  const leadSeconds = (options.walkingMinutes + options.bufferMinutes) * 60;
  const limit = options.limit || 3;

  return departures
    .map((departure) => {
      const leaveAt = departure.time - leadSeconds;
      return {
        ...departure,
        leaveAt,
        arrivalMinutes: Math.max(0, Math.ceil((departure.time - now) / 60)),
        leaveMinutes: Math.max(0, Math.floor((leaveAt - now) / 60)),
        catchable: leaveAt >= now,
      };
    })
    .filter((departure) => departure.catchable)
    .slice(0, limit);
}

function normalizeRoute(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (/^\d+$/.test(normalized)) return String(Number(normalized));
  return normalized;
}

function parseWidgetParameter(value) {
  if (!value || !String(value).trim()) return null;
  const text = String(value).trim();
  let raw;

  if (text[0] === "{") {
    raw = JSON.parse(text);
  } else {
    const parts = text.split("|").map((part) => part.trim());
    raw = {
      name: parts[0],
      route: parts[1],
      stopCode: parts[2],
      direction: parts[3],
      walkingMinutes: parts[4],
      bufferMinutes: parts[5],
      directionId: parts[6],
      headsignContains: parts[7],
    };
  }

  const directionValue = raw.directionId;
  const result = {
    name: String(raw.name || "My bus").trim(),
    route: normalizeRoute(raw.route),
    stopCode: String(raw.stopCode || raw.stop || "").trim(),
    direction: String(raw.direction || "").trim(),
    walkingMinutes: Number(raw.walkingMinutes ?? raw.walk ?? 0),
    bufferMinutes: Number(raw.bufferMinutes ?? raw.buffer ?? 0),
    directionId:
      directionValue === "" || directionValue === null || directionValue === undefined
        ? null
        : Number(directionValue),
    headsignContains: String(raw.headsignContains || raw.destination || "").trim(),
  };

  if (!result.route) throw new Error("A route number is required");
  if (!result.stopCode) throw new Error("A five-digit stop number is required");
  if (!Number.isFinite(result.walkingMinutes) || result.walkingMinutes < 0) {
    throw new Error("Walking time must be zero or more");
  }
  if (!Number.isFinite(result.bufferMinutes) || result.bufferMinutes < 0) {
    throw new Error("Safety buffer must be zero or more");
  }
  if (result.directionId !== null && result.directionId !== 0 && result.directionId !== 1) {
    throw new Error("Direction ID must be 0, 1, or blank");
  }

  return result;
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

module.exports = {
  calculateCatchable,
  decodeGtfsRealtime,
  findScheduledDepartures,
  findDepartures,
  mergeDepartures,
  normalizeRoute,
  parseWidgetParameter,
  stableHash,
};
