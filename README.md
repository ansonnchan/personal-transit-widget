# Personal Transit Widget

A personal TransLink departure widget for the iPhone Home Screen, built with
[Scriptable](https://scriptable.app/). It does not need Xcode, an Apple Developer
membership, App Store review, or weekly re-signing.

The widget answers one small question:

> Which of my regular buses can I realistically catch, and when should I leave?

## Why did I build this?

I don't take public transit very often, but when I do, it's usually to familiar places like UBC, work, or a SkyTrain station. For these trips, I tend to take the same routes - the 49, the R4 etc.

Yet every time I'm about to leave, I still find myself opening Google Maps or a transit app just to check when the next bus arrives.

It's a small inconvenience, but one I thought could be avoided. Instead of opening an app and searching for the same route every time, what if I could just glance at my lock screen and know when to leave?

That's the idea behind this project.

## MVP features

- Configures one regular trip with a route, stop, walking time, and safety buffer
- Uses TransLink's supported GTFS-Realtime v3 feed
- Accepts the familiar route number and five-digit number printed on the stop sign
- Shows the next two or three catchable buses
- Calculates `leave in` from walking time plus a safety buffer
- Caches the last successful result and clearly marks cached or stale information
- Stores the TransLink API key in the iPhone Keychain, not in the repository
- Supports small and medium Scriptable widgets
- Supports extra widget configurations through Scriptable's Widget Parameter field

## What you need

1. An iPhone with [Scriptable installed](https://apps.apple.com/app/scriptable/id1405459188).
2. A personal [TransLink Open API key](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/register).
3. These three files from the [`scriptable`](./scriptable) folder:
   - `TransitWidget.js`
   - `TransitWidgetCore.js`
   - `TransitWidgetData.js`

## Install on your iPhone

### 1. Copy the scripts

Copy all three JavaScript files into the same Scriptable folder in iCloud Drive.
The files must keep their original names because the main script imports the other
two by name.

If your Mac and iPhone use the same iCloud account, the easiest path is:

```text
iCloud Drive/
└── Scriptable/
    ├── TransitWidget.js
    ├── TransitWidgetCore.js
    └── TransitWidgetData.js
```

### 2. Complete the one-time setup

Open Scriptable and run **TransitWidget** once. It asks for:

- Your TransLink API key
- A short name such as `To campus`
- The route number, such as `49`
- The five-digit stop number printed on the bus stop sign
- An optional direction label, such as `UBC`
- Walking time
- Safety buffer
- An optional GTFS direction ID (`0` or `1`)

Most physical stops serve one direction, so leave the direction ID blank unless
the widget shows trips for both directions.

The API key is stored in the iPhone Keychain. It is never added to a script or
written into the Git repository.

### 3. Add the Home Screen widget

1. Long-press an empty area of the Home Screen.
2. Choose **Edit → Add Widget**.
3. Find **Scriptable** and select a small or medium widget.
4. Long-press the new widget and choose **Edit Widget**.
5. Set **Script** to `TransitWidget`.
6. Leave **Parameter** empty to use the trip saved during setup.

You can now check departures without opening Scriptable. Tapping the widget opens
the TransLink schedule page for the configured stop.

## Add another trip

Add another Scriptable widget and put a pipe-separated configuration in its
**Parameter** field:

```text
To campus|49|50001|UBC|7|2|
```

The fields are:

```text
name|route|stop number|direction label|walking minutes|buffer minutes|direction ID
```

Direction ID is optional. The same configuration can also be supplied as JSON:

```json
{
  "name": "To campus",
  "route": "49",
  "stopCode": "50001",
  "direction": "UBC",
  "walkingMinutes": 7,
  "bufferMinutes": 2,
  "directionId": 0
}
```

Every widget uses the same API key stored during the one-time setup.

## Refresh behaviour

The script asks iOS to refresh after ten minutes, but iOS ultimately decides when
Home Screen widgets run. The footer always shows whether the result came from the
live feed, the local cache, or is stale, along with the last successful update time.

TransLink currently allows up to 1,000 API requests per day per key. A single widget
requesting a ten-minute refresh stays well below that limit, but iOS timing and
multiple widget instances can change the actual total.

## Development

No dependencies are required. Run the pure JavaScript tests with:

```bash
npm test
```

`TransitWidgetData.js` contains a generated lookup from public stop and route labels
to internal GTFS identifiers. To rebuild it from TransLink's latest static feed:

```bash
curl -sS https://gtfs-static.translink.ca/gtfs/google_transit.zip \
  -o /tmp/translink-google-transit.zip
npm run update-data -- /tmp/translink-google-transit.zip
```

Commit the regenerated `scriptable/TransitWidgetData.js` file. Do not commit an API
key or personal local configuration.

## MVP limitations

- Scriptable and iOS control the actual widget refresh schedule.
- The bundled stop and route lookup should be regenerated when TransLink changes its
  static GTFS identifiers.
- The MVP shows bus arrival and leave times but does not yet show service alerts.
- A full GTFS-Realtime feed is larger than the retired stop-specific RTTI response;
  older phones may occasionally fall back to the cached result under memory pressure.
- The widget is listed under Scriptable rather than under a custom App Store name.

## TransLink data attribution

Route and arrival data used in this product or service is provided by permission of
TransLink. TransLink assumes no responsibility for the accuracy or currency of the
Data used in this product or service.

See TransLink's [developer resources](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources)
and [terms of use](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/terms-of-use).
