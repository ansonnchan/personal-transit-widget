// Personal Transit Widget for Scriptable
// Keep this file, TransitWidgetCore.js, and TransitWidgetData.js together.

const Core = importModule("TransitWidgetCore");
const TransitData = importModule("TransitWidgetData");

const API_KEY_KEY = "PersonalTransitWidget.TransLinkApiKey.v1";
const FAVORITES_KEY = "PersonalTransitWidget.Favorites.v2";
const ACTIVE_FAVORITE_KEY = "PersonalTransitWidget.ActiveFavorite.v2";
const LEGACY_CONFIG_KEY = "PersonalTransitWidget.DefaultConfig.v1";
const FEED_URL = "https://gtfsapi.translink.ca/v3/gtfsrealtime";
const REFRESH_MINUTES = 10;
const STALE_AFTER_MINUTES = 15;

async function promptForApiKey() {
  const existing = Keychain.contains(API_KEY_KEY) ? Keychain.get(API_KEY_KEY) : "";
  const alert = new Alert();
  alert.title = "TransLink API key";
  alert.message = "Your key stays in the iPhone Keychain and is never written into this script.";
  alert.addSecureTextField("API key", existing);
  alert.addAction("Save");
  alert.addCancelAction("Cancel");
  const choice = await alert.presentAlert();
  if (choice < 0) return false;
  const value = alert.textFieldValue(0).trim();
  if (!value) throw new Error("The API key cannot be empty");
  Keychain.set(API_KEY_KEY, value);
  return true;
}

function favoriteId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function normalizeFavorite(value) {
  const parsed = Core.parseWidgetParameter(JSON.stringify(value));
  return { ...parsed, id: value.id || favoriteId() };
}

function readFavorites() {
  if (Keychain.contains(FAVORITES_KEY)) {
    try {
      const values = JSON.parse(Keychain.get(FAVORITES_KEY));
      if (Array.isArray(values)) return values.map(normalizeFavorite);
    } catch (_) {}
  }

  if (Keychain.contains(LEGACY_CONFIG_KEY)) {
    try {
      const migrated = normalizeFavorite(JSON.parse(Keychain.get(LEGACY_CONFIG_KEY)));
      writeFavorites([migrated]);
      Keychain.set(ACTIVE_FAVORITE_KEY, migrated.id);
      return [migrated];
    } catch (_) {}
  }

  return [];
}

function writeFavorites(favorites) {
  Keychain.set(FAVORITES_KEY, JSON.stringify(favorites));
  const activeId = Keychain.contains(ACTIVE_FAVORITE_KEY)
    ? Keychain.get(ACTIVE_FAVORITE_KEY)
    : null;
  if (!favorites.some((favorite) => favorite.id === activeId)) {
    if (favorites.length) Keychain.set(ACTIVE_FAVORITE_KEY, favorites[0].id);
    else if (Keychain.contains(ACTIVE_FAVORITE_KEY)) Keychain.remove(ACTIVE_FAVORITE_KEY);
  }
}

function activeFavorite(favorites) {
  const activeId = Keychain.contains(ACTIVE_FAVORITE_KEY)
    ? Keychain.get(ACTIVE_FAVORITE_KEY)
    : null;
  return favorites.find((favorite) => favorite.id === activeId) || favorites[0] || null;
}

async function promptForFavorite(existing) {
  const value = existing || {
    name: "My bus",
    route: "",
    stopCode: "",
    direction: "",
    walkingMinutes: 0,
    bufferMinutes: 0,
    directionId: null,
    headsignContains: "",
  };

  const alert = new Alert();
  alert.title = existing ? "Edit saved bus" : "Add a saved bus";
  alert.message = "Only route and stop number are required. Destination keyword filters short-turn buses, for example UBC or Metrotown.";
  alert.addTextField("Name", value.name);
  alert.addTextField("Route number", value.route);
  alert.addTextField("Five-digit stop number", value.stopCode);
  alert.addTextField("Direction label", value.direction);
  alert.addTextField("Walking minutes", String(value.walkingMinutes || 0));
  alert.addTextField("Safety buffer minutes", String(value.bufferMinutes || 0));
  alert.addTextField("Direction ID: 0, 1, or blank", value.directionId ?? "");
  alert.addTextField("Destination keyword, optional", value.headsignContains || "");
  alert.addAction("Save");
  alert.addCancelAction("Cancel");

  const choice = await alert.presentAlert();
  if (choice < 0) return null;
  const parameter = [
    alert.textFieldValue(0),
    alert.textFieldValue(1),
    alert.textFieldValue(2),
    alert.textFieldValue(3),
    alert.textFieldValue(4),
    alert.textFieldValue(5),
    alert.textFieldValue(6),
    alert.textFieldValue(7),
  ].join("|");
  return { ...Core.parseWidgetParameter(parameter), id: existing?.id || favoriteId() };
}

