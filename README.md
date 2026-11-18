# SKYTHREAD

A 3D web-swinging sandbox game that runs in the browser. The whole game ships as one
self-contained `index.html` - open it locally or host it anywhere static.

The city is a compressed take on Manhattan: a long island with wide one-way avenues and
narrow cross streets, a Downtown and a Midtown skyscraper cluster (towers up to ~540 m),
brick districts between them, a big central park, two suspension bridges and outer
boroughs across the rivers. Streets carry signal-controlled traffic (sedans, taxis, SUVs,
vans, trucks, buses, parked cars) and crowds on the sidewalks. Everything is generated in
code - there are no model or audio files; sound is synthesised with the Web Audio API.

## Play

Open `index.html` in a browser, click to start.

| Input | Action |
| --- | --- |
| WASD | move / steer the swing |
| Mouse | look |
| Space | jump; hold to swing (keep holding to chain swings, vault roofs and run up walls) |
| Left click (hold) | swing |
| F / right click | slingshot: haul yourself toward the reticle and fly on past it |
| Shift | sprint / dive / wall-run |
| Walls | let go of swing and steer into a wall to stick and climb |
| Q Z E R | front flip, backflip, corkscrew, 360 spin |
| X | restart |
| G | graphics quality (auto-tunes toward 100 FPS until you change it) |
| T | time of day (golden hour / midday / night) |
| M | city map and time trials (pick one with a click or 1-4) |
| N | mute |
| H | toggle help |

## Develop

Game code lives in `src/`: `main.js` (gameplay, camera, rendering, sound), `world.js`
(city generation), `life.js` (traffic, pedestrians, birds, steam), `hero.js` (the
character model) and `index.html` (page shell + HUD). Add `?q=0`..`?q=4` to the URL to
lock a graphics level. To rebuild the root `index.html` after editing:

```bash
npm install
npm run build
```

## Deploy

Static hosting, zero config. On Vercel: import the repo and deploy - `vercel.json`
tells it to serve the repo root with no build step (the built `index.html` is
committed). After editing source, run `npm run build` and commit the new `index.html`.
