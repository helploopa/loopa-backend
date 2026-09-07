import { Router, Request, Response } from 'express';
import type { Express } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createInternalApiClient } from './internalApiClient';
import { registerBusinessTools } from './tools';

const METHOD_NOT_ALLOWED = {
  jsonrpc: '2.0' as const,
  error: { code: -32000, message: 'Method not allowed.' },
  id: null,
};

/**
 * Mounts a stateless MCP (Streamable HTTP) endpoint exposing the business-onboarding
 * tools. A fresh McpServer + transport is created per request (no session/state kept
 * across requests), which fits Vercel's serverless request/response model.
 */
export function createMcpRouter(app: Express): Router {
  const router = Router();
  const callInternalApi = createInternalApiClient(app);

  router.post('/', async (req: Request, res: Response): Promise<void> => {
    const server = new McpServer({ name: 'loopa-business-mcp', version: '1.0.0' });
    registerBusinessTools(server, callInternalApi);

    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // Stateless mode has no session to resume (GET) or terminate (DELETE).
  router.get('/', (_req: Request, res: Response) => {
    res.status(405).json(METHOD_NOT_ALLOWED);
  });

  router.delete('/', (_req: Request, res: Response) => {
    res.status(405).json(METHOD_NOT_ALLOWED);
  });

  return router;
}
