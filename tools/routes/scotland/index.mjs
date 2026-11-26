// Rebuilds tiles.json, the list of Scotland's LIDAR terrain tiles (Scottish Remote Sensing Portal's public S3 bucket),
// grouped by survey, newest first: node tools/routes/scotland/index.mjs
import fs from 'fs';
import path from 'path';
const B = 'https://srsp-open-data.s3.eu-west-2.amazonaws.com';
// newest / finest first: where two surveys cover a spot, the first with a height there is used
const SURVEYS = ['national-lidar-programme', 'phase-6', 'phase-5', 'phase-4', 'phase-3', 'orkney-islands-council-23', 'phase-2', 'phase-1'];
const out = [];
for (const s of SURVEYS) {
  const names = [];
  let pattern = null;
  for (let token = ''; ;) {
    const x = await (await fetch(`${B}/?list-type=2&prefix=lidar/${s}/dtm/${token ? '&continuation-token=' + encodeURIComponent(token) : ''}`)).text();
    for (const [, key] of x.matchAll(/<Key>([^<]+\.tif)<\/Key>/g)) {
      const m = key.match(/^(.*\/)([A-Z]{2}\d+(?:[NS][EW])?)(_[^/]+\.tif)$/);
      if (!m) continue;
      pattern ||= m[1] + '{}' + m[3];
      if (m[1] + '{}' + m[3] === pattern) names.push(m[2]);
    }
    token = (x.match(/<NextContinuationToken>([^<]+)/) || [])[1];
    if (!token) break;
  }
  out.push({ survey: s, pattern, names });
  console.log(s, names.length);
}
fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'tiles.json'), JSON.stringify(out));