async function chooseActiveFavorite(favorites) {
  const alert = new Alert();
  alert.title = "Choose active bus";
  alert.message = "The empty-parameter widget displays this bus.";
  for (const favorite of favorites) alert.addAction(`${favorite.route} · ${favorite.name}`);
  alert.addCancelAction("Cancel");
  const choice = await alert.presentSheet();
  if (choice < 0) return false;
  Keychain.set(ACTIVE_FAVORITE_KEY, favorites[choice].id);
  return true;
}

async function removeActiveFavorite(favorites) {
  const active = activeFavorite(favorites);
  if (!active) return favorites;
  const alert = new Alert();
  alert.title = `Remove ${active.name}?`;
  alert.message = `Route ${active.route} at stop ${active.stopCode} will be removed from the saved list.`;
  alert.addDestructiveAction("Remove");
  alert.addCancelAction("Cancel");
  if ((await alert.presentAlert()) < 0) return favorites;
  const updated = favorites.filter((favorite) => favorite.id !== active.id);
  writeFavorites(updated);
  return updated;
}

async function handleInAppSetup() {
  if (!Keychain.contains(API_KEY_KEY) && !(await promptForApiKey())) return false;
  let favorites = readFavorites();

  if (!favorites.length) {
    const favorite = await promptForFavorite(null);
    if (!favorite) return false;
    writeFavorites([favorite]);
    Keychain.set(ACTIVE_FAVORITE_KEY, favorite.id);
    return true;
  }

  const menu = new Alert();
  menu.title = "Personal Transit Widget";
  menu.message = `${favorites.length} saved ${favorites.length === 1 ? "bus" : "buses"}. Active: ${activeFavorite(favorites).name}`;
  menu.addAction("Preview active bus");
  menu.addAction("Switch active bus");
  menu.addAction("Add a bus");
  menu.addAction("Edit active bus");
  menu.addDestructiveAction("Remove active bus");
  menu.addAction("Update API key");
  menu.addCancelAction("Cancel");
  const choice = await menu.presentSheet();

  if (choice === 0) return true;
  if (choice === 1) return chooseActiveFavorite(favorites);
  if (choice === 2) {
    const favorite = await promptForFavorite(null);
    if (!favorite) return false;
    favorites.push(favorite);
    writeFavorites(favorites);
    Keychain.set(ACTIVE_FAVORITE_KEY, favorite.id);
    return true;
  }
  if (choice === 3) {
    const current = activeFavorite(favorites);
    const edited = await promptForFavorite(current);
    if (!edited) return false;
    favorites = favorites.map((favorite) => (favorite.id === current.id ? edited : favorite));
    writeFavorites(favorites);
    return true;
  }
  if (choice === 4) return (await removeActiveFavorite(favorites)).length > 0;
  if (choice === 5) return promptForApiKey();
  return false;
}

function resolveCommute(favorite) {
  const stop = TransitData.STOPS[favorite.stopCode];
  if (!stop) throw new Error(`Stop ${favorite.stopCode} is not in the bundled TransLink data`);
  const routeKey = Core.normalizeRoute(favorite.route);
  const routeIds = TransitData.ROUTES[routeKey];
  if (!routeIds || !routeIds.length) throw new Error(`Route ${favorite.route} is not in the bundled TransLink data`);
  return { ...favorite, route: routeKey, stopId: stop[0], stopName: stop[1], routeIds };
}

function requestedFavorites(favorites) {
  const parameter = String(args.widgetParameter || "").trim();
  if (!parameter) return { mode: "single", favorites: [activeFavorite(favorites)] };
  if (parameter.toLowerCase() === "auto") return { mode: "auto", favorites };
  if (parameter.toLowerCase() === "all") return { mode: "all", favorites };
  if (parameter.toLowerCase().startsWith("favorite:")) {
    const name = parameter.slice(parameter.indexOf(":") + 1).trim().toLowerCase();
    const favorite = favorites.find((entry) => entry.name.toLowerCase() === name);
    if (!favorite) throw new Error(`No saved bus named ${name}`);
    return { mode: "single", favorites: [favorite] };
  }
  return { mode: "single", favorites: [normalizeFavorite(Core.parseWidgetParameter(parameter))] };
}

