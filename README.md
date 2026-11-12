# SKYTHREAD

A 3D web-swinging sandbox game that runs in the browser. The whole game ships as one
self-contained `index.html` - open it locally or host it anywhere static.

## Play

Open `index.html` in a browser, click to start.

| Input | Action |
| --- | --- |
| WASD | move / steer the swing |
| Mouse | look |
| Space | jump; hold in the air to swing |
| Left click (hold) | swing |
| F / right click | web-zip to the aimed point (roof edges launch you) |
| Shift | sprint / dive / wall-run |
| Q Z E R | front flip, backflip, corkscrew, 360 spin |
| X | restart |
| G | graphics quality (also auto-adjusts) |
| T | time of day (golden hour / midday / night) |
| M | sound on/off |
| H | toggle help |

## Develop

Game code lives in `src/` (`main.js` gameplay + rendering, `world.js` city generation,
`index.html` page shell + HUD). To rebuild the root `index.html` after editing:

```bash
npm install
npm run build
```

## Deploy

Static hosting, zero config. On Vercel: import the repo and deploy - `vercel.json`
tells it to serve the repo root with no build step (the built `index.html` is
committed). After editing source, run `npm run build` and commit the new `index.html`.
