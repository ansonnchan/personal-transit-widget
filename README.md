# Personal Transit Widget

> Status: Early planning  
> Visibility: Private personal project

A native iPhone app and Home Screen widget for checking a small set of frequently used TransLink buses without opening a full trip-planning app.

The app focuses on saved combinations of **route, stop, and direction**. A bus route may therefore appear in several favourites when it is used at different stops or in different directions.

## Problem

For a small number of familiar trips, opening a maps app, searching for a destination, and inspecting transit options is unnecessary friction. This project should answer a narrower question immediately:

> Which of my regular buses can I realistically catch, and when should I leave?

## Favourite trip model

Each saved favourite is independent and has its own identifier. The route number is not treated as unique.

```swift
struct FavouriteTrip: Identifiable {
    let id: UUID
    var name: String
    var routeID: String
    var routeLabel: String
    var stopID: String
    var stopName: String
    var direction: String
    var walkingMinutes: Int
    var safetyBufferMinutes: Int
    var sortOrder: Int
    var isEnabled: Bool
}
```

Examples:

| Name | Route | Stop | Direction |
| --- | --- | --- | --- |
| To campus | 49 | Stop A | UBC |
| To shops | 49 | Stop B | Metrotown |
| Home after class | 49 | Stop C | Metrotown |

Exact duplicates may produce a warning, but the data model should not enforce uniqueness based only on the route.

## Planned features

### Manage favourites

- Add a favourite bus trip
- Edit its label, stop, route, direction, walking time, and safety buffer
- Delete a favourite with confirmation
- Reorder favourites
- Temporarily hide a favourite without deleting it
- Save the same route at multiple stops
- Save both directions of the same route

### Catchable departures

For every prediction:

```text
time before leaving =
predicted arrival
- current time
- walking time
- safety buffer
```

A bus that cannot reasonably be reached should be marked as uncatchable or skipped in favour of the next departure.

### Widget

The widget should show:

- Favourite name
- Route and direction
- Next two or three catchable departures
- "Leave in" time
- Whether the value is real-time, scheduled, cached, or stale
- Last successful update
- Manual refresh action

A small widget may show one selected favourite. A medium widget may show several favourites.

### Reliability

- Cache the last successful response
- Never present stale data as current
- Handle missing real-time predictions
- Handle service alerts and cancelled trips
- Distinguish routes that share a number but have different directions
- Preserve favourites when the network is unavailable
- Avoid silently deleting or replacing user configuration

## Data source

The initial implementation will use TransLink GTFS and GTFS-Realtime data. The personal API key must not be committed to the repository. Local secrets and generated configuration should be excluded through `.gitignore`.

Google Maps routing is outside the initial scope because the first version operates on explicitly saved stops and routes rather than calculating arbitrary journeys.

## Proposed architecture

```text
TransLink GTFS / GTFS-Realtime
              ↓
       Transit data client
              ↓
 Filter by route + stop + direction
              ↓
     Shared cached predictions
              ↓
       iOS app + WidgetKit
```

The main app owns configuration and favourite management. The widget reads saved favourites and cached predictions through a shared App Group container.

## Initial milestones

### Milestone 1: Favourite management

- Create the Xcode project
- Define the favourite-trip model
- Add, edit, delete, enable, disable, and reorder favourites
- Persist data locally
- Support repeated route numbers at different stops

### Milestone 2: Transit data

- Connect to TransLink
- Retrieve departures for one saved favourite
- Filter by stop, route, and direction
- Calculate catchable departures
- Cache the most recent valid result

### Milestone 3: Widget

- Add a WidgetKit extension
- Select which favourites a widget displays
- Show dynamic departure countdowns
- Show update status and stale-data warnings
- Add manual refresh

### Later possibilities

- Time-of-day favourite selection
- Lock Screen widget
- Live Activity for an active departure
- Service alerts
- Apple Watch support
- "Leave now" notification
- Optional nearby-stop suggestions

## Non-goals for the first version

- Full point-to-point route planning
- Continuous location tracking
- Public user accounts or synchronization
- Supporting transit systems outside Metro Vancouver
- Publishing an API key in the application or repository

## Open decisions

- Final project and app name
- SwiftData versus a simpler local configuration store
- Whether the first version searches all stops or starts with manually entered stop IDs
- How widget refresh and manual refresh should interact
- How aggressively to hide departures that may be too close to catch
