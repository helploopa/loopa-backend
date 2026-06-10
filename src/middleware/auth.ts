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
