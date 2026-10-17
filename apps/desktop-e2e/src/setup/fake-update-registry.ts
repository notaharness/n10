import { createServer, type IncomingHttpHeaders } from 'node:http';
import { once } from 'node:events';

/** Real HTTP, bound only to loopback; every request is observable by the test. */
export async function fakeUpdateRegistry() {
  const scenario = {
    status: 200,
    body: JSON.stringify({ beta: '1.0.0-beta.10', latest: '1.0.0-beta.10' }),
    headers: {} as Record<string, string>,
  };
  const requests: { url?: string; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    res.writeHead(scenario.status, {
      'content-type': 'application/json',
      ...scenario.headers,
    });
    res.end(scenario.body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No fixture port');
  return {
    scenario,
    requests,
    url: `http://127.0.0.1:${address.port}/dist-tags`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
