const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    const filePath = url.pathname === '/' ? '/index.html' : url.pathname;

    const file = Bun.file(import.meta.dir + filePath);
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
