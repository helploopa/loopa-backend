import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { isRevoked } from './tokenBlocklist';

const JWT_SECRET = process.env.JWT_SECRET || 'development-mock-secret';

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

export const authenticateToken = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Unauthorized: No token provided' });
    return;
  }

  if (isRevoked(token)) {
    res.status(401).json({ error: 'Unauthorized: Token has been revoked' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Forbidden: Invalid or expired token' });
  }
};

export const authenticateApiKey = (req: Request, res: Response, next: NextFunction): void => {
  const key = req.headers['x-api-key'] as string | undefined;
  const validKey = process.env.ADMIN_API_KEY;
  if (!validKey || key !== validKey) {
    res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    return;
  }
  next();
};

/** Accepts either an API key (x-api-key header) or a Bearer JWT. Sets req.user.isApiKey=true for API key auth. */
export const authenticateApiKeyOrJWT = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const validKey = process.env.ADMIN_API_KEY;

  if (apiKey !== undefined) {
    if (!validKey || apiKey !== validKey) {
      res.status(401).json({ error: 'Unauthorized: Invalid API key' });
      return;
    }
    req.user = { isApiKey: true };
    next();
    return;
  }

  authenticateToken(req, res, next);
};
