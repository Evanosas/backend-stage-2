const { Pool } = require('pg');
const fs = require('fs');
const crypto = require('crypto');

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

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    // Keep connection alive longer
    connectionTimeoutMillis: 30000,
    idleTimeoutMillis: 60000,
});

async function seed() {
    const client = await pool.connect();
    try {
        const data = fs.readFileSync('./seed_profiles.json', 'utf8');
        const { profiles } = JSON.parse(data);

        if (!profiles || !Array.isArray(profiles)) {
            throw new Error('Invalid JSON: expected a "profiles" array');
        }

        console.log(`📦 Found ${profiles.length} profiles to seed...`);

        // Ensure table + indexes exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS profiles (
                id                  VARCHAR PRIMARY KEY,
                name                VARCHAR UNIQUE NOT NULL,
                gender              VARCHAR,
                gender_probability  FLOAT,
                age                 INT,
                age_group           VARCHAR,
                country_id          VARCHAR(2),
                country_name        VARCHAR,
                country_probability FLOAT,
                created_at          TIMESTAMP DEFAULT NOW()
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_profiles_gender     ON profiles(gender)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_profiles_age_group  ON profiles(age_group)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_profiles_country_id ON profiles(country_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_profiles_age        ON profiles(age)`);

        console.log('✅ Table and indexes ready');

        // Insert in batches of 100 to avoid connection timeouts
        const BATCH_SIZE = 100;
        let inserted = 0;
        let skipped = 0;

        for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
            const batch = profiles.slice(i, i + BATCH_SIZE);

            // Build a single multi-row INSERT for the batch
            const values = [];
            const placeholders = batch.map((profile, j) => {
                const base = j * 9;
                values.push(
                    uuidv7(),
                    profile.name.toLowerCase(),
                    profile.gender,
                    profile.gender_probability,
                    profile.age,
                    profile.age_group,
                    profile.country_id,
                    profile.country_name,
                    profile.country_probability
                );
                return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, NOW())`;
            });

            const result = await client.query(
                `INSERT INTO profiles
                    (id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability, created_at)
                 VALUES ${placeholders.join(', ')}
                 ON CONFLICT (name) DO NOTHING`,
                values
            );

            inserted += result.rowCount;
            skipped  += batch.length - result.rowCount;

            const done = Math.min(i + BATCH_SIZE, profiles.length);
            console.log(`   Progress: ${done}/${profiles.length} processed...`);
        }

        console.log(`\n✅ Seeded ${inserted} new profiles`);
        console.log(`⏭️  Skipped ${skipped} existing profiles`);
        process.exit(0);
    } catch (error) {
        console.error('Seed error:', error.message || error);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

seed();