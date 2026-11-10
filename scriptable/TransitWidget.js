// Personal Transit Widget for Scriptable
// Copy this file, TransitWidgetCore.js, and TransitWidgetData.js into the same
// Scriptable folder. Run this script once inside Scriptable to complete setup.

const Core = importModule("TransitWidgetCore");
const TransitData = importModule("TransitWidgetData");

const API_KEY_KEY = "PersonalTransitWidget.TransLinkApiKey.v1";
const DEFAULT_CONFIG_KEY = "PersonalTransitWidget.DefaultConfig.v1";
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

async function promptForCommute() {
  const existing = readSavedConfig() || {
    name: "My bus",
    route: "49",
    stopCode: "",
    direction: "",
    walkingMinutes: 5,
    bufferMinutes: 2,
    directionId: null,
  };

  const alert = new Alert();
  alert.title = "Set up your bus";
  alert.message = "Use the five-digit number printed on the bus stop sign. Direction ID is optional because most stops serve one direction.";
  alert.addTextField("Name", existing.name);
  alert.addTextField("Route number", existing.route);
  alert.addTextField("Five-digit stop number", existing.stopCode);
  alert.addTextField("Direction label, e.g. UBC", existing.direction);
  alert.addTextField("Walking minutes", String(existing.walkingMinutes));
  alert.addTextField("Safety buffer minutes", String(existing.bufferMinutes));
  alert.addTextField("Direction ID: 0, 1, or blank", existing.directionId ?? "");
  alert.addAction("Save");
  alert.addCancelAction("Cancel");

  const choice = await alert.presentAlert();
  if (choice < 0) return false;

  const parameter = [
    alert.textFieldValue(0),
    alert.textFieldValue(1),
    alert.textFieldValue(2),
    alert.textFieldValue(3),
    alert.textFieldValue(4),
    alert.textFieldValue(5),
    alert.textFieldValue(6),
  ].join("|");
  const parsed = Core.parseWidgetParameter(parameter);
  Keychain.set(DEFAULT_CONFIG_KEY, JSON.stringify(parsed));
  return true;
}

function readSavedConfig() {
  if (!Keychain.contains(DEFAULT_CONFIG_KEY)) return null;
  try {
    return Core.parseWidgetParameter(Keychain.get(DEFAULT_CONFIG_KEY));
  } catch (_) {
    return null;
  }
}

async function handleInAppSetup() {
  const hasKey = Keychain.contains(API_KEY_KEY);
  const hasConfig = Boolean(readSavedConfig());

  if (!hasKey && !(await promptForApiKey())) return false;
  if (!hasConfig && !(await promptForCommute())) return false;
  if (!hasKey || !hasConfig) return true;

  const menu = new Alert();
  menu.title = "Personal Transit Widget";
  menu.message = "Preview your widget or change its one-time setup.";
  menu.addAction("Preview widget");
  menu.addAction("Edit bus setup");
  menu.addAction("Update API key");
  menu.addCancelAction("Cancel");
  const choice = await menu.presentSheet();
  if (choice === 1) return promptForCommute();
  if (choice === 2) return promptForApiKey();
  return choice === 0;
}

function resolveConfiguration() {
  const parameter = args.widgetParameter;
  const commute = parameter ? Core.parseWidgetParameter(parameter) : readSavedConfig();
  if (!commute) throw new Error("Run TransitWidget inside Scriptable once to finish setup");

  const stop = TransitData.STOPS[commute.stopCode];
  if (!stop) throw new Error(`Stop ${commute.stopCode} is not in the bundled TransLink data`);
  const routeIds = TransitData.ROUTES[Core.normalizeRoute(commute.route)];
  if (!routeIds || !routeIds.length) throw new Error(`Route ${commute.route} is not in the bundled TransLink data`);

  return {
    ...commute,
    stopId: stop[0],
    stopName: stop[1],
    routeIds,
  };
}

