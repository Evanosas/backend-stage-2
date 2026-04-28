const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { uuidv7, JWT_SECRET } = require('./middleware');

const GITHUB_CLIENT_ID = (process.env.GITHUB_CLIENT_ID || '').trim();
const GITHUB_CLIENT_SECRET = (process.env.GITHUB_CLIENT_SECRET || '').trim();
const BACKEND_URL = (process.env.BACKEND_URL || 'https://backendstage1-api.vercel.app').trim();
const WEB_PORTAL_URL = (process.env.WEB_PORTAL_URL || 'http://localhost:5173').trim();
const DEFAULT_ADMIN_GITHUB_ID = (process.env.DEFAULT_ADMIN_GITHUB_ID || '').trim();

// In-memory PKCE store (per state param). For Vercel serverless, we pass verifier via state encoding.
const pendingStates = new Map();

function getPool() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return null;
    const url = new URL(dbUrl.replace('postgresql://', 'http://').replace('postgres://', 'http://'));
    return new Pool({
        host: url.hostname, port: parseInt(url.port) || 5432,
        user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
        database: url.pathname.replace('/', ''),
        ssl: { rejectUnauthorized: false }, max: 1,
        idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000,
    });
}

// ─── PKCE Helpers ────────────────────────────────────────────────────────────
function generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function generateAccessToken(user) {
    return jwt.sign(
        { userId: user.id, role: user.role, githubUsername: user.username },
        JWT_SECRET,
        { expiresIn: '15m' }
    );
}

function generateRefreshToken() {
    return crypto.randomBytes(64).toString('hex');
}

