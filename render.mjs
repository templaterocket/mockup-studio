#!/usr/bin/env node
// Headless render for AI agents:
//   node render.mjs --screen shot.png --out out.png --device iphone16pro --width 2400 \
//        --state '{"camera":{"azimuth":-30,"focal":85},"blur":{"maxBlur":0.08}}'
//   node render.mjs --config preset.json --screen shot.png --out out.png
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] == null ? 'true' : arr[i + 1]]] : a), []));
if (args.help || (!args.out && !args.jobs)) {
  console.log(`usage: node render.mjs --jobs jobs.json   (array of {screen, out, width?, aspect?, device?, transparent?, state?}; one browser for all)
       node render.mjs --out out.png [--screen image.png] [--device id] [--width 2400] [--aspect 4:3]
                     [--config preset.json] [--state '{json partial state}'] [--transparent]
devices: iphone16pro, ipadpro, studiodisplay, proxdr`);
  process.exit(args.help ? 0 : 1);
}
const root = path.dirname(fileURLToPath(import.meta.url));
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(url + '?render=1'); // ?render=1: no Cases panel, it would swap in its own screen
await page.waitForFunction(() => window.mockup);
await page.evaluate(() => window.mockup.ready);

const loadState = async (s) => { await page.evaluate((s) => window.mockup.setState(s), s); await page.evaluate(() => window.mockup.ready); await page.evaluate(() => window.mockup.settled()); };
const loadScreen = async (file) => {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg');
  await page.evaluate((d) => window.mockup.loadScreenData(d), `data:image/${ext};base64,${buf.toString('base64')}`);
};
const base = await page.evaluate(() => window.mockup.getState());
let preset = {};
if (args.config) preset = JSON.parse(fs.readFileSync(args.config, 'utf8'));

const jobs = args.jobs ? JSON.parse(fs.readFileSync(args.jobs, 'utf8')) : [{
  screen: args.screen, out: args.out, width: args.width && +args.width, aspect: args.aspect, device: args.device,
  transparent: !!args.transparent, state: args.state ? JSON.parse(args.state) : {},
}];
for (const j of jobs) {
  // every job starts from the defaults (+ --config), so jobs never leak settings into each other
  const st = { ...structuredClone(base), ...preset, ...(j.state || {}) };
  for (const k of ['camera', 'blur', 'scene', 'screen']) st[k] = { ...base[k], ...(preset[k] || {}), ...(j.state?.[k] || {}) };
  if (j.device) st.device = j.device;
  if (j.aspect) st.aspect = j.aspect;
  if (j.transparent) st.scene = { ...(st.scene || {}), transparent: true };
  await loadState(st);
  if (j.screen) await loadScreen(j.screen);
  await page.waitForTimeout(300);
  if (process.env.DBG) console.log(JSON.stringify(await page.evaluate(() => { const s = window.mockup.getState(); return { cam: s.camera, dev: s.device, aspect: s.aspect, fov: window.__cam?.fov }; })));
  const dataUrl = await page.evaluate((w) => window.mockup.exportPNG(w), j.width || undefined);
  fs.mkdirSync(path.dirname(j.out), { recursive: true });
  fs.writeFileSync(j.out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('saved', j.out);
}
await browser.close();
await server.close();
