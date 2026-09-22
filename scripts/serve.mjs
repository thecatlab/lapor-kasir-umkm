import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Only serve browser assets, never the repository, private files, or .git.
const root = new URL('../', import.meta.url);
const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/config.js', ['config.js', 'text/javascript; charset=utf-8']],
    ['/assets/styles.css', ['assets/styles.css', 'text/css; charset=utf-8']]
]);
const port = Number(process.env.PORT || 8000);
const server = http.createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405).end();
        return;
    }
    const entry = files.get(new URL(request.url, 'http://localhost').pathname);
    if (!entry) {
        response.writeHead(404).end('Not found');
        return;
    }
    try {
        let content;
        try {
            content = await readFile(new URL(entry[0], root));
        } catch (error) {
            if (entry[0] !== 'config.js' || error.code !== 'ENOENT') throw error;
            content = 'window.LAPORKASIR_CONFIG = { googleScriptUrl: "" };';
        }
        response.writeHead(200, {
            'Content-Type': entry[1],
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
            'X-Frame-Options': 'DENY'
        });
        response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
        response.writeHead(500).end('Unable to serve this file');
    }
});
server.listen(port, '127.0.0.1', () => {
    console.log('LaporKasir: http://127.0.0.1:' + port);
    console.log('Serving browser assets from ' + fileURLToPath(root));
});
