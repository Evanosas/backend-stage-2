const { Pool } = require('pg');
const fs = require('fs');
const { v7: uuidv7 } = require('uuid');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function seed() {
    try {
        const data = fs.readFileSync('./seed_profiles.json', 'utf8');
        const { profiles } = JSON.parse(data);

        if (!profiles || !Array.isArray(profiles)) {
            throw new Error('Invalid JSON: expected a "profiles" array');
        }

        console.log(`📦 Found ${profiles.length} profiles to seed...`);

        // Ensure table exists with correct schema before seeding
        await pool.query(`
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

        // Add indexes for fast filtering (safe to run multiple times)
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_profiles_gender ON profiles(gender)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_profiles_age_group ON profiles(age_group)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_profiles_country_id ON profiles(country_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_profiles_age ON profiles(age)`);

        let inserted = 0;
        let skipped = 0;

        for (const profile of profiles) {
            const id = uuidv7();
            const createdAt = new Date().toISOString();

            const result = await pool.query(
                `INSERT INTO profiles 
                    (id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 ON CONFLICT (name) DO NOTHING`,
                [
                    id,
                    profile.name.toLowerCase(),
                    profile.gender,
                    profile.gender_probability,
                    profile.age,
                    profile.age_group,
                    profile.country_id,
                    profile.country_name,
                    profile.country_probability,
                    createdAt
                ]
            );

            if (result.rowCount > 0) {
                inserted++;
            } else {
                skipped++;
            }
        }

        console.log(`✅ Seeded ${inserted} new profiles`);
        console.log(`⏭️  Skipped ${skipped} existing profiles`);
        process.exit(0);
    } catch (error) {
        console.error('Seed error:', error.message || error);
        process.exit(1);
    }
}

seed();