function cachePathFor(commute) {
  const fileManager = FileManager.local();
  const directory = fileManager.joinPath(fileManager.libraryDirectory(), "PersonalTransitWidget");
  if (!fileManager.fileExists(directory)) fileManager.createDirectory(directory, true);
  const identity = `${commute.route}|${commute.stopCode}|${commute.directionId}|${commute.headsignContains}`;
  return fileManager.joinPath(directory, `departures-${Core.stableHash(identity)}.json`);
}

function readCache(commute) {
  const fileManager = FileManager.local();
  const path = cachePathFor(commute);
  if (!fileManager.fileExists(path)) return null;
  try {
    return JSON.parse(fileManager.readString(path));
  } catch (_) {
    return null;
  }
}

function writeCache(commute, value) {
  FileManager.local().writeString(cachePathFor(commute), JSON.stringify(value));
}

async function fetchRealtimeFeed(apiKey) {
  const request = new Request(`${FEED_URL}?apikey=${encodeURIComponent(apiKey)}`);
  request.timeoutInterval = 20;
  const responseData = await request.load();
  if (!request.response || request.response.statusCode < 200 || request.response.statusCode >= 300) {
    throw new Error(`TransLink returned HTTP ${request.response?.statusCode || "error"}`);
  }
  return Core.decodeGtfsRealtime(responseData.getBytes());
}

function scheduledDepartures(commute, nowDate) {
  const key = `${commute.stopCode}|${commute.route}`;
  return Core.findScheduledDepartures(TransitData.SCHEDULES[key], TransitData, {
    nowDate,
    directionId: commute.directionId,
    headsignContains: commute.headsignContains,
    routeId: commute.routeIds[0],
  });
}

function resultForCommute(commute, feed, feedError, nowDate) {
  const fetchedAt = Math.floor(nowDate.getTime() / 1000);
  const scheduled = scheduledDepartures(commute, nowDate);

  if (feed) {
    const realtime = Core.findDepartures(feed, {
      routeIds: commute.routeIds,
      stopId: commute.stopId,
      directionId: commute.directionId,
      headsignContains: commute.headsignContains,
      headsignByTrip: TransitData.TRIP_HEADSIGNS,
      nowSeconds: fetchedAt,
    });
    const departures = Core.mergeDepartures(realtime, scheduled);
    const source = realtime.length && scheduled.length
      ? "live+scheduled"
      : realtime.length
        ? "live"
        : "scheduled";
    const result = { departures, fetchedAt, feedTimestamp: feed.timestamp, source };
    writeCache(commute, result);
    return result;
  }

  if (scheduled.length) {
    return { departures: scheduled, fetchedAt, source: "scheduled", error: String(feedError || "") };
  }
  const cached = readCache(commute);
  if (cached) return { ...cached, source: "cached", error: String(feedError || "") };
  throw feedError || new Error("No live, scheduled, or cached departures are available");
}

async function loadResults(commutes, apiKey) {
  let feed = null;
  let feedError = null;
  try {
    feed = await fetchRealtimeFeed(apiKey);
  } catch (error) {
    feedError = error;
  }
  const nowDate = new Date();
  return commutes.map((commute) => ({
    commute,
    result: resultForCommute(commute, feed, feedError, nowDate),
  }));
}

function catchableFor(item, limit) {
  return Core.calculateCatchable(item.result.departures, {
    walkingMinutes: item.commute.walkingMinutes,
    bufferMinutes: item.commute.bufferMinutes,
    nowSeconds: Math.floor(Date.now() / 1000),
    limit,
  });
}

function mostUrgent(items) {
  return [...items].sort((left, right) => {
    const leftDeparture = catchableFor(left, 1)[0];
    const rightDeparture = catchableFor(right, 1)[0];
    return (leftDeparture?.leaveAt ?? Infinity) - (rightDeparture?.leaveAt ?? Infinity);
  })[0];
}

function minutesLabel(minutes) {
  if (minutes <= 0) return "now";
  return `${minutes} min`;
}

function timeLabel(epochSeconds) {
  const formatter = new DateFormatter();
  formatter.useNoDateStyle();
  formatter.useShortTimeStyle();
  return formatter.string(new Date(epochSeconds * 1000));
}

