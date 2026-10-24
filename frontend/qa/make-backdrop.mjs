// EDMS-1 backdrop (Ram, 2026-10-14): Ram's illustration "Misty Sunrise Over a Temple Town" (master kept at
// diary/assets/edms-temple-town-2026-10-14.png) turned into the page files. The edges are faded into the alpha here —
// top into the sky, bottom below the water, right into the mist — so it melts into the ivory page with no CSS filter.
// node qa/make-backdrop.mjs [master.png]  → public/entry/temple-town-1200.webp, temple-town-1774.webp
import { createRequire } from 'module';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }

const SRC = process.argv[2] || path.resolve('../../diary/assets/edms-temple-town-2026-10-14.png');
const png = fs.readFileSync(SRC);
const b = await chromium.launch();
const page = await b.newPage();
await page.setContent('<body style="margin:0"></body>');
for (const width of [1200, 1774]) {
  const data = await page.evaluate(async ({ src, width }) => {
    const img = new Image(); img.src = src; await img.decode();
    const w = Math.min(width, img.naturalWidth), h = Math.round((img.naturalHeight * w) / img.naturalWidth);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    const v = g.createLinearGradient(0, 0, 0, h); // top: sky fades in; bottom: the water fades out
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.2, '#000'); v.addColorStop(0.8, '#000'); v.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
    const x = g.createLinearGradient(0, 0, w, 0); // right: into the mist, under the card's edge
    x.addColorStop(0, '#000'); x.addColorStop(0.74, '#000'); x.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = x; g.fillRect(0, 0, w, h);
    return c.toDataURL('image/webp', 0.8);
  }, { src: 'data:image/png;base64,' + png.toString('base64'), width });
  const out = `public/entry/temple-town-${width}.webp`;
  fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  console.log(out, Math.round(fs.statSync(out).size / 1024) + ' KB');
}
await b.close();
