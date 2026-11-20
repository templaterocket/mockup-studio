// Dev-server API for the "Cases" panel: lists the personal site's case screenshots,
// serves them, and saves per-shot settings to source-images/mock/shots.json, which
// tools/mock-cases.mjs reads when it renders.
import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SITE = process.env.CASES_SITE || path.join(os.homedir(), 'DNP/personal-site');
const MOCK = path.join(SITE, 'source-images/mock');
const SHOTS = path.join(MOCK, 'shots.json');
const NAME = /^[\w-]+$/;

const readShots = () => (fs.existsSync(SHOTS) ? JSON.parse(fs.readFileSync(SHOTS, 'utf8')) : {});
const meshVars = () => {
  const css = fs.readFileSync(path.join(SITE, 'styles.css'), 'utf8');
  const out = {};
  for (const m of css.matchAll(/\.mesh-([\w-]+)\s*\{([^}]*)\}/g)) {
    out[m[1]] = Object.fromEntries([...m[2].matchAll(/--(\w+):\s*(#[0-9a-fA-F]{6}|\d+(?:\.\d+)?% \d+(?:\.\d+)?%)/g)].map((x) => [x[1], x[2]]));
  }
  return out;
};
const body = (req) => new Promise((res, rej) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { res(JSON.parse(d || '{}')); } catch (e) { rej(e); } }); });
const json = (res, data, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); };

function casesApi() {
  return {
    name: 'cases-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/cases')) return next();
        try {
          const url = new URL(req.url, 'http://x');
          if (req.method === 'GET' && url.pathname === '/api/cases') {
            const plan = JSON.parse(execFileSync('node', [path.join(SITE, 'tools/mock-cases.mjs'), '--plan'], { cwd: SITE }).toString());
            return json(res, { site: SITE, mesh: meshVars(), shots: plan });
          }
          const m = url.pathname.match(/^\/api\/cases\/screen\/([\w-]+)\/([\w-]+\.png)$/);
          if (req.method === 'GET' && m) {
            res.setHeader('content-type', 'image/png');
            res.setHeader('cache-control', 'no-store');
            return fs.createReadStream(path.join(MOCK, m[1], m[2])).pipe(res);
          }
          if (req.method === 'POST' && url.pathname === '/api/cases/mesh') {
            // Skybox tab: the case's mesh colours, written into the site's styles.css
            const b = await body(req);
            const HEX = /^#[0-9a-fA-F]{6}$/;
            if (!NAME.test(b.slug || '') || !['g1', 'g2', 'b1', 'b2'].every((k) => HEX.test(b[k] || ''))) return json(res, { error: 'bad slug/colours' }, 400);
            const file = path.join(SITE, 'styles.css');
            let css = fs.readFileSync(file, 'utf8');
            const PT = /^\d{1,3}% \d{1,3}%$/;
            if ((b.p1 && !PT.test(b.p1)) || (b.p2 && !PT.test(b.p2))) return json(res, { error: 'bad glow position' }, 400);
            // glow positions only when moved off the defaults, so most lines stay short
            const pos = (b.p1 && b.p1 !== '72% 38%' ? ` --p1: ${b.p1};` : '') + (b.p2 && b.p2 !== '22% 82%' ? ` --p2: ${b.p2};` : '');
            const line = `.mesh-${b.slug} { --g1: ${b.g1}; --g2: ${b.g2}; --b1: ${b.b1}; --b2: ${b.b2};${pos} }`;
            const re = new RegExp(`^\\.mesh-${b.slug}\\s*\\{[^}]*\\}`, 'm');
            if (re.test(css)) css = css.replace(re, line);
            else {
              const last = [...css.matchAll(/^\.mesh-[\w-]+\s*\{[^}]*\}$/gm)].pop();
              css = last ? css.slice(0, last.index + last[0].length) + '\n' + line + css.slice(last.index + last[0].length) : css + '\n' + line + '\n';
            }
            fs.writeFileSync(file, css);
            return json(res, { ok: true });
          }
          if (req.method === 'POST' && url.pathname === '/api/cases/hide') {
            // hidden slides are left off the case page and not rendered (build-work / mock-cases)
            const b = await body(req);
            if (!NAME.test(b.slug || '') || !NAME.test(b.key || '') || b.key === 'hero') return json(res, { error: 'bad slug/key' }, 400);
            const shots = readShots();
            const e = ((shots[b.slug] ??= {})[b.key] ??= {});
            if (b.hidden) e.hidden = true; else delete e.hidden;
            if (!Object.keys(e).length) delete shots[b.slug][b.key];
            if (!Object.keys(shots[b.slug]).length) delete shots[b.slug];
            fs.writeFileSync(SHOTS, JSON.stringify(shots, null, 1));
            return json(res, { ok: true });
          }
          if (req.method === 'POST' && (url.pathname === '/api/cases/save' || url.pathname === '/api/cases/reset')) {
            const b = await body(req);
            if (!NAME.test(b.slug || '') || !NAME.test(b.key || '')) return json(res, { error: 'bad slug/key' }, 400);
            const shots = readShots();
            if (url.pathname.endsWith('/save')) {
              const hidden = shots[b.slug]?.[b.key]?.hidden;
              (shots[b.slug] ??= {})[b.key] = { device: b.device, aspect: b.aspect, state: b.state, savedAt: new Date().toISOString(), ...(hidden ? { hidden } : {}) };
            } else if (shots[b.slug]?.[b.key]) {
              const hidden = shots[b.slug][b.key].hidden;
              if (hidden) shots[b.slug][b.key] = { hidden }; else delete shots[b.slug][b.key];
              if (!Object.keys(shots[b.slug]).length) delete shots[b.slug];
            }
            fs.writeFileSync(SHOTS, JSON.stringify(shots, null, 1));
            return json(res, { ok: true });
          }
          json(res, { error: 'not found' }, 404);
        } catch (e) {
          json(res, { error: String(e.message || e) }, 500);
        }
      });
    },
  };
}

export default defineConfig({ plugins: [casesApi()] });