function cachePathFor(commute) {
  const fileManager = FileManager.local();
  const directory = fileManager.joinPath(fileManager.libraryDirectory(), "PersonalTransitWidget");
  if (!fileManager.fileExists(directory)) fileManager.createDirectory(directory, true);
  const identity = `${commute.route}|${commute.stopCode}|${commute.directionId}`;
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

async function loadDepartures(commute, apiKey) {
  try {
    const request = new Request(`${FEED_URL}?apikey=${encodeURIComponent(apiKey)}`);
    request.timeoutInterval = 20;
    const responseData = await request.load();
    if (!request.response || request.response.statusCode < 200 || request.response.statusCode >= 300) {
      throw new Error(`TransLink returned HTTP ${request.response?.statusCode || "error"}`);
    }

    const feed = Core.decodeGtfsRealtime(responseData.getBytes());
    const fetchedAt = Math.floor(Date.now() / 1000);
    const departures = Core.findDepartures(feed, {
      routeIds: commute.routeIds,
      stopId: commute.stopId,
      directionId: commute.directionId,
      nowSeconds: fetchedAt,
    });
    const result = { departures, fetchedAt, feedTimestamp: feed.timestamp, source: "live" };
    writeCache(commute, result);
    return result;
  } catch (error) {
    const cached = readCache(commute);
    if (cached) return { ...cached, source: "cached", error: String(error) };
    throw error;
  }
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

function addRouteBadge(parent, route) {
  const badge = parent.addStack();
  badge.backgroundColor = new Color("#FFD500");
  badge.cornerRadius = 7;
  badge.setPadding(3, 7, 3, 7);
  const text = badge.addText(route);
  text.font = Font.boldSystemFont(13);
  text.textColor = new Color("#14233C");
}

function buildWidget(commute, result) {
  const now = Math.floor(Date.now() / 1000);
  const limit = config.widgetFamily === "small" ? 2 : 3;
  const catchable = Core.calculateCatchable(result.departures, {
    walkingMinutes: commute.walkingMinutes,
    bufferMinutes: commute.bufferMinutes,
    nowSeconds: now,
    limit,
  });
  const ageMinutes = Math.max(0, Math.floor((now - result.fetchedAt) / 60));
  const stale = ageMinutes >= STALE_AFTER_MINUTES;

  const widget = new ListWidget();
  const gradient = new LinearGradient();
  gradient.colors = [new Color("#12233F"), new Color("#1C3C67")];
  gradient.locations = [0, 1];
  widget.backgroundGradient = gradient;
  widget.setPadding(13, 14, 12, 14);
  widget.url = `https://www.translink.ca/schedules-and-maps/stop/${encodeURIComponent(commute.stopCode)}/schedule`;
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);

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
    const empty = widget.addText("No catchable buses");
    empty.font = Font.semiboldSystemFont(15);
    empty.textColor = Color.white();
    widget.addSpacer(3);
    const detail = widget.addText(`Allow ${commute.walkingMinutes + commute.bufferMinutes} min to reach the stop`);
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
  const source = stale ? "STALE" : result.source === "cached" ? "CACHED" : "LIVE FEED";
  const status = footer.addText(`${source} · ${timeLabel(result.fetchedAt)}`);
  status.font = Font.mediumSystemFont(8);
  status.textColor = stale ? new Color("#FF9B8F") : new Color("#91ABC8");
  footer.addSpacer();
  const attribution = footer.addText("TransLink data");
  attribution.font = Font.systemFont(8);
  attribution.textColor = new Color("#91ABC8");

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
    const commute = resolveConfiguration();
    const result = await loadDepartures(commute, Keychain.get(API_KEY_KEY));
    widget = buildWidget(commute, result);
  } catch (error) {
    widget = buildErrorWidget(error);
  }

  Script.setWidget(widget);
  if (config.runsInApp) await widget.presentMedium();
  Script.complete();
}

await main();
