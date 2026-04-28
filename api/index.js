const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const { requestLogger, csrfProtection } = require('./middleware');
const { registerAuthRoutes } = require('./auth');

const app = express();

// ─── Parse DB URL ────────────────────────────────────────────────────────────
let pool;
try {
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
        const url = new URL(dbUrl.replace('postgresql://', 'http://').replace('postgres://', 'http://'));
        pool = new Pool({
            host: url.hostname, port: parseInt(url.port) || 5432,
            user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
            database: url.pathname.replace('/', ''),
            ssl: { rejectUnauthorized: false }, max: 1,
            idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000,
        });
    } else { console.error('DATABASE_URL is not set'); }
} catch (e) { console.error('Pool init error:', e.message); }

// ─── Global Middleware ───────────────────────────────────────────────────────
const WEB_PORTAL_URL = (process.env.WEB_PORTAL_URL || '*').trim();

app.use((req, res, next) => {
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

app.use(express.json());
app.use(cookieParser());

// ─── Database-backed Rate Limiting ──────────────────────────────────────────
// In-memory rate limiting doesn't work on Vercel serverless (each request = new instance)
// Use a simple counter object that persists within the same warm instance
const rateLimitStore = {};

function customRateLimiter(maxRequests, windowMs) {
    return (req, res, next) => {
        const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
        const now = Date.now();
        if (!rateLimitStore[key] || rateLimitStore[key].resetAt < now) {
            rateLimitStore[key] = { count: 1, resetAt: now + windowMs };
        } else {
            rateLimitStore[key].count++;
        }
        // Set standard rate limit headers
        const remaining = Math.max(0, maxRequests - rateLimitStore[key].count);
        res.setHeader('RateLimit-Limit', maxRequests);
        res.setHeader('RateLimit-Remaining', remaining);
        res.setHeader('RateLimit-Reset', Math.ceil(rateLimitStore[key].resetAt / 1000));
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', remaining);

        if (rateLimitStore[key].count > maxRequests) {
            return res.status(429).json({ status: 'error', message: 'Too many requests, please try again later' });
        }
        next();
    };
}

const authLimiter = customRateLimiter(10, 15 * 60 * 1000);
const generalLimiter = customRateLimiter(100, 15 * 60 * 1000);

// Apply rate limiters to both /api/v1/auth and /auth paths
app.use('/api/v1/auth', authLimiter);
app.use('/auth', authLimiter);
app.use('/api/v1', generalLimiter);

// Request logging
if (pool) app.use(requestLogger(pool));

// CSRF protection
app.use(csrfProtection);

// ─── Auth Routes ─────────────────────────────────────────────────────────────
if (pool) registerAuthRoutes(app, pool);

// ─── V1 API Routes ──────────────────────────────────────────────────────────
if (pool) {
    app.use('/api/v1/profiles', require('./profiles')(pool));
    app.use('/api/v1/admin', require('./admin')(pool));
}

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
    if (!pool) return res.status(500).json({ status: 'error', message: 'DATABASE_URL not set' });
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', db: 'connected' });
    } catch (e) { res.status(500).json({ status: 'error', db: 'disconnected', message: e.message }); }
});
app.get('/api/v1/health', async (req, res) => {
    if (!pool) return res.status(500).json({ status: 'error', message: 'DATABASE_URL not set' });
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', db: 'connected', version: 'v1' });
    } catch (e) { res.status(500).json({ status: 'error', db: 'disconnected', message: e.message }); }
});

// ─── Backward Compat: /api/profiles → /api/v1/profiles ──────────────────────
app.use('/api/profiles', (req, res) => {
    const newUrl = req.originalUrl.replace('/api/profiles', '/api/v1/profiles');
    res.redirect(307, newUrl);
});

// Start server locally
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
}

module.exports = app;