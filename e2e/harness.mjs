// Boots the real FixTrack Worker in Miniflare with a migrated, seeded D1
// database, and serves the built SPA alongside it so Playwright drives the
// actual application instead of a mock.
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DIST = join(ROOT, 'frontend/dist');
const PORT = Number(process.env.PORT ?? 4175);
const TOKEN = 'e2e-approval-token-0123456789abcdef';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const directory = await mkdtemp(join(tmpdir(), 'fixtrack-e2e-'));
await build({
  entryPoints: [join(ROOT, 'src/index.ts')],
  outfile: join(directory, 'worker.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
});

const mf = new Miniflare({
  modules: true,
  script: await readFile(join(directory, 'worker.mjs'), 'utf8'),
  compatibilityDate: '2026-06-11',
  d1Databases: { DB: 'e2e' },
  r2Buckets: { ATTACHMENTS: 'fixtrack-e2e-attachments' },
  bindings: { AUTH_DEV_LINKS: 'true' },
  log: new Log(LogLevel.NONE),
});

const db = await mf.getD1Database('DB');
for (const file of (await readdir(join(ROOT, 'migrations'))).filter((n) => n.endsWith('.sql')).sort()) {
  const sql = await readFile(join(ROOT, 'migrations', file), 'utf8');
  await db.batch(sql.split(';').map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s)));
}

const now = Math.floor(Date.now() / 1000);
await db.batch([
  db.prepare("INSERT INTO workspaces (id,name,phone,location,address,payment_instructions) VALUES ('ws-e2e','Sample Repair Shop','0700000001','Nairobi','12 Sample Street','Pay by M-Pesa to 0700000001')"),
  db.prepare("INSERT INTO customers (id,workspace_id,name,phone) VALUES ('cus-e2e','ws-e2e','Sample Customer','0700000002')"),
  db.prepare(`INSERT INTO repair_jobs (id,workspace_id,customer_id,job_number,device_category,device_model,fault_description,status,created_at)
              VALUES ('job-e2e','ws-e2e','cus-e2e','FT-1001','Laptop','Sample ThinkPad T14','Sample diagnostic request for the end-to-end suite.','in_repair',${now})`),
  db.prepare(`INSERT INTO quotes (id,job_id,workspace_id,version,total_amount,required_deposit,approval_token,status,terms,created_at)
              VALUES ('quote-e2e','job-e2e','ws-e2e',1,4500,1000,'${TOKEN}','sent','Sample repair terms for the end-to-end suite.',${now})`),
  db.prepare("INSERT INTO quote_items (id,quote_id,description,quantity,unit_price) VALUES ('qi-1','quote-e2e','Sample part',1,3500)"),
  db.prepare("INSERT INTO quote_items (id,quote_id,description,quantity,unit_price) VALUES ('qi-2','quote-e2e','Sample labour',1,1000)"),
]);

async function serveStatic(pathname, res) {
  const candidates = pathname === '/' ? ['index.html'] : [pathname.replace(/^\/+/, ''), 'index.html'];
  for (const relative of candidates) {
    try {
      const body = await readFile(join(DIST, relative));
      res.writeHead(200, { 'content-type': TYPES[extname(relative)] ?? 'application/octet-stream' });
      res.end(body);
      return true;
    } catch {
      // try the next candidate (SPA fallback)
    }
  }
  return false;
}

const server = createServer(async (req, res) => {
  const pathname = (req.url ?? '/').split('?')[0];
  if (!pathname.startsWith('/api/')) {
    if (await serveStatic(pathname, res)) return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const response = await mf.dispatchFetch(`http://127.0.0.1:${PORT}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body,
  });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(PORT, '127.0.0.1', () => console.log(`fixtrack e2e harness on http://127.0.0.1:${PORT}`));

const shutdown = async () => {
  server.close();
  await mf.dispose();
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
