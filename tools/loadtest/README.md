# Load test

Fake riders against a **separate copy** of the server (never the live one: sessions live in its memory and
the test needs hundreds of accounts).

1. Copy the app without `data/` and `.git` to a scratch folder; give it `data/routes.json` with ~N/10 server routes
   (copies of one route, ids `lt-route-0...`) and their GPX files in `data/routes/`.
2. Write `data/users.json` (users `lt0...`) and `data/sessions.json` with a token each; save the tokens as
   `tokens.json` beside `load.js`.
3. `PORT=9443 node server.js &`, save its pid as `server.pid` beside `run.sh`.
4. `./run.sh 600 30`: 600 riders in rooms of 10, each sending its position 4 times a second, for 30 s.
   Prints state messages per rider per second (should be 4), their spacing (250 ms), the server's CPU and memory.
5. Delete the scratch copy afterwards (it holds a copy of `.env`).

`setup.sh <scratch dir> <riders>` does steps 1-3. `ROOM=100000 ./run.sh 1200 40` puts everyone in one room
(one shared world).

Results on the test server (2026-10-17, Dell T110 II, Node 22), rooms of 10 (before nearest-only updates):

| riders in groups | server CPU (one core) | memory | state spacing p99 | sent to riders |
|---|---|---|---|---|
| 100 | 14% | 103 MB | 257 ms | 6.5 KB/s each |
| 300 | 28% | 128 MB | 265 ms | 6.7 KB/s each |
| 600 | 48% | 182 MB | 268 ms | 6.9 KB/s each |
| 1200 | 67% | 255 MB | 269 ms | 7.2 KB/s each (8.6 MB/s in all) |

Riding solo (no group) costs the server almost nothing: scenery comes from Google, the page from here once.

One shared world (everyone on one route), 2026-10-17:

| riders | everyone-to-everyone (old) | nearest 40, named fields | nearest 40, compact rows (now) |
|---|---|---|---|
| 100 | 62 KB/s each, 22% CPU | 19 KB/s, 16% | 5 KB/s, 14% |
| 300 | 190 KB/s, 69% | | |
| 600 | 200 KB/s, 110%: overloaded, riders dropped | 19 KB/s, 62% | 5.2 KB/s, 53% |
| 1200 | | 19 KB/s, 92% | 5.2 KB/s, 81% |
| 1600 | | | 5.3 KB/s, 95% (8.4 MB/s in all) |

The load generator ran on the same machine, so the server's real headroom is a little better than shown.
