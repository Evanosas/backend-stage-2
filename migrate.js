const { Pool } = require('pg');

let pool;
const dbUrl = process.env.DATABASE_URL;
if (dbUrl) {
    const url = new URL(dbUrl.replace('postgresql://', 'http://').replace('postgres://', 'http://'));
    pool = new Pool({
        host: url.hostname, port: parseInt(url.port) || 5432,
        user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
        database: url.pathname.replace('/', ''),
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 30000, idleTimeoutMillis: 60000,
    });
} else {
    console.error('DATABASE_URL not set'); process.exit(1);
}

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('🔄 Running Stage 3 migrations...');

        // Users table (GitHub OAuth)
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id              VARCHAR PRIMARY KEY,
                github_id       BIGINT UNIQUE NOT NULL,
                username        VARCHAR NOT NULL,
                email           VARCHAR,
                avatar_url      VARCHAR,
                role            VARCHAR DEFAULT 'analyst',
                created_at      TIMESTAMP DEFAULT NOW(),
                updated_at      TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('  ✅ users table ready');

        // Refresh tokens
        await client.query(`
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id              VARCHAR PRIMARY KEY,
                user_id         VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash      VARCHAR NOT NULL,
                expires_at      TIMESTAMP NOT NULL,
                created_at      TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('  ✅ refresh_tokens table ready');

        // Request logs
        await client.query(`
            CREATE TABLE IF NOT EXISTS request_logs (
                id              VARCHAR PRIMARY KEY,
                user_id         VARCHAR,
                method          VARCHAR NOT NULL,
                path            VARCHAR NOT NULL,
                status_code     INT,
                response_time   INT,
                ip_address      VARCHAR,
                user_agent      VARCHAR,
                created_at      TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('  ✅ request_logs table ready');

        // Rate limits (for DB-backed rate limiting on serverless)
        await client.query(`
            CREATE TABLE IF NOT EXISTS rate_limits (
                key             TEXT PRIMARY KEY,
                count           INTEGER DEFAULT 1,
                reset_at        TIMESTAMPTZ NOT NULL
            )
        `);
        console.log('  ✅ rate_limits table ready');

        // Indexes
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_request_logs_user ON request_logs(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at)`);
        console.log('  ✅ indexes ready');

        console.log('\n✅ All Stage 3 migrations complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration error:', error.message || error);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
