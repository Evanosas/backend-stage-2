const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// ─── UUID v7 Generator ───────────────────────────────────────────────────────
function uuidv7() {
    const now = BigInt(Date.now());
    const buf = Buffer.alloc(16);
    buf.writeUIntBE(Number((now >> 16n) & 0xffffn), 0, 2);
    buf.writeUIntBE(Number(now & 0xffffffffffffn), 2, 6);
    const rand = crypto.randomBytes(10);
    rand.copy(buf, 6);
    buf[6] = (buf[6] & 0x0f) | 0x70;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const hex = buf.toString('hex');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// ─── Authenticate Middleware ─────────────────────────────────────────────────
function authenticate(req, res, next) {
    try {
        let token = null;

        // Check Authorization header first
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }

        // Fallback to HTTP-only cookie
        if (!token && req.cookies && req.cookies.access_token) {
            token = req.cookies.access_token;
        }

        if (!token) {
            return res.status(401).json({ status: 'error', message: 'Authentication required' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ status: 'error', message: 'Token expired' });
        }
        return res.status(401).json({ status: 'error', message: 'Invalid token' });
    }
}

// ─── Authorize Middleware ────────────────────────────────────────────────────
function authorize(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ status: 'error', message: 'Authentication required' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ status: 'error', message: 'Insufficient permissions' });
        }
        next();
    };
}

// ─── Request Logger Middleware ───────────────────────────────────────────────
function requestLogger(pool) {
    return (req, res, next) => {
        const start = Date.now();
        const originalEnd = res.end;

        res.end = function (...args) {
            const duration = Date.now() - start;
            // Fire and forget — don't block the response
            try {
                pool.query(
                    `INSERT INTO request_logs (id, user_id, method, path, status_code, response_time, ip_address, user_agent, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
                    [
                        uuidv7(),
                        req.user ? req.user.userId : null,
                        req.method,
                        req.originalUrl || req.url,
                        res.statusCode,
                        duration,
                        req.ip || req.headers['x-forwarded-for'] || 'unknown',
                        (req.headers['user-agent'] || '').substring(0, 255)
                    ]
                ).catch(() => {}); // silently ignore logging errors
            } catch (_) {}
            originalEnd.apply(res, args);
        };
        next();
    };
}

// ─── CSRF Protection Middleware ──────────────────────────────────────────────
function csrfProtection(req, res, next) {
    // Only enforce on state-changing methods for cookie-based auth
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // Only enforce if using cookie auth (web portal)
    if (!req.cookies || !req.cookies.access_token) {
        return next();
    }

    const csrfCookie = req.cookies.csrf_token;
    const csrfHeader = req.headers['x-csrf-token'];

    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        return res.status(403).json({ status: 'error', message: 'Invalid CSRF token' });
    }
    next();
}

module.exports = { uuidv7, authenticate, authorize, requestLogger, csrfProtection, JWT_SECRET };