// ─── Register Auth Routes ────────────────────────────────────────────────────
function registerAuthRoutes(app, pool) {

    // GET /api/v1/auth/github — Start OAuth + PKCE flow
    app.get('/api/v1/auth/github', (req, res) => {
        if (!GITHUB_CLIENT_ID) {
            return res.status(500).json({ status: 'error', message: 'GitHub OAuth not configured' });
        }

        const clientType = req.query.client || 'web'; // 'web' or 'cli'
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);

        // Encode state with client type and verifier (for serverless statelessness)
        const stateData = JSON.stringify({ client: clientType, verifier: codeVerifier, ts: Date.now() });
        const state = Buffer.from(stateData).toString('base64url');

        const params = new URLSearchParams({
            client_id: GITHUB_CLIENT_ID,
            redirect_uri: `${BACKEND_URL}/api/v1/auth/github/callback`,
            scope: 'read:user user:email',
            state: state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        });

        res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
    });

    // GET /api/v1/auth/github/callback — Handle OAuth callback
    app.get('/api/v1/auth/github/callback', async (req, res) => {
        try {
            const { code, state } = req.query;
            if (!code) {
                return res.status(400).json({ status: 'error', message: 'Missing code parameter' });
            }
            if (!state) {
                return res.status(400).json({ status: 'error', message: 'Missing state parameter' });
            }

            // Decode state
            let stateData;
            try {
                stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
            } catch {
                return res.status(400).json({ status: 'error', message: 'Invalid state parameter' });
            }

            const { client: clientType, verifier: codeVerifier } = stateData;

            // Exchange code for GitHub access token
            const tokenRes = await axios.post('https://github.com/login/oauth/access_token', {
                client_id: GITHUB_CLIENT_ID,
                client_secret: GITHUB_CLIENT_SECRET,
                code,
                redirect_uri: `${BACKEND_URL}/api/v1/auth/github/callback`,
                code_verifier: codeVerifier,
            }, { headers: { Accept: 'application/json' }, timeout: 10000 });

            const githubAccessToken = tokenRes.data.access_token;
            if (!githubAccessToken) {
                return res.status(401).json({ status: 'error', message: 'GitHub auth failed' });
            }

            // Fetch GitHub user profile
            const userRes = await axios.get('https://api.github.com/user', {
                headers: { Authorization: `Bearer ${githubAccessToken}`, 'User-Agent': 'InsightaLabs' },
                timeout: 10000,
            });
            const ghUser = userRes.data;

            // Fetch email if not public
            let email = ghUser.email;
            if (!email) {
                try {
                    const emailRes = await axios.get('https://api.github.com/user/emails', {
                        headers: { Authorization: `Bearer ${githubAccessToken}`, 'User-Agent': 'InsightaLabs' },
                        timeout: 10000,
                    });
                    const primary = emailRes.data.find(e => e.primary);
                    email = primary ? primary.email : emailRes.data[0]?.email || null;
                } catch { email = null; }
            }

            // Upsert user in database
            const existing = await pool.query('SELECT * FROM users WHERE github_id = $1', [ghUser.id]);
            let user;
            if (existing.rows.length > 0) {
                user = existing.rows[0];
                await pool.query(
                    'UPDATE users SET username=$1, email=$2, avatar_url=$3, updated_at=NOW() WHERE id=$4',
                    [ghUser.login, email, ghUser.avatar_url, user.id]
                );
                user.username = ghUser.login;
                user.email = email;
            } else {
                const userId = uuidv7();
                // First user or matching DEFAULT_ADMIN_GITHUB_ID becomes admin
                const countRes = await pool.query('SELECT COUNT(*) FROM users');
                const isFirst = parseInt(countRes.rows[0].count) === 0;
                const isDefaultAdmin = DEFAULT_ADMIN_GITHUB_ID && String(ghUser.id) === String(DEFAULT_ADMIN_GITHUB_ID);
                const role = (isFirst || isDefaultAdmin) ? 'admin' : 'analyst';

                await pool.query(
                    `INSERT INTO users (id, github_id, username, email, avatar_url, role, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
                    [userId, ghUser.id, ghUser.login, email, ghUser.avatar_url, role]
                );
                user = { id: userId, github_id: ghUser.id, username: ghUser.login, email, role };
            }

            // Generate tokens
            const accessToken = generateAccessToken(user);
            const refreshToken = generateRefreshToken();
            const refreshHash = hashToken(refreshToken);
            const refreshId = uuidv7();
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

            await pool.query(
                'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
                [refreshId, user.id, refreshHash, expiresAt]
            );

            // Response depends on client type
            if (clientType === 'cli') {
                // Redirect to CLI's local callback server
                const cliPort = 9876;
                const params = new URLSearchParams({
                    access_token: accessToken,
                    refresh_token: refreshToken,
                    user: JSON.stringify({ id: user.id, username: user.username, role: user.role }),
                });
                return res.redirect(`http://localhost:${cliPort}/callback?${params.toString()}`);
            }

            // Web portal — set HTTP-only cookies
            const csrfToken = crypto.randomBytes(32).toString('hex');
            const cookieOpts = {
                httpOnly: true, secure: true, sameSite: 'None',
                path: '/', maxAge: 15 * 60 * 1000, // 15 min
            };
            const refreshCookieOpts = {
                httpOnly: true, secure: true, sameSite: 'None',
                path: '/api/v1/auth', maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            };

            res.cookie('access_token', accessToken, cookieOpts);
            res.cookie('refresh_token', refreshToken, refreshCookieOpts);
            res.cookie('csrf_token', csrfToken, {
                httpOnly: false, secure: true, sameSite: 'None',
                path: '/', maxAge: 15 * 60 * 1000,
            });

            return res.redirect(`${WEB_PORTAL_URL}/dashboard?login=success`);
        } catch (error) {
            console.error('OAuth callback error:', error.message);
            res.status(500).json({ status: 'error', message: 'Authentication failed' });
        }
    });

    // Enforce POST on /refresh
    app.get('/api/v1/auth/refresh', (req, res) => {
        return res.status(405).json({ status: 'error', message: 'Method not allowed. Use POST.' });
    });

    // POST /api/v1/auth/refresh — Refresh access token
    app.post('/api/v1/auth/refresh', async (req, res) => {
        try {
            let refreshToken = req.body.refresh_token;
            if (!refreshToken && req.cookies) {
                refreshToken = req.cookies.refresh_token;
            }
            if (!refreshToken) {
                return res.status(400).json({ status: 'error', message: 'Refresh token required' });
            }

            const tokenHash = hashToken(refreshToken);
            const result = await pool.query(
                `SELECT rt.*, u.role, u.username FROM refresh_tokens rt
                 JOIN users u ON rt.user_id = u.id
                 WHERE rt.token_hash = $1 AND rt.expires_at > NOW()`,
                [tokenHash]
            );

            if (result.rows.length === 0) {
                return res.status(401).json({ status: 'error', message: 'Invalid or expired refresh token' });
            }

            const row = result.rows[0];
            // Delete old refresh token
            await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [row.id]);

            // Get full user
            const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [row.user_id]);
            if (userRes.rows.length === 0) {
                return res.status(401).json({ status: 'error', message: 'User not found' });
            }
            const user = userRes.rows[0];

            // Issue new tokens
            const newAccessToken = generateAccessToken(user);
            const newRefreshToken = generateRefreshToken();
            const newRefreshHash = hashToken(newRefreshToken);
            const newRefreshId = uuidv7();
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

            await pool.query(
                'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
                [newRefreshId, user.id, newRefreshHash, expiresAt]
            );

            // If cookie-based, update cookies
            if (req.cookies && req.cookies.refresh_token) {
                const csrfToken = crypto.randomBytes(32).toString('hex');
                res.cookie('access_token', newAccessToken, {
                    httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 15 * 60 * 1000,
                });
                res.cookie('refresh_token', newRefreshToken, {
                    httpOnly: true, secure: true, sameSite: 'None', path: '/api/v1/auth', maxAge: 7 * 24 * 60 * 60 * 1000,
                });
                res.cookie('csrf_token', csrfToken, {
                    httpOnly: false, secure: true, sameSite: 'None', path: '/', maxAge: 15 * 60 * 1000,
                });
            }

            res.json({
                status: 'success',
                data: { access_token: newAccessToken, refresh_token: newRefreshToken }
            });
        } catch (error) {
            console.error('Token refresh error:', error.message);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    });

    // Enforce POST on /logout
    app.get('/api/v1/auth/logout', (req, res) => {
        return res.status(405).json({ status: 'error', message: 'Method not allowed. Use POST.' });
    });

    // POST /api/v1/auth/logout
    app.post('/api/v1/auth/logout', async (req, res) => {
        try {
            let refreshToken = req.body.refresh_token;
            if (!refreshToken && req.cookies) {
                refreshToken = req.cookies.refresh_token;
            }
            if (refreshToken) {
                const tokenHash = hashToken(refreshToken);
                await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
            }

            // Clear cookies
            res.clearCookie('access_token', { path: '/' });
            res.clearCookie('refresh_token', { path: '/api/v1/auth' });
            res.clearCookie('csrf_token', { path: '/' });

            res.json({ status: 'success', message: 'Logged out' });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    });

    // GET /api/v1/auth/me — Current user info
    app.get('/api/v1/auth/me', async (req, res) => {
        try {
            // Authenticate inline (this route needs auth)
            let token = null;
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.substring(7);
            if (!token && req.cookies) token = req.cookies.access_token;
            if (!token) return res.status(401).json({ status: 'error', message: 'Authentication required' });

            let decoded;
            try { decoded = jwt.verify(token, JWT_SECRET); }
            catch { return res.status(401).json({ status: 'error', message: 'Invalid token' }); }

            const result = await pool.query('SELECT id, github_id, username, email, avatar_url, role, created_at FROM users WHERE id = $1', [decoded.userId]);
            if (result.rows.length === 0) {
                return res.status(404).json({ status: 'error', message: 'User not found' });
            }
            res.json({ status: 'success', data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    });

    // Alias: /api/v1/users/me → same as /api/v1/auth/me
    app.get('/api/v1/users/me', async (req, res) => {
        try {
            let token = null;
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.substring(7);
            if (!token && req.cookies) token = req.cookies.access_token;
            if (!token) return res.status(401).json({ status: 'error', message: 'Authentication required' });
            let decoded;
            try { decoded = jwt.verify(token, JWT_SECRET); }
            catch { return res.status(401).json({ status: 'error', message: 'Invalid token' }); }
            const result = await pool.query('SELECT id, github_id, username, email, avatar_url, role, created_at FROM users WHERE id = $1', [decoded.userId]);
            if (result.rows.length === 0) return res.status(404).json({ status: 'error', message: 'User not found' });
            res.json({ status: 'success', data: result.rows[0] });
        } catch (error) { res.status(500).json({ status: 'error', message: 'Internal server error' }); }
    });
}

module.exports = { registerAuthRoutes };
