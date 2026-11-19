# SKYTHREAD

A 3D web-swinging sandbox game that runs in the browser. The whole game ships as one
self-contained `index.html` - open it locally or host it anywhere static.

The city is Manhattan at its real size: an island 3.5 km across and 21 km long, laid out
on the real grid (blocks 250 m by 80 m, twenty streets to the mile, 14 avenues, about
2,800 blocks), with the Financial District and Midtown skyscraper clusters, a full-size
Central Park, suspension bridges over the East River, the great span over the Hudson,
low bridges over the Harlem River, a harbor with an island and a statue, and the outer
boroughs on every side. Streets carry signal-controlled traffic (sedans, taxis, SUVs,
vans, trucks, buses, parked cars); people walk the sidewalks, cross with the lights and
jaywalk through stopped traffic.

The skyline for the whole island is built once at start-up; street-level detail (trees,
lamps, street furniture, rooftop clutter, shop light) is generated around you as you
move and released behind you, so the city never ends but only the part near you is held
in memory. Every block is seeded from its own grid position, so it is always the same
block. Buildings draw from 22 facade styles with their own bay widths, tints, blinds and
lit windows; billboards and lettered rooftop signs carry invented brands.

Four shops can be entered on foot (a bodega, a pizzeria, a coffee shop and a camera
shop), each with its own interior and staff, and a short seven-step story, LAST ORDERS,
runs between them. The map (M) lifts the camera to a tilted view of the real city, with
shops, the story objective and time trials; a trial's route is drawn once you pick it.

Rendering: haze that thins with height and glows toward the sun, a soft cloud layer in
the sky, contact shadows where buildings meet the pavement, and a final grading pass
with speed streaks at the edge of the frame. Every facade carries relief worked out from
its own paint (panes set back, frames proud, joints cut in), weathers in world space so
no two walls match, and has a room behind each pane that shifts with your view. Roads
are lit with relief on better hardware, and shadows reach further down the avenue.

Everything is generated in code - there are no model, texture or audio files; sound is
synthesised with the Web Audio API.

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
| Q Z E R | front flip, backflip, corkscrew, 360 spin (in the air) |
| E | on foot: enter a shop, talk, pick things up |
| X | restart |
| G | graphics quality (auto-tunes toward 100 FPS until you change it) |
| T | time of day (golden hour / midday / night) |
| M | city map: drag to move, scroll to zoom (out to the whole island); click a time trial (or 1-4) to see its route, click again or Enter to start |
| K | switch suit trim (after finishing the story) |
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
