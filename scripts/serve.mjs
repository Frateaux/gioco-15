/**
 * Zero-dependency local & LAN static server for testing the Gioco del 15 PWA on smartphones.
 * Usage: node scripts/serve.mjs [port]
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2]) || 8765;
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
    try {
        const reqPath = (req.url || '/').split('?')[0];
        const safeRel = path.normalize(reqPath === '/' ? '/index.html' : reqPath).replace(/^(\.\.[/\\])+/, '');
        const filePath = path.join(ROOT_DIR, safeRel);

        if (!filePath.startsWith(ROOT_DIR)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        const data = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
        });
        res.end(data);
    } catch (_) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Gioco del 15 PWA server listening on:`);
    console.log(`  Local:   http://127.0.0.1:${PORT}/index.html`);
    const nets = os.networkInterfaces();
    for (const iface of Object.values(nets)) {
        for (const addr of iface || []) {
            if (addr.family === 'IPv4' && !addr.internal) {
                console.log(`  LAN:     http://${addr.address}:${PORT}/index.html`);
            }
        }
    }
});
