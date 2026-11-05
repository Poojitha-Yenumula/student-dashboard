'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { google } = require('googleapis');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const ROOT = __dirname;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const OTP_EMAIL_HOURLY_LIMIT = 5;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 4096;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};
const PUBLIC_ROOTS = new Set(['Dashboard', 'Images', 'assets', 'index.html', 'manifest.json', 'script.js', 'style.css']);

class HttpError extends Error {
  constructor(status, message, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function isGmailConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN && env.GMAIL_SENDER);
}

function createGmailSender(env) {
  return async (recipient, code) => {
    if (!isGmailConfigured(env)) {
      throw new HttpError(503, 'Email sign-in is not configured. Add the Gmail API settings to .env.');
    }

    const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth });
    const message = [
      `From: StudySync <${env.GMAIL_SENDER}>`,
      `To: ${recipient}`,
      'Subject: Your StudySync sign-in code',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      `Your StudySync verification code is ${code}.`,
      '',
      'It expires in 10 minutes. If you did not request this code, you can ignore this message.'
    ].join('\r\n');

    try {
      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: Buffer.from(message, 'utf8').toString('base64url') }
      });
    } catch {
      throw new HttpError(502, 'Google could not send the sign-in code. Check your Gmail API and OAuth configuration.');
    }
  };
}