function sourceLabel(result) {
  const ageMinutes = Math.max(0, Math.floor((Date.now() / 1000 - result.fetchedAt) / 60));
  if (result.source === "cached") return ageMinutes >= STALE_AFTER_MINUTES ? "STALE" : "CACHED";
  if (result.source === "scheduled") return "SCHEDULE";
  if (result.source === "live+scheduled") return "LIVE + SCHEDULE";
  return "LIVE FEED";
}

function addRouteBadge(parent, route) {
  const badge = parent.addStack();
  badge.backgroundColor = new Color("#FFD500");
  badge.cornerRadius = 7;
  badge.setPadding(3, 7, 3, 7);
  const text = badge.addText(route);
  text.font = Font.boldSystemFont(13);
  text.textColor = new Color("#14233C");
}

function applyWidgetBasics(widget, commute) {
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);
  widget.url = `https://www.translink.ca/schedules-and-maps/stop/${encodeURIComponent(commute.stopCode)}/schedule`;
}

function buildAccessoryWidget(item) {
  const { commute, result } = item;
  const departure = catchableFor(item, 1)[0];
  const widget = new ListWidget();
  widget.addAccessoryWidgetBackground = true;
  applyWidgetBasics(widget, commute);

  if (config.widgetFamily === "accessoryInline") {
    const value = departure
      ? `${commute.route} · bus ${minutesLabel(departure.arrivalMinutes)} · leave ${minutesLabel(departure.leaveMinutes)}`
      : `${commute.route} · no upcoming bus`;
    widget.addText(value).font = Font.mediumSystemFont(11);
    return widget;
  }

  if (config.widgetFamily === "accessoryCircular") {
    const route = widget.addText(commute.route);
    route.font = Font.boldSystemFont(13);
    route.centerAlignText();
    const value = widget.addText(departure ? `${departure.arrivalMinutes}m` : "—");
    value.font = Font.mediumSystemFont(13);
    value.centerAlignText();
    return widget;
  }

  const title = widget.addText(`${commute.route} · ${commute.name}`);
  title.font = Font.semiboldSystemFont(12);
  title.lineLimit = 1;
  const detail = departure
    ? `Bus ${minutesLabel(departure.arrivalMinutes)} · leave ${minutesLabel(departure.leaveMinutes)}`
    : "No upcoming bus";
  const detailText = widget.addText(detail);
  detailText.font = Font.systemFont(11);
  detailText.lineLimit = 1;
  return widget;
}

function buildSingleWidget(item, position, total) {
  if (config.runsInAccessoryWidget) return buildAccessoryWidget(item);
  const { commute, result } = item;
  const limit = config.widgetFamily === "small" ? 2 : 3;
  const catchable = catchableFor(item, limit);
  const widget = new ListWidget();
  const gradient = new LinearGradient();
  gradient.colors = [new Color("#12233F"), new Color("#1C3C67")];
  gradient.locations = [0, 1];
  widget.backgroundGradient = gradient;
  widget.setPadding(13, 14, 12, 14);
  applyWidgetBasics(widget, commute);

  const header = widget.addStack();
  header.centerAlignContent();
  addRouteBadge(header, commute.route);
  header.addSpacer(8);
  const name = header.addText(commute.name);
  name.font = Font.semiboldSystemFont(14);
  name.textColor = Color.white();
  name.lineLimit = 1;

  widget.addSpacer(5);
  const direction = widget.addText(commute.direction || commute.stopName);
  direction.font = Font.systemFont(11);
  direction.textColor = new Color("#BFD3EA");
  direction.lineLimit = 1;
  widget.addSpacer(8);

  if (!catchable.length) {
    const empty = widget.addText("No upcoming buses");
    empty.font = Font.semiboldSystemFont(15);
    empty.textColor = Color.white();
    widget.addSpacer(3);
    const detail = widget.addText(`Stop ${commute.stopCode} · ${sourceLabel(result).toLowerCase()}`);
    detail.font = Font.systemFont(10);
    detail.textColor = new Color("#BFD3EA");
  } else {
    for (const departure of catchable) {
      const row = widget.addStack();
      row.centerAlignContent();
      const arrival = row.addText(`${minutesLabel(departure.arrivalMinutes)} bus`);
      arrival.font = Font.semiboldSystemFont(14);
      arrival.textColor = Color.white();
      row.addSpacer();
      const leave = row.addText(`leave ${minutesLabel(departure.leaveMinutes)}`);
      leave.font = Font.mediumSystemFont(12);
      leave.textColor = departure.leaveMinutes <= 1 ? new Color("#FFD500") : new Color("#BFD3EA");
      widget.addSpacer(4);
    }
  }

  widget.addSpacer();
  const footer = widget.addStack();
  const status = footer.addText(`${sourceLabel(result)} · ${timeLabel(result.fetchedAt)}`);
  status.font = Font.mediumSystemFont(8);
  status.textColor = new Color("#91ABC8");
  footer.addSpacer();
  const count = footer.addText(total > 1 ? `${position + 1}/${total} · TransLink data` : "TransLink data");
  count.font = Font.systemFont(8);
  count.textColor = new Color("#91ABC8");
  return widget;
}

