const assert = require("node:assert/strict");
const Core = require("../scriptable/TransitWidgetCore");

function varint(value) {
  const bytes = [];
  let remaining = value;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining) byte |= 0x80;
    bytes.push(byte);
  } while (remaining);
  return bytes;
}

function field(number, wireType, value) {
  const tag = varint((number << 3) | wireType);
  if (wireType === 0) return [...tag, ...varint(value)];
  return [...tag, ...varint(value.length), ...value];
}

function text(value) {
  return Array.from(Buffer.from(value, "utf8"));
}

function message(fields) {
  return fields.flat();
}

function buildFeed() {
  const event = message([field(1, 0, 60), field(2, 0, 2_000)]);
  const stop = message([field(3, 2, event), field(4, 2, text("123"))]);
  const trip = message([
    field(1, 2, text("trip-1")),
    field(5, 2, text("route-49")),
    field(6, 0, 0),
  ]);
  const tripUpdate = message([field(1, 2, trip), field(2, 2, stop), field(4, 0, 1_900)]);
  const entity = message([field(1, 2, text("entity-1")), field(3, 2, tripUpdate)]);
  const header = message([field(1, 2, text("2.0")), field(3, 0, 1_900)]);
  return message([field(1, 2, header), field(2, 2, entity)]);
}

const pipeConfig = Core.parseWidgetParameter("Campus|049|50001|UBC|7|2|0");
assert.deepEqual(pipeConfig, {
  name: "Campus",
  route: "49",
  stopCode: "50001",
  direction: "UBC",
  walkingMinutes: 7,
  bufferMinutes: 2,
  directionId: 0,
  headsignContains: "",
});

const jsonConfig = Core.parseWidgetParameter(
  JSON.stringify({ name: "Home", route: "R1", stop: 50002, walk: 4, buffer: 1 })
);
assert.equal(jsonConfig.route, "R1");
assert.equal(jsonConfig.stopCode, "50002");

const destinationConfig = Core.parseWidgetParameter("Campus|49|61218|UBC|0|0|1|UBC");
assert.equal(destinationConfig.headsignContains, "UBC");

const feed = Core.decodeGtfsRealtime(buildFeed());
assert.equal(feed.timestamp, 1_900);
assert.equal(feed.tripUpdates.length, 1);
assert.equal(feed.tripUpdates[0].trip.routeId, "route-49");
assert.equal(feed.tripUpdates[0].stops[0].departure.time, 2_000);

const departures = Core.findDepartures(feed, {
  routeIds: ["route-49"],
  stopId: "123",
  directionId: 0,
  nowSeconds: 1_000,
});
assert.equal(departures.length, 1);

const catchable = Core.calculateCatchable(departures, {
  walkingMinutes: 7,
  bufferMinutes: 2,
  nowSeconds: 1_000,
  limit: 3,
});
assert.equal(catchable.length, 1);
assert.equal(catchable[0].arrivalMinutes, 17);
assert.equal(catchable[0].leaveMinutes, 7);

const tooLate = Core.calculateCatchable(departures, {
  walkingMinutes: 20,
  bufferMinutes: 2,
  nowSeconds: 1_000,
  limit: 3,
});
assert.equal(tooLate.length, 0);

const scheduled = Core.findScheduledDepartures(
  [["scheduled-trip", "weekday", 21 * 3600 + 15 * 60, 1, 0]],
  {
    HEADSIGNS: ["49 49TH Avenue/To UBC Exchange"],
    CALENDARS: { weekday: [1, 1, 1, 1, 1, 0, 0, "20260907", "20270103"] },
    EXCEPTIONS: {},
  },
  {
    nowDate: new Date(2026, 10, 9, 21, 13, 0),
    directionId: 1,
    headsignContains: "UBC",
    routeId: "6636",
  }
);
assert.equal(scheduled.length, 1);
assert.equal(scheduled[0].kind, "scheduled");
assert.equal(Math.round((scheduled[0].time - new Date(2026, 10, 9, 21, 13, 0).getTime() / 1000) / 60), 2);

const merged = Core.mergeDepartures(
  [{ ...scheduled[0], time: scheduled[0].time + 60, kind: "realtime" }],
  scheduled
);
assert.equal(merged.length, 1);
assert.equal(merged[0].kind, "realtime");

console.log("Transit core tests passed");