function signToken(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  if (!data || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function createStudySyncHandler(options = {}) {
  const env = options.env || process.env;
  const now = options.now || Date.now;
  const randomCode = options.randomCode || (() => String(crypto.randomInt(100000, 1000000)));
  const sendOtpEmail = options.sendOtpEmail || createGmailSender(env);
  const otpSecret = env.SESSION_SECRET || '';
  const pendingOtps = new Map();
  const sessions = new Map();
  const revokedTokens = new Set();
  const lastOtpRequest = new Map();
  const emailRequests = new Map();
  const ipRequests = new Map();
  const cookieName = 'studysync_session';

  return async (req, res) => {
    const rawPath = req.originalUrl || req.url;
    const url = new URL(rawPath, 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');

    try {
      if (url.pathname === '/api/health' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, emailConfigured: Boolean(options.sendOtpEmail) || isGmailConfigured(env) });
      }

      if (url.pathname === '/api/auth/request-otp' && req.method === 'POST') {
        const body = await readJson(req);
        const email = String(body.email || '').trim().toLowerCase();
        const name = String(body.name || '').trim().slice(0, 80);
        if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new HttpError(400, 'Enter a valid email address.');

        const configured = Boolean(options.sendOtpEmail) || isGmailConfigured(env);
        if (!configured || otpSecret.length < 32 || otpSecret === 'replace-with-a-long-random-secret') {
          throw new HttpError(503, 'Email sign-in is not configured. Add the Gmail API and session settings to .env.');
        }

        const currentTime = now();
        for (const [address, challenge] of pendingOtps) {
          if (challenge.expiresAt <= currentTime) pendingOtps.delete(address);
        }
        for (const [token, session] of sessions) {
          if (session.expiresAt <= currentTime) sessions.delete(token);
        }
        const previousRequest = lastOtpRequest.get(email) || 0;
        if (currentTime - previousRequest < OTP_COOLDOWN_MS) {
          const retryAfter = Math.ceil((OTP_COOLDOWN_MS - (currentTime - previousRequest)) / 1000);
          throw new HttpError(429, `Please wait ${retryAfter} seconds before requesting another code.`, retryAfter);
        }
        const recentEmailRequests = (emailRequests.get(email) || []).filter(timestamp => currentTime - timestamp < 60 * 60 * 1000);
        if (recentEmailRequests.length >= OTP_EMAIL_HOURLY_LIMIT) {
          const retryAfter = Math.ceil((60 * 60 * 1000 - (currentTime - recentEmailRequests[0])) / 1000);
          throw new HttpError(429, 'Too many codes have been requested for this email. Try again later.', retryAfter);
        }

        const ip = req.socket?.remoteAddress || 'unknown';
        const recentRequests = (ipRequests.get(ip) || []).filter(timestamp => currentTime - timestamp < 60 * 60 * 1000);
        if (recentRequests.length >= 10) throw new HttpError(429, 'Too many code requests. Try again later.', 3600);

        const code = randomCode();
        try {
          await sendOtpEmail(email, code);
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(502, 'Could not send the sign-in code. Check the Gmail API configuration and try again.');
        }

        const digest = crypto.createHmac('sha256', otpSecret).update(`${email}\0${code}`).digest();
        pendingOtps.set(email, { digest, expiresAt: currentTime + OTP_TTL_MS, attempts: 0, name });
        lastOtpRequest.set(email, currentTime);
        emailRequests.set(email, [...recentEmailRequests, currentTime]);
        ipRequests.set(ip, [...recentRequests, currentTime]);

        const challengeToken = signToken({ email, digestHex: digest.toString('hex'), expiresAt: currentTime + OTP_TTL_MS, name }, otpSecret);
        const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
        res.setHeader('Set-Cookie', `studysync_challenge=${challengeToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=600${secure}`);
        return sendJson(res, 200, { message: 'A sign-in code has been sent to your email address.' });
      }

      if (url.pathname === '/api/auth/verify-otp' && req.method === 'POST') {
        if (otpSecret.length < 32 || otpSecret === 'replace-with-a-long-random-secret') {
          throw new HttpError(503, 'Email sign-in is not configured. Add the session settings to .env.');
        }
        const body = await readJson(req);
        const email = String(body.email || '').trim().toLowerCase();
        const code = String(body.code || '').trim();
        if (!EMAIL_PATTERN.test(email) || !/^\d{6}$/.test(code)) throw new HttpError(400, 'Enter a valid email and six-digit code.');

        let challenge = pendingOtps.get(email);
        if (!challenge) {
          const challengeCookie = getCookie(req, 'studysync_challenge');
          const verified = verifyToken(challengeCookie, otpSecret);
          if (verified && verified.email === email && verified.expiresAt > now()) {
            challenge = {
              digest: Buffer.from(verified.digestHex, 'hex'),
              expiresAt: verified.expiresAt,
              attempts: 0,
              name: verified.name
            };
          }
        }

        if (!challenge || challenge.expiresAt <= now()) {
          pendingOtps.delete(email);
          throw new HttpError(400, 'That code has expired or is invalid. Request a new one.');
        }

        challenge.attempts += 1;
        const digest = crypto.createHmac('sha256', otpSecret).update(`${email}\0${code}`).digest();
        if (!crypto.timingSafeEqual(challenge.digest, digest)) {
          if (challenge.attempts >= OTP_MAX_ATTEMPTS) pendingOtps.delete(email);
          throw new HttpError(400, 'That code is incorrect. Check your email and try again.');
        }

        pendingOtps.delete(email);
        const sessionPayload = {
          email,
          name: challenge.name || email.split('@')[0] || 'Student',
          expiresAt: now() + SESSION_TTL_MS
        };
        const sessionToken = signToken(sessionPayload, otpSecret);
        sessions.set(sessionToken, sessionPayload);
        const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
        res.setHeader('Set-Cookie', `${cookieName}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
        return sendJson(res, 200, sessionPayload);
      }

      if (url.pathname === '/api/auth/session' && req.method === 'GET') {
        const token = getCookie(req, cookieName);
        if (!token || revokedTokens.has(token)) {
          res.setHeader('Set-Cookie', clearCookie(cookieName, env));
          return sendJson(res, 401, { error: 'Your session has expired. Sign in again.' });
        }

        let session = sessions.get(token);
        if (!session) {
          const verified = verifyToken(token, otpSecret);
          if (verified && verified.email && verified.expiresAt > now()) {
            session = verified;
          }
        }

        if (!session || session.expiresAt <= now()) {
          sessions.delete(token);
          revokedTokens.add(token);
          res.setHeader('Set-Cookie', clearCookie(cookieName, env));
          return sendJson(res, 401, { error: 'Your session has expired. Sign in again.' });
        }
        return sendJson(res, 200, session);
      }

      if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
        const token = getCookie(req, cookieName);
        if (token) {
          sessions.delete(token);
          revokedTokens.add(token);
        }
        res.setHeader('Set-Cookie', clearCookie(cookieName, env));
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        return res.end();
      }

      if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'API route not found.' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });
      if (url.pathname.toLowerCase() === '/dashboard/dashboard.html') {
        const token = getCookie(req, cookieName);
        let session = token && !revokedTokens.has(token) ? sessions.get(token) : null;
        if (!session && token && !revokedTokens.has(token)) {
          const verified = verifyToken(token, otpSecret);
          if (verified && verified.email && verified.expiresAt > now()) session = verified;
        }
        if (!session || session.expiresAt <= now()) {
          if (token) {
            sessions.delete(token);
            revokedTokens.add(token);
          }
          res.writeHead(302, { 'Cache-Control': 'no-store', Location: '/index.html', 'Set-Cookie': clearCookie(cookieName, env) });
          return res.end();
        }
      }
      return serveStatic(req, res, url.pathname);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : 'The server could not complete the request.';
      if (status >= 500) console.error('StudySync request failed:', message);
      return sendJson(res, status, { error: message, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
    }
  };
}

function createStudySyncServer(options = {}) {
  const handler = createStudySyncHandler(options);
  return http.createServer(handler);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new HttpError(413, 'Request is too large.');
  }
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'Request body must be a JSON object.');
    }
    return parsed;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

function getCookie(req, name) {
  const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : '';
}

function clearCookie(name, env) {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(value));
}

function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, { error: 'Invalid path.' });
  }

  const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^[/\\]+/, '');
  const firstPathSegment = relativePath.split(/[\\/]/, 1)[0];
  if (!PUBLIC_ROOTS.has(firstPathSegment)) return sendJson(res, 404, { error: 'File not found.' });
  const filePath = path.resolve(ROOT, relativePath);
  const relative = path.relative(ROOT, filePath);
  const resolvedRoot = relative.split(path.sep)[0];
  if (relative.startsWith('..') || path.isAbsolute(relative)) return sendJson(res, 403, { error: 'Forbidden.' });
  if (!PUBLIC_ROOTS.has(resolvedRoot) || relative.split(path.sep).some(segment => segment.startsWith('.'))) {
    return sendJson(res, 404, { error: 'File not found.' });
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return sendJson(res, 404, { error: 'File not found.' });
  }
  if (!stat.isFile()) return sendJson(res, 404, { error: 'File not found.' });

  res.writeHead(200, {
    'Cache-Control': 'no-cache',
    'Content-Length': stat.size,
    'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createStudySyncServer().listen(port, '127.0.0.1', () => {
    console.log(`StudySync is running at http://127.0.0.1:${port}`);
  });
}

module.exports = { createStudySyncServer, createStudySyncHandler };
