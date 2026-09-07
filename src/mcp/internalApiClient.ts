import http from 'http';
import type { AddressInfo } from 'net';
import type { Express } from 'express';

export interface InternalApiResult {
  status: number;
  body: unknown;
}

export type InternalApiCaller = (method: string, path: string, body?: unknown) => Promise<InternalApiResult>;

/**
 * Builds a caller that drives the given Express app over a real loopback HTTP
 * connection (127.0.0.1-only, never exposed publicly). This lets MCP tools reuse
 * the exact same route handlers, validation, and auth as the public REST API —
 * including the ADMIN_API_KEY check — instead of duplicating business logic.
 * The listener is started lazily on first use and reused for the life of the process.
 */
export function createInternalApiClient(app: Express): InternalApiCaller {
  let portPromise: Promise<number> | null = null;

  function getPort(): Promise<number> {
    if (!portPromise) {
      portPromise = new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
          resolve((server.address() as AddressInfo).port);
        });
        server.unref();
        server.on('error', reject);
      });
    }
    return portPromise;
  }

  return async function callInternalApi(method, path, body) {
    const port = await getPort();
    const data = body !== undefined ? JSON.stringify(body) : undefined;

    return new Promise<InternalApiResult>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method,
          path,
          headers: {
            'content-type': 'application/json',
            ...(process.env.ADMIN_API_KEY ? { 'x-api-key': process.env.ADMIN_API_KEY } : {}),
            ...(data ? { 'content-length': Buffer.byteLength(data) } : {}),
          },
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            let parsedBody: unknown;
            if (raw) {
              try {
                parsedBody = JSON.parse(raw);
              } catch {
                parsedBody = raw;
              }
            }
            resolve({ status: res.statusCode ?? 500, body: parsedBody });
          });
        },
      );
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  };
}
