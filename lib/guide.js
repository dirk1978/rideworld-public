// The riders' guide (2026-11-18, the owner: "a really easy to read general tips and tricks email ... how to connect stuff,
// how to send reports, what hardware it will / won't / might work with ... views, the coach ... a list of all the other
// features ... very simple English, nothing technical"). One copy, used by the tips email (tools/mail-tips.js) and the
// welcome email for new riders (lib/mail.js welcome). Keep it plain: short sentences, no jargon. Update it when the
// app changes.
//
// Each section: { title, intro?, items?: [[bold, rest]] or [text], outro? }. `{site}` is replaced with the address.
const SECTIONS = [
  {
    title: '💻 What you need',
    items: [
      ['A computer with Chrome or Microsoft Edge.', 'This is the best way to ride. Windows, Mac and Chromebook all work.'],
      ['An Android phone or tablet with Chrome', 'works too, and runs surprisingly well.'],
      ['iPhone and iPad:', 'Apple doesn\'t let normal browsers talk to trainers. The free Bluefy browser from the App Store can, but it\'s still being tested.'],
      ['Firefox and Safari', 'won\'t connect to your trainer, so please use Chrome or Edge.'],
    ],
  },
  {
    title: '🚲 Will my trainer work?',
    intro: 'RideWorld talks to your kit the same way Zwift does. If your trainer works with Zwift over Bluetooth, it will almost certainly work here.',
    items: [
      ['✅ Works:', 'smart trainers that change how hard it feels by themselves. Tested on the Wahoo KICKR CORE. Other smart trainers from Wahoo, Tacx, Elite, Saris, JetBlack and the Zwift Hub should work too.'],
      ['✅ Works:', 'heart-rate straps (Polar, Garmin, Wahoo, COROS and others). Many Garmin watches can send your heart rate too: look for "broadcast heart rate" in the watch\'s settings.'],
      ['✅ Works:', 'power meter pedals or cranks on your own bike. You\'ll see your real power, but the trainer won\'t get harder on hills unless it\'s a smart trainer.'],
      ['✅ Works:', 'a Garmin ANT+ USB stick in your computer. It needs a one-off set-up on Windows: there\'s a short video showing how, next to the ANT+ button on the setup screen. Most people just use Bluetooth instead.'],
      ['🤔 Might work:', 'smart bikes (Stages, Wattbike, Wahoo KICKR BIKE and similar). They use the same Bluetooth language as smart trainers, but haven\'t all been tried yet. Please tell me how you get on.'],
      ['🤔 Might work:', 'the Zwift Cog. Turn on Virtual gears in ⚙ Advanced and change gear with [ and ] on the keyboard or the + and − Gear buttons on screen. The Zwift Click buttons don\'t work yet.'],
      ['❌ Won\'t work:', 'old trainers with no power meter and no smart control. RideWorld can\'t measure how hard you\'re pushing. You can still try everything with the Simulator button.'],
      ['❌ Won\'t work:', 'Peloton bikes, and the heart rate from an Apple Watch (it doesn\'t share it with other apps).'],
    ],
    outro: 'Only one app can control a trainer at a time. Close Zwift, TrainerRoad, the Wahoo app and so on before you connect.',
  },
  {
    title: '🔌 Connecting your kit',
    items: [
      ['Wake everything up first:', 'pedal for a few seconds and put your heart-rate strap on (a damp strap works best).'],
      ['On the setup screen, go to Sensors', 'and press "Add a Bluetooth device".'],
      ['Chrome shows a list.', 'Pick your trainer and press Pair. Do the same again for your heart-rate strap.'],
      ['A green tick (✓)', 'means it\'s connected. You can check how the trainer feels with the "Test resistance" slider.'],
      ['Next time', 'RideWorld tries to reconnect by itself. If it doesn\'t, just add the device again.'],
      ['Stuck?', 'Turn Bluetooth off and on again, close any other cycling apps, and pedal to wake the trainer.'],
    ],
  },
  {
    title: '🎨 Three ways to ride',
    intro: 'At the top of the setup screen there are three big buttons. Each one gives RideWorld its own colour:',
    items: [
      ['🗺 Open world (yellow):', 'ride anywhere on a big map (Bromsgrove, Central London, Stratford). You choose your turns as you go, or use the satnav.'],
      ['〰 Routes (blue):', 'classic rides from start to finish, like Brighton, Bristol, Paris and Flanders.'],
      ['📷 Photoreal (red):', 'famous mountain roads (Alpe d\'Huez, Stelvio, Sa Calobra and more) in Google\'s real 3D world. These need a fairly good computer.'],
    ],
  },
  {
    title: '▶️ Riding',
    items: [
      ['Just start pedalling.', 'The ride begins by itself.'],
      ['Space bar', 'pauses and carries on. Esc opens your settings in the middle of a ride.'],
      ['🏁 Finish', 'ends the ride whenever you like. Then you can save it and send it to Strava.'],
      ['At the end of a route', 'you turn round and keep riding. A box asks if you want to finish or keep going.'],
      ['Hills too hard or too easy?', 'Change "Trainer difficulty" in ⚙ Advanced. 50% is normal, like Zwift\'s default.'],
      ['No trainer handy?', 'Press Simulator and use the ↑ and ↓ keys to set your power.'],
    ],
  },
  {
    title: '🗺 Open world tips',
    items: [
      ['Coming up to a junction,', 'a small map of it appears at the top. The pink road is the way you\'ll go.'],
      ['Press ← or → to pick another road', '(or tap it on the little map). You can do this before the map shows up, too.'],
      ['Press U to turn round', 'at any time.'],
      ['🧭 Go to… (or the / key)', 'opens the satnav. Search for a place, a street or a pub, or click anywhere on the map. Then choose "Ride there" (the turns are done for you) or "Jump there" (you\'re there instantly). The ride pauses while you choose.'],
    ],
  },
  {
    title: '🎥 Camera views',
    intro: 'Press C (or the camera button) to step through the views. Keep pressing past the last one and it starts a slideshow that changes view every 30 seconds.',
    items: [
      ['Default, Chase and High chase:', 'behind you, close or higher up.'],
      ['Rear 45° and Drone:', 'from the side and from above.'],
      ['Rider:', 'through your own eyes.'],
      ['Free:', 'drag with the mouse to move the camera around you, and scroll to zoom. Double-click puts it back.'],
      ['Orbit, Sweep and Fly-by:', 'film-style shots, great for videos. Press F for film mode, which hides everything on screen.'],
    ],
  },
  {
    title: '🧑‍🏫 The coach',
    intro: 'The coach learns from your RideWorld rides. Give it a few rides and it gets better.',
    items: [
      ['Before you ride,', 'the Coach section shows how fit you are, how tired you are, and whether you\'re fresh or need a rest. It also suggests a workout and a route for today.'],
      ['While you ride,', 'short tips fade in and out: warm up, a climb coming up, time to eat and drink, a new personal best.'],
      ['When you finish,', 'it tells you how hard the ride was. If you\'ve got stronger it can raise your FTP for you (or ask first: you choose in Rider & kit).'],
      ['Don\'t want it?', 'Turn it off in Rider & kit: Virtual coach Off.'],
    ],
  },
  {
    title: '📱 Your phone as a remote',
    intro: 'Open {site}/rc on your phone (or scan the QR code on the setup screen) and keep it on your bars. It works on the same Wi-Fi or on mobile data.',
    items: [
      'Start and pause, change camera, take photos, record short video clips.',
      'Choose your way at junctions in the open world, and turn round.',
      'Make a workout easier or harder, skip songs, and see your power, heart rate and speed.',
    ],
  },
  {
    title: '⚑ Found a problem? Please tell me!',
    intro: 'Reports are the most useful thing you can send. They show me exactly what you saw and where.',
    items: [
      ['Press R during a ride', '(or ⋯ then "Report a problem here", or ☰ on a phone).'],
      ['Type a few words', 'about what\'s wrong, like "riding through a hedge here" or "this turn went the wrong way", and press Send.'],
      ['That\'s it.', 'It sends me a picture of your screen and the exact spot. The ride pauses while you type.'],
      ['Anything else,', 'just reply to this email.'],
    ],
  },
  {
    title: '✨ Everything else you can do',
    items: [
      ['Workouts:', '15 ready-made sessions, or bring your own Zwift workout files. ERG mode holds your power for you.'],
      ['Pacers and ghosts:', 'riders to ride with at a power you choose, and a see-through ghost of your own best time.'],
      ['Ride with friends:', 'group rides with a start time, or just drop in and see whoever is riding the same route. Press H to give someone a 🎩 chapeau.'],
      ['Drafting:', 'tuck in behind another rider and it gets easier, just like outside.'],
      ['Segments and leaderboards:', 'timed climbs and sprints, with your best times and everyone else\'s.'],
      ['Strava:', 'at the end of a ride save the .fit file and drag it onto strava.com/upload. It shows up as a Virtual Ride. (Sending it straight to Strava is coming: Strava only lets a few people connect a new app until they\'ve checked it.)'],
      ['Photos and videos:', 'press P for a photo. RideWorld also takes a few photos for you on each ride. Press V to record a short clip.'],
      ['My rides:', 'every ride you\'ve done, with downloads and a page you can share.'],
      ['Your look:', 'jerseys (including Tour de France and national champion kits), bikes, skin colour and beards.'],
      ['Music:', 'paste a YouTube or YouTube Music link and control it from the ride.'],
      ['Your own routes:', 'plan one on the map, or load a file from Strava, Komoot, RideWithGPS or Garmin.'],
      ['Weekly goal:', 'set a target and keep a streak going.'],
      ['On screen:', 'choose what shows over the ride, separately for your phone and your computer.'],
    ],
  },
  {
    title: '⌨️ Handy keys',
    items: [
      'Space: pause · Esc: settings · C: camera · F: film mode · P: photo · V: video clip · R: report a problem',
      'H: chapeau · M: music on/off · N: next song · − and =: workout easier / harder',
      'Open world: ← → choose a road · U: turn round · /: satnav',
      'Simulator: ↑ and ↓ (or W and S) set your power · [ and ]: change gear (Virtual gears)',
    ],
  },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fill = (s, site) => String(s).replace(/\{site\}/g, site);

function text(site) {
  return SECTIONS.map((s) => {
    const lines = [s.title.replace(/^\S+\s/, '').toUpperCase()];
    if (s.intro) lines.push(fill(s.intro, site));
    for (const it of s.items || []) lines.push('- ' + (Array.isArray(it) ? `${it[0]} ${it[1]}` : fill(it, site)));
    if (s.outro) lines.push(fill(s.outro, site));
    return lines.join('\n');
  }).join('\n\n');
}

// accent: the heading colour
function html(site, accent = '#d9480f') {
  const h = (t) => `<h3 style="margin:30px 0 8px;font-size:17px;color:${accent}">${esc(t)}</h3>`;
  const p = (t) => `<p style="margin:0 0 10px">${esc(fill(t, site))}</p>`;
  return SECTIONS.map((s) => h(s.title) + (s.intro ? p(s.intro) : '')
    + (s.items ? `<ul style="padding-left:20px;margin:0 0 10px">${s.items.map((it) => `<li style="margin-bottom:7px">${Array.isArray(it) ? `<strong>${esc(it[0])}</strong> ${esc(fill(it[1], site))}` : esc(fill(it, site))}</li>`).join('')}</ul>` : '')
    + (s.outro ? `<p style="margin:0 0 10px;background:#fff6ef;border-radius:8px;padding:8px 12px">${esc(fill(s.outro, site))}</p>` : '')).join('');
}

module.exports = { SECTIONS, text, html };