function buildDashboardWidget(items) {
  const widget = new ListWidget();
  const gradient = new LinearGradient();
  gradient.colors = [new Color("#12233F"), new Color("#1C3C67")];
  gradient.locations = [0, 1];
  widget.backgroundGradient = gradient;
  widget.setPadding(13, 14, 12, 14);
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);

  const title = widget.addText("My buses");
  title.font = Font.semiboldSystemFont(14);
  title.textColor = Color.white();
  widget.addSpacer(8);

  const ranked = [...items].sort((left, right) => {
    const leftDeparture = catchableFor(left, 1)[0];
    const rightDeparture = catchableFor(right, 1)[0];
    return (leftDeparture?.leaveAt ?? Infinity) - (rightDeparture?.leaveAt ?? Infinity);
  });

  for (const item of ranked.slice(0, 3)) {
    const departure = catchableFor(item, 1)[0];
    const row = widget.addStack();
    row.centerAlignContent();
    addRouteBadge(row, item.commute.route);
    row.addSpacer(8);
    const name = row.addText(item.commute.name);
    name.font = Font.mediumSystemFont(12);
    name.textColor = Color.white();
    name.lineLimit = 1;
    row.addSpacer();
    const value = row.addText(departure
      ? `${departure.arrivalMinutes}m · leave ${minutesLabel(departure.leaveMinutes)}`
      : "—");
    value.font = Font.mediumSystemFont(11);
    value.textColor = departure?.leaveMinutes <= 1 ? new Color("#FFD500") : new Color("#BFD3EA");
    widget.addSpacer(6);
  }

  widget.addSpacer();
  const footer = widget.addText(`${items.length} saved · use “auto” for the most urgent bus`);
  footer.font = Font.systemFont(8);
  footer.textColor = new Color("#91ABC8");
  return widget;
}

function buildErrorWidget(error) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#321D28");
  widget.setPadding(14, 14, 14, 14);
  const title = widget.addText("Transit widget");
  title.font = Font.boldSystemFont(16);
  title.textColor = Color.white();
  widget.addSpacer(8);
  const message = widget.addText(String(error.message || error));
  message.font = Font.systemFont(11);
  message.textColor = new Color("#FFD0D6");
  message.lineLimit = 5;
  widget.addSpacer();
  const hint = widget.addText("Run the script in Scriptable to fix setup");
  hint.font = Font.systemFont(9);
  hint.textColor = new Color("#D9AEB7");
  return widget;
}

async function main() {
  if (config.runsInApp && !(await handleInAppSetup())) return;

  let widget;
  try {
    if (!Keychain.contains(API_KEY_KEY)) throw new Error("TransLink API key is not configured");
    const favorites = readFavorites();
    if (!favorites.length) throw new Error("No saved buses. Run the script in Scriptable to add one");
    const selection = requestedFavorites(favorites);
    const commutes = selection.favorites.filter(Boolean).map(resolveCommute);
    const items = await loadResults(commutes, Keychain.get(API_KEY_KEY));

    if (selection.mode === "all" && !config.runsInAccessoryWidget && config.widgetFamily !== "small") {
      widget = buildDashboardWidget(items);
    } else {
      const selected = selection.mode === "auto" || selection.mode === "all"
        ? mostUrgent(items)
        : items[0];
      const index = favorites.findIndex((favorite) => favorite.id === selected.commute.id);
      widget = buildSingleWidget(selected, Math.max(index, 0), favorites.length);
    }
  } catch (error) {
    widget = buildErrorWidget(error);
  }

  Script.setWidget(widget);
  if (config.runsInApp) await widget.presentMedium();
  Script.complete();
}

await main();
