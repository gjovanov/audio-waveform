import { join, normalize, sep } from 'path';

const ROOT = import.meta.dir;

const server = Bun.serve({
  port: parseInt(process.env.PORT || '3000'),
  async fetch(req) {
    const url = new URL(req.url);
    const safePath = normalize(decodeURIComponent(url.pathname));
    const filePath = join(ROOT, safePath === '/' ? '/index.html' : safePath);

    // Prevent path traversal outside project root
    if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
      return new Response('Forbidden', { status: 403 });
    }

    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return new Response('Not found', { status: 404 });
    }

    return new Response(file, {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    });
  },
});

console.log(`Server running at http://localhost:${server.port}`);
console.log('COOP/COEP headers enabled for SharedArrayBuffer support');
