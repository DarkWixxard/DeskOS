// Shared-Token-Auth (M-Security / Quick Wins)
//
// Ein gemeinsames LAN-Geheimnis (DESKOS_TOKEN). Ist es gesetzt, verlangen API
// (außer /health) und WebSocket diesen Token; ist es leer, ist Auth deaktiviert
// (rückwärtskompatibel) und es wird beim Start gewarnt.

import type { Request, Response, NextFunction } from 'express';
import type { Socket } from 'socket.io';
import { timingSafeEqual } from 'crypto';

// Dynamisch gelesen, damit es unabhängig von der Import-/dotenv-Reihenfolge ist.
const getToken = (): string => (process.env.DESKOS_TOKEN || '').trim();

export const authEnabled = (): boolean => getToken().length > 0;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function tokenFromRequest(req: Request): string | null {
  const x = req.headers['x-deskos-token'];
  if (typeof x === 'string' && x) return x;
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  if (typeof req.query.token === 'string' && req.query.token) return req.query.token;
  return null;
}

/** Express-Middleware: schützt /api/*, lässt /health und CORS-Preflight durch. */
export function requireToken(req: Request, res: Response, next: NextFunction): void {
  if (!authEnabled()) return next();
  if (req.method === 'OPTIONS') return next();
  if (req.path === '/health') return next();
  // Spotify-OAuth-Redirect: kommt als Top-Level-Navigation aus dem Browser
  // zurück und kann den Token nicht mitschicken. Der Flow ist über den
  // CSRF-State abgesichert.
  if (req.path === '/api/spotify/callback') return next();
  const token = tokenFromRequest(req);
  if (token && safeEqual(token, getToken())) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

/** Socket.IO-Middleware (io.use): prüft den Token beim Verbindungsaufbau. */
export function socketAuth(socket: Socket, next: (err?: Error) => void): void {
  if (!authEnabled()) return next();
  const fromAuth = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
  const fromHeader = socket.handshake.headers['x-deskos-token'];
  const token =
    (typeof fromAuth === 'string' && fromAuth) ||
    (typeof fromHeader === 'string' ? fromHeader : '');
  if (token && safeEqual(token, getToken())) return next();
  next(new Error('Unauthorized'));
}
