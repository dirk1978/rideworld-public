# RideWorld admin guide

Everything the person running a RideWorld server needs to know: setting it up, the keys and accounts, adding and fixing
routes, open worlds, riding together, training, and keeping it running. For riders' instructions (connecting a trainer,
the views, the keys) see the [riders' guide](RIDER-GUIDE.md); for building your own open world see
[BUILDING-WORLDS.md](BUILDING-WORLDS.md).

**Contents**

1. [What you're running](#1-what-youre-running)
2. [Install and first start](#2-install-and-first-start)
3. [The address riders use, certificates, riding from outside](#3-the-address-riders-use-certificates-riding-from-outside)
4. [Keys: Google, Cesium ion, Strava](#4-keys-google-cesium-ion-strava)
5. [Accounts, registrations and email](#5-accounts-registrations-and-email)
6. [The three kinds of riding](#6-the-three-kinds-of-riding)
7. [Routes: adding them](#7-routes-adding-them)
8. [The route worker: what happens to every new route](#8-the-route-worker-what-happens-to-every-new-route)
9. [Route details](#9-route-details)
10. [Fixing a route: the route editor and Route Studio](#10-fixing-a-route-the-route-editor-and-route-studio)
11. [Hand-tuning a route in data/routes.json](#11-hand-tuning-a-route-in-dataroutesjson)
12. [Open worlds](#12-open-worlds)
13. [Riding together](#13-riding-together)
14. [The phone remote](#14-the-phone-remote)
15. [Training: workouts, plans, the coach](#15-training-workouts-plans-the-coach)
16. [Rides, photos, clips and Strava](#16-rides-photos-clips-and-strava)
17. [Problem reports and the status page](#17-problem-reports-and-the-status-page)
18. [Computers, phones, apps and sensors](#18-computers-phones-apps-and-sensors)
19. [Keeping it running: backups, updates, logs](#19-keeping-it-running-backups-updates-logs)
20. [Outside services and privacy](#20-outside-services-and-privacy)
21. [Troubleshooting](#21-troubleshooting)
22. [Command-line tools](#22-command-line-tools)

---

## 1. What you're running

- **The web server** (`server.js`, Node.js, no npm packages): serves the app over HTTPS and a small JSON API, keeps the
  accounts, routes, rides and settings, and relays riders' positions to each other over a WebSocket (`/ws`).
- **The route worker** (`tools/pipeline/worker.mjs`): a second process that takes each new or replaced route through a
  queue of improvements (survey heights, bridges, climbs: see [section 8](#8-the-route-worker-what-happens-to-every-new-route)).
  `./start.sh`, Docker and `./setup.sh --service` all run it for you.
- **The browser does the heavy lifting**: the 3D, the physics, the trainer and sensors all run in each rider's browser.
  The server needs very little: a Raspberry Pi 4 or a small NAS is enough for a household; one ordinary core carries
  hundreds of riders at once.
- **Everything private lives in `data/`** (accounts with scrypt-hashed passwords, routes, rides, photos, settings,
  keys) and **`certs/`** (the HTTPS key). Both are kept out of git. Back them up (see [section 19](#19-keeping-it-running-backups-updates-logs)).

## 2. Install and first start

The [README](../README.md) has the short version. In more detail:

**Docker**

```sh
cp .env.example .env    # set HOST_IP to this computer's LAN address (it goes in the certificate and the links)
docker compose up -d
docker compose logs rideworld   # the first admin's password, shown once
```

`PORT` in `.env` is the port on this computer; inside the container it is always 8443. Data and certificates are in
`./data` and `./certs` beside the compose file.

**Without Docker** (Linux, macOS, WSL; Node.js 20+)

```sh
./setup.sh              # .env, the data folder, a certificate, the first admin account (password shown once)
./start.sh              # runs the web server and the route worker; Ctrl+C stops both
./setup.sh --service    # instead of start.sh: installs both as systemd services that start at boot (Linux)
```

**Lost the admin password?** `node tools/adduser.js admin --reset` prints a new one (Docker:
`docker compose exec rideworld node tools/adduser.js admin --reset`). The server notices the change straight away.

**Then, in the app** (signed in as admin):

1. 🔑 **Keys**: a Google key for photo-real scenery and a Cesium ion token for everything else ([section 4](#4-keys-google-cesium-ion-strava)).
2. **Accounts**: add your riders, or switch on registration ([section 5](#5-accounts-registrations-and-email)).
3. Install an open world: `tools/get-world.sh bromsgrove-open` ([section 12](#12-open-worlds)).
4. Pick a route, press **Simulator** and ride it with ↑ / ↓ to check it all works before a real ride.

## 3. The address riders use, certificates, riding from outside

**HTTPS is not optional.** Browsers only allow Bluetooth, USB (ANT+ sticks), the screen wake lock and the phone remote on
https pages.

- **The self-signed certificate** made by setup works, but each browser warns once (Advanced → Continue). Phones are
  fussier. To avoid the warning, install [mkcert](https://github.com/FiloSottile/mkcert) before running `./setup.sh`
  (then install mkcert's root on the other computers), or put your own `certs/key.pem` and `certs/cert.pem` in place
  and restart.
- **`PUBLIC_URL`** (in `.env`) is the address riders open. It goes into password-reset and welcome emails, the
  Strava sign-in return, and the phone remote's QR code. `./setup.sh` fills in this computer's LAN address
  (`https://<LAN address>:8443`); Docker uses `HOST_IP`. Change it if riders come in another way, and restart.
- **Riding from outside your home** (friends elsewhere, your phone on mobile data for the remote): put RideWorld behind
  a reverse proxy with a real certificate (Caddy, Nginx Proxy Manager, Traefik) on a domain you own, forward it to
  `https://<server>:8443`, **turn on WebSocket support** in the proxy (multiplayer and the phone remote need it), allow
  uploads of at least 10 MB (route files, ride photos and clips), and set `PUBLIC_URL=https://your.domain`.
  - If the proxy rate-limits, give the static files (`/js`, `/css`, `/img`, `/models`, `/media`) a generous limit: a
    page loads ~60 files at once and one refused file stops the app starting (the setup screen shows but nothing works).
  - The server trusts `X-Real-IP` (for its sign-in throttle) only from a proxy on a private address.
- **Open ports**: just the HTTPS port (8443 by default). Nothing else listens.

## 4. Keys: Google, Cesium ion, Strava

All under 🔑 **Keys** (admins only). The scenery keys are shared by every rider, so their browsers can load the
scenery; only admins can see or change them.

- **Google Maps Platform key**: Photorealistic 3D Tiles, the real-world 3D for photo-real routes and the satellite view
  in Route Studio. In Google Cloud: create a project, enable the **Map Tiles API**, create an API key
  ([how](https://developers.google.com/maps/documentation/tile/get-api-key)), and **restrict it to your site**
  (Application restrictions → Websites → `https://your.address/*`, and the LAN address if riders use that too).
  Google gives a monthly free allowance; a household riding a few times a week normally stays within it, but check
  your billing alerts. Open worlds and Lite scenery never use it.
- **Cesium ion token**: the world terrain and aerial imagery under Lite scenery, generated worlds and classic routes,
  and the fallback when there's no Google key. Free at [ion.cesium.com](https://ion.cesium.com) (Access Tokens →
  your default token). The free plan's monthly limits are generous for a household. Painted open worlds don't load
  its imagery unless someone presses **G** for the satellite photo.
- **Strava app** (optional): lets riders press **Connect with Strava** and upload a finished ride in one click (shown
  as a Virtual Ride, with the right name and description). At [strava.com/settings/api](https://www.strava.com/settings/api)
  create an app with **Authorization Callback Domain** = your public domain (the host in `PUBLIC_URL`), then paste the
  Client ID and Secret here. The secret is stored on the server and never shown again. A new Strava app allows **one
  athlete** until Strava reviews it; until then everyone else saves the .fit file and uploads it on strava.com
  (riders' guide). Strava's API can't add photos to an activity.

## 5. Accounts, registrations and email

Everything needs an account: signed-out visitors see only the landing page (the sign-in page with the hero picture).

**Accounts** (button beside your name, admins):

- **Add someone**: username, name, admin or not. A generated password is shown once: pass it on.
- Per account: **new password** (shown once) and **remove** (signs them out; their rides and routes stay in `data/`).
  Admin is chosen when the account is made; to make an existing account an admin, set `"admin": true` on it in
  `data/users.json` (the server notices the change by itself).
  There's always at least one admin.
- Riders change their own password (which signs out their other devices), and can sign in with their username, their
  email or their name, in any case.
- **Forgotten your password?** on the sign-in page emails a reset link (valid one hour, once) to the account's email.
  It needs email set up (below); without it, ask the admin, who uses **new password**.
- Sign-in is throttled (8 failures per 15 minutes per address and per address + username).

**Registered interest**: the landing page has a **Register your interest** form. Entries appear in Accounts:

- **Approve** makes the account (username from their name, e.g. `alex.smith`), a generated password, and emails them
  the sign-in details with your notes. **Send again** makes a new password. If an account for them exists already,
  **Email details** sends that instead.
- **Remove** drops the entry. Up to 5 registrations per address per hour; there's a hidden spam trap.

**Email (Brevo)**: RideWorld sends email through [Brevo](https://www.brevo.com)'s HTTP API (no mail server needed, and
nothing on port 25, which home connections usually block). The free plan sends 300 a day.

1. Make a Brevo account, verify a sender address (or better, authenticate your domain with the DNS records Brevo shows).
2. Brevo → SMTP & API → API keys → create one.
3. Accounts → Email: paste the key, the "send from" address (verified), a sender name, and **Send registrations to**
   (your inbox; `NOTIFY_EMAIL` in `.env` is used when this is empty).
4. **Send each person a thank-you email** (on by default), and **Notes in the welcome email**: your own words, sent with
   the username and password when you Approve (empty = the standard notes). The welcome email also carries the
   riders' guide.
5. **Send a test email** and **Preview welcome email** (sends an example to you).

The key is stored in `data/mail.json` (private) and never sent back to the browser (only its last 4 characters).

## 6. The three kinds of riding

The top of the setup screen has three big buttons; each recolours the app.

| Mode | What it is | Scenery |
|---|---|---|
| 🗺 **Open world** (yellow) | A whole map to ride freely: choose turns at junctions, use the satnav, or follow a pre-plotted ride | RideWorld's own painted 3D world built from OpenStreetMap and laser-survey heights. No Google key needed |
| 〰 **Routes** (blue) | Classic start-to-finish routes | Lite: terrain + aerial imagery with a generated world of buildings, trees and hedges from OpenStreetMap, plus RideWorld's own road |
| 📷 **Photoreal** (red) | Start-to-finish routes in Google's real 3D (best for open mountain roads) | Google Photorealistic 3D Tiles with RideWorld's clean road laid through it, where the computer can manage it |

A route's mode follows its **Scenery** setting ([section 9](#9-route-details)): "Generated world only" puts it in
Routes, the rest (including riders' own uploads) in Photoreal. Riders can also pick **Scenery type** (⚙ Advanced):
Auto (Lite on laptop-class graphics), Full 3D or Lite.

## 7. Routes: adding them

**Two kinds of route**:

- **RideWorld routes** (`server`): everyone sees them; only admins change or delete them. Drop-in multiplayer and group
  rides only use these. Hand corrections live on them.
- **My routes** (`user`): a rider's own uploads, visible only to them (and admins). An admin can **Make server route**
  to promote one.

**Ways in** (setup screen → Route, in Routes / Photoreal mode):

- **Plan on the map**: click points, BRouter routes them along real roads (profiles for fast road riding, safer roads
  or trekking), optional loop back to the start, postcode search, then save. Heights come from the map (SRTM), which
  the route worker then improves where it can.
- **Load a file**: GPX, TCX, FIT or KML from Strava, Komoot, RideWithGPS, Garmin, Wahoo and so on (up to 8 MB). A
  file recorded on a head unit (times and heights on nearly every point) is recognised as a **recorded ride** and its
  heights are trusted. Admins can tick "save straight as a RideWorld route".
- Every route card has **Export** (GPX, TCX course, FIT course, KML) of the route exactly as ridden, corrections built
  in, and, where you're allowed to edit it, **Replace GPX…** (keeps the id, name, segments and ride history; the old
  file is kept as `.prev.gpx` and the old corrections in `previousCorrections`).

**On every route card**: flag and place, outline thumbnail over its height profile, distance, climbing, an estimated
time at the rider's pace (the % of FTP chosen above the list), bridges and tunnels found, and the processing status.
The list has search, country filter and sorting.

**Start at** (under the route): start any ride part-way along, in the rider's units.

**Analyse** re-runs the OpenStreetMap check for bridges, tunnels and cobbles; **Process again** re-runs the route worker
(it asks first on a RideWorld route, because hand-tuned heights are replaced).

## 8. The route worker: what happens to every new route

Saving or replacing a route queues it; the card shows a progress bar step by step, then "✓ Processed" with a summary and
anything **worth a look**. One route at a time, oldest first. Steps:

1. **Read**: recorded ride or drawn route.
2. **Tidy**: recorded rides lose the points where you were standing still.
3. **Height source**: laser-survey heights where a free national survey covers the route: **England** (Environment
   Agency LIDAR, 1 m), **Wales** (Welsh Government LIDAR), **Scotland** (Scottish LIDAR), **France** (IGN RGE ALTI),
   **South Tyrol** (the province's DTM), **Switzerland** (swisstopo). Elsewhere the file's heights stay.
4. **Re-height**: the route's heights from that survey, bridges carried across (the survey measures the river under
   them), gradients limited to what the route itself suggests. Trusted afterwards, so the trainer uses them.
5. **Google offset**: how far Google's 3D sits above the survey (about 51 m in England: Google uses heights above the
   ellipsoid). Needs Playwright (`npm install playwright` in the folder, or set `PLAYWRIGHT_PATH`) and a Google key;
   without them this step is skipped and the 3D road is found by measuring alone, which is fine on most routes.
6. **Bridges**: crossings under bridges from OpenStreetMap; in England, decks 2.5-12 m over the road become
   underpasses with a built tunnel.
7. **Climbs**: every climb of 25 m+ (300 m+, 3%+) becomes a timed segment with a leaderboard (only if the route has no
   segments of its own); 6 or more hairpins are flagged as worth a look.
8. **Walls**: rock walls on the uphill side of long steep climbs.

Logs: `data/pipeline-worker.log` (start.sh / Docker) or `journalctl -u rideworld-pipeline` (service). The uploaded file
is kept once as `data/routes/<id>.orig.gpx`.

Separately, the server looks up each new route's **country** (for the flag) and builds its **generated world**
(buildings, woods, trees, hedges from OpenStreetMap within ~150 m of the route) in the background: a few minutes for a
town.

## 9. Route details

**Edit details…** on a card (owner, or admin for RideWorld routes):

- **Name, Where, Description.**
- **Highest clean-road bank**: the brown banks between RideWorld's road and Google's scenery (hillsides need them; in
  towns they can climb into trees: try 1).
- **Raise the camera over trees, walls and hillsides**: on by default; untick for a low camera (filming open roads).
- **Scenery**: rider's choice / generated world only (towns: Google's 3D is messy there) / photo-real 3D when the
  computer can (open mountain roads).
- **Hedgerows in the generated world**: from the laser survey along lanes (England).
- **This file's heights are reliable**: gradients come from the file, and the 3D road is kept within 10 m of it, so an
  unmapped tunnel or bridge can't throw it off. Set by itself for recorded rides and survey-heighted routes.

## 10. Fixing a route: the route editor and Route Studio

Google's 3D and OpenStreetMap's lines are never perfect. Two tools fix what riders report, without touching the file
(corrections are stored with the route and applied in order on load; **Export** bakes them in).

**The route editor** (✏️ in the ride, or **E**; Simulator rides only; RideWorld routes: admins; own routes: the owner):

- The stretch being changed shows blue (30 m either side of you; **[** and **]** pin a longer stretch), a white line where
  it was. **J** jumps to a distance, or drag along the elevation graph.
- **← →** move the line 0.5 m, **↑ ↓** raise or lower the road 0.25 m, **Enter** keeps the change (saved at once).
- **Straighten stretch** (S): a straight line between the ends (wavering lines on straight streets).
- **Level stretch** (L): a steady slope between the ends (dips where the map's heights fall into a valley).
- **Use my heights**: on a recorded ride, where Google's 3D has humps or hollows the real road doesn't, the road follows
  the recording and RideWorld builds cuttings, embankments, walls, viaducts or a tunnel through Google's ground.
- **Find the road**: flies the whole route looking down, finds the road in Google's imagery and slides the route onto
  it (OpenStreetMap's line is often a few metres to one side). A few minutes; saves itself; **Undo road centring**.
- **Crop the route**: Route starts here / Route ends here / Reset crop.
- **Segments**: set a stretch with [ ], then **Mark stretch as a segment** (climb, sprint or segment by its gradient),
  with a leaderboard. Every route also has a whole-route segment.
- The list shows every correction with **Show** and **×**.

**Route Studio** (🎢 on an editable card): a full-page editor over Google's satellite map, the line coloured by how tight
each bend is, with suspected chicanes marked and a lean strip along the bottom. Select a stretch, then **Smooth bend**
(B, with a tension slider), **Straighten** (T), **Drag the track** (2), or nudge with ← →. Every change saves; Undo / Redo
(Z / Y); **Ride it** jumps into the simulator at that spot.

**Problem reports** from riders ([section 17](#17-problem-reports-and-the-status-page)) tell you where to look:
each has a screenshot, the route, distance and camera.

## 11. Hand-tuning a route in data/routes.json

For things with no button yet, a route's entry in `data/routes.json` takes extra fields. Stop the server (or make a
copy and work on that), back the file up, edit, restart. Distances are kilometres along the whole route.

| Field | What it does |
|---|---|
| `start`, `finish` | trim the route (the editor's crop writes these) |
| `heightGuard` | trusted routes: how far above the file the 3D road may go (default 10 m; `false` = no limit) |
| `googleOffset` | Google's height above the file's (the worker sets it); readings far from it are ignored |
| `lowCam` | `[[fromKm, toKm]]`: a low camera riding the road (narrow lanes, cobbled climbs) |
| `sideWalls` | `[[fromKm, toKm, 'hedge' \| 'brick' \| 'concrete']]` walls beside the road (wooded cuttings) |
| `viewpoints` | TV-style camera shots: `{ name, lat, lon, up or alt, radius, before, after, follow?, look?, fov?, frame?, noClean? }` |
| `landmarks` | your own models (`public/models/landmarks/*.glb`): `{ model, lat, lon, alt, heading, clips, cam?, orbit? }` |
| `structures.list[]` | tunnels found by the analyser; add `style` (`bore`, `rail`, `gallery`, `underpass`), `width`, `height`, `open` |
| `pieces` | a highlights route made of pieces of another (`tools/routes/highlights.mjs` makes one) |

The comments at the top of `public/js/app/landmarks.js`, `camera.js` and `tunnelkit.js` document each in full. Models are
built with the Blender scripts in `tools/kit/` (Blender 4.x, run headless).

## 12. Open worlds

**Installing a ready-built world**:

```sh
tools/get-world.sh                      # lists them
tools/get-world.sh bromsgrove-open      # or london-central, stratford-alcester
```

Downloads from this project's GitHub release (set `WORLDS_URL` in `.env` to host packs elsewhere), installs the world,
plans its pre-plotted rides, and adds it to the list. Reload the app. Each is a few tens of MB.

**What riders get**: junction cards (a little map of each junction, ← → to choose, U to turn round), the satnav (🧭 or /:
search a place, street or pub, or click the map; **Ride there** routes you along quiet roads by default, **Jump there**
moves you), about ten pre-plotted rides per world followed exactly, landmark models with fly-by camera shots, canals,
locks, fords, footbridges, road and place names as you reach them, and painted ground (G switches to the satellite
photo).

**The map editor** (🗺 Map Editor on an open-world card, admins): the world's road network on a street map or
satellite. **Inspect** a stretch (name, type, length, one-way; remove it, make it two-way or one-way), **Draw a path**
(ends snap to the network), add a **wall or hedge**, **Remove a stretch**, **Ride from here**. **Save**, then **Rebuild**
(about 20-60 s; the old world is kept as `.prev`). Edits are kept in `data/world/<id>.edits.json` and survive rebuilds.

**Your own world**: [BUILDING-WORLDS.md](BUILDING-WORLDS.md). Pre-plotted rides: `tools/openworld/rides/<id>.json`
(waypoints by place name, street or position), planned with `node tools/openworld/rides.mjs <id> --write`.

## 13. Riding together

- **Drop-in** (setup → Ride with others, on by default): see anyone else riding the same RideWorld route (not riders'
  own routes, and not open worlds yet). Each rider is
  sent their nearest 40 others, so a crowd costs the same as a few (about 5 KB/s each).
- **Group rides**: a rider creates one on a RideWorld route with a name and banding (**Firm** always together, **Soft** a
  gentle pull, **Off** a race); friends join from the list; the host presses **Start the ride for everyone** for a
  5-second countdown. Late joiners are pulled up by the banding. Up to 3 open per host, gone after 4 hours. Banding only
  changes how far you move, never the trainer or your recorded power.
- **Drafting** for everyone (pacers included): up to about a third less effort on a wheel, shown under the power dial and
  sent to the trainer.
- **Pacers** (up to 5, at a power each rider chooses) and **ghosts** (your earlier rides on the route, see-through).
- **Chapeau** (H, or click a name): a 🎩 to another rider.
- Group rides survive a server restart; riders reconnect by themselves.

## 14. The phone remote

`https://<your address>/rc` on a phone signed in to the same account (the setup screen shows a QR code, made from
`PUBLIC_URL`). Start / pause, camera, photos and video clips, junction choices and U-turns in open worlds, workout
easier / harder / skip / ERG, gears, music (play, next, previous, pick a playlist), finish, report a problem, and live
power / heart rate / speed. It works over mobile data too if the server is reachable from outside.

## 15. Training: workouts, plans, the coach

- **Workouts** (setup → Workout): built-in sessions (sweet spot, VO2, over-unders, endurance, recovery, tempo,
  threshold, pyramid, 30/30s, big-gear climbing, sprints, FTP test, ramp test, heart-rate zone 2, Benchmark 20…), riders'
  own Zwift `.zwo` files, and **＋ Build a workout** (blocks, repeats, cadence, saved as .zwo). **ERG** holds the target
  power; Length and Intensity scale a session (not the tests). Heart-rate sessions steer the watts to hold a heart rate.
- **Ramp test**: rising 1-minute steps until you can't hold it; FTP = 75% of the best minute; heart-rate analysis of each
  step and the recovery.
- **Benchmark 20**: 20 minutes steady at 65% of FTP; ridden every few weeks, it shows fitness as heart rate at the same
  watts.
- **Training plans** (Coach section): get going (4 weeks), FTP builder (6), sportive (8), three chosen days a week, with
  catch-ups and swaps.
- **Weekly goal** (time, distance or rides) with a streak and milestones.
- **The coach** (per rider: Rider & kit → Virtual coach; FTP raised automatically or asked first): fitness, fatigue and
  form, FTP estimate, critical power and W′, VO2max and fitness age, power profile, heart rate against power, recovery
  (overall and at the same power), threshold from steady efforts, benchmarks, weekly training capacity, today's workout
  and routes (one or two of each kind), tips during the ride, and a summary at the finish. Rides that look like
  simulator tests are left out automatically, and riders can leave any ride out.
- **Ride analysis** (📈 from My rides, the coach or the finish): power, heart rate, cadence, speed and elevation charts,
  zooming, intervals found, zone times, best efforts.

## 16. Rides, photos, clips and Strava

- **My rides**: every finished ride (simulator rides are never kept), with .fit / .tcx / .gpx downloads, Strava, photos
  and analysis.
- **Photos**: P any time, and a few taken automatically per ride. If the rider shares the tab when asked at Go ride, the
  photos include everything on screen. Each ride with photos gets a **share page** `/share/<code>`: a plain public page
  with the photos and the ride's numbers (deleting the ride removes it).
- **Clips**: V (or the remote) records 20 s to 5 min (⚙ Advanced → Ride clips), converted to MP4 on the server with
  **ffmpeg** (in the Docker image; install it otherwise: `apt install ffmpeg` / `brew install ffmpeg`). Without ffmpeg
  clips stay WebM.
- **Strava**: one-click upload once the admin has set up a Strava app ([section 4](#4-keys-google-cesium-ion-strava)),
  otherwise riders save the .fit and upload it on strava.com.
- **Music**: riders paste a YouTube or YouTube Music link; the player and controls sit on screen.

## 17. Problem reports and the status page

- **Reports**: riders press **R** (or ⋯ → Report a problem here, or the remote). The ride pauses; they type a few words;
  a screenshot and the exact context (route, distance, position, road height and gradient, camera, sensors, frame rate,
  graphics card, device) are saved in `data/reports/`. Read them with `node tools/reports.mjs` (newest first;
  `node tools/reports.mjs 5` for five, or an id for one). The `.jpg` beside each is the screenshot.
- **Client errors**: errors in riders' browsers are posted to the server log ("client error [user] ...").
- **The status page** (`/status`, admins, link beside Accounts): who's online with a dot per rider on a map, riders and
  their totals, the latest rides, and server health (uptime, load, memory, disk).

## 18. Computers, phones, apps and sensors

- **Browsers**: Chrome or Edge on Windows, Mac, Linux or ChromeOS; Chrome on Android. Firefox and Safari have no
  Bluetooth or USB. iPhone and iPad browsers can't reach trainers (WebKit); the Bluefy browser can, untested.
- **Graphics**: each browser tunes itself (⚙ Advanced → Detail: Auto; Priority: Sharp or Smooth) and remembers what
  suited its graphics card. Slow laptops get Lite scenery automatically. If a powerful PC is slow, check
  `chrome://gpu`: Chrome may be drawing in software.
- **Phones and tablets** have their own layout and touch controls. **On screen** (setup) hides panels per device.
- **Sensors**: Bluetooth (FTMS trainers, Cycling Power meters, heart-rate straps, with battery levels) and ANT+ USB
  sticks (FE-C trainers, power, heart rate). Sensors are remembered and reconnect. On Windows an ANT+ stick needs the
  WinUSB driver for the browser to see it (Zadig; the app has a how-to video). Only one app can control a trainer.
- **Virtual gears** (⚙ Advanced): 24 gears for a Zwift Cog or any single-speed setup ([ and ], or the remote).
- **Trainer difficulty** (⚙ Advanced): how much of each climb the trainer gives (50% = Zwift's default).
- **The apps** in `apps/` load your server's address:
  - **Windows** (`apps/windows`, Electron): its own Bluetooth picker, keeps the screen awake, uses the fast graphics card
    on laptops. Set your address in `main.js` (`HOME`, or the `RIDEWORLD_URL` environment variable), then
    `npm install && npm run dist`.
  - **Android** (`apps/android`): a full-screen WebView with native Bluetooth. Set your address in
    `MainActivity.java` (`HOME` and `INSIDE`), make a keystore, and build with `apps/android/build.sh` (Docker, no
    Android Studio needed: see the comments in it).

## 19. Keeping it running: backups, updates, logs

**Back up** `data/`, `certs/` and `.env`. That is everything: the code can always be cloned again. `data/cache/`
(downloaded survey tiles) can be left out. Rides are FIT files plus a small index per rider; photos and clips are the
bulk. A nightly copy with hard links (rsync `--link-dest`) keeps it cheap.

**Update**:

```sh
git pull
docker compose up -d --build      # Docker
# or: restart start.sh / sudo systemctl restart rideworld rideworld-pipeline
```

Your data is untouched by updates. Browsers pick up the new app on their next reload (files are served with
`no-cache`). Restart only when no one is riding: a restart drops multiplayer rooms for a moment (riders reconnect by
themselves; their ride carries on in the browser).

**Logs**: `docker compose logs -f rideworld`, or `journalctl -u rideworld -f` (service), or the terminal running
`start.sh`. The route worker: `data/pipeline-worker.log` or `journalctl -u rideworld-pipeline`.

**Tests**: `node tests/unit.mjs` (about 200 checks, a second). `tests/e2e.js` drives real browsers through riding,
pacers, ghosts, the route editor and group rides (needs Playwright; see its header).

## 20. Outside services and privacy

RideWorld has no telemetry and sends nothing about your riders anywhere except where a feature needs it:

| Service | Used for | From |
|---|---|---|
| Google Map Tiles API | photo-real 3D, Route Studio satellite | riders' browsers, your key |
| Cesium ion | terrain and aerial imagery | riders' browsers, your token |
| OpenStreetMap tiles, Nominatim | the small maps, place search, country flags | browsers / server |
| Overpass API | bridges, tunnels, cobbles, generated worlds | server |
| BRouter (brouter.de) | planning routes on the map | browser |
| National laser surveys (EA, IGN, swisstopo…) | route heights | route worker |
| YouTube | music, if a rider pastes a link | browser |
| Strava, Brevo | uploads and email, if you set them up | server |
| cdnjs, jsDelivr | CesiumJS, Leaflet, the QR code library | browsers |

`data/` holds riders' names, emails (if given), rides with GPS-free virtual positions, photos and settings. Passwords are
scrypt hashes; sessions are random tokens in an HttpOnly cookie (30 days, sliding). Foreign-origin API writes are
refused.

## 21. Troubleshooting

- **Setup screen appears but nothing works** (no routes, buttons dead): a script failed to load. Behind a proxy, check
  its rate limit and its log for 4xx on `/js/` files; otherwise the browser console.
- **"No Bluetooth" / no ANT+ button**: not https, or not Chrome / Edge. On Windows, the ANT+ stick needs WinUSB (Zadig).
- **The trainer doesn't get harder**: another app has it (close Zwift, the Wahoo app...), or it's a power meter, not a
  smart trainer. The setup screen's **Test resistance** slider sends a raw slope.
- **Blurry or slow photo-real scenery**: ⚙ Advanced → Scenery type Lite, or Detail lower; `chrome://gpu` on a strong PC.
- **The road sits off the real road or floats**: the route editor (Find the road, nudges, Level), or report it and fix
  it later.
- **A route stays "queued"**: the route worker isn't running (see [section 1](#1-what-youre-running)); its log says why.
- **Reset emails don't arrive**: Brevo set up? Sender verified? **Send a test email**; Brevo's log shows each message.
- **Links in emails point to the wrong address**: set `PUBLIC_URL` in `.env` and restart.
- **The phone remote won't connect from mobile data**: the server isn't reachable from outside, or the proxy lacks
  WebSocket support.
- **Locked out**: `node tools/adduser.js <user> --reset`.

## 22. Command-line tools

| Command | What it does |
|---|---|
| `node tools/adduser.js <user> [--admin] [--name "Name"] [--reset]` | add an account or reset a password |
| `node tools/reports.mjs [n \| id]` | read problem reports |
| `tools/get-world.sh [id]` | list / install a ready-built open world |
| `node tools/openworld/make.mjs ...`, `rebuild.mjs <id>` | build an open world ([BUILDING-WORLDS.md](BUILDING-WORLDS.md)) |
| `node tools/openworld/rides.mjs <id> [--write]` | plan a world's pre-plotted rides |
| `node tools/pipeline/worker.mjs [--once <route id>]` | the route worker (normally started for you) |
| `node tools/routes/highlights.mjs ...` | make a highlights route from pieces of another |
| `node tools/routes/straighten-from-osm.mjs ...` | propose straight corrections along straight OSM roads |
| `blender -b --python tools/kit/<model>.py -- out.glb` | build a landmark model (Blender 4.x) |
| `node tests/unit.mjs` | unit tests |
