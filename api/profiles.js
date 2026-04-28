const express = require('express');
const axios = require('axios');
const { uuidv7 } = require('./middleware');
const { authenticate, authorize } = require('./middleware');

const router = express.Router();

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getAgeGroup(age) {
    if (age <= 12) return 'child';
    if (age <= 19) return 'teenager';
    if (age <= 59) return 'adult';
    return 'senior';
}

const VALID_SORT_BY = ['age', 'created_at', 'gender_probability'];
const VALID_ORDER = ['asc', 'desc'];
const VALID_GENDERS = ['male', 'female'];
const VALID_AGE_GROUPS = ['child', 'teenager', 'adult', 'senior'];

function isPositiveInt(val) {
    return Number.isInteger(Number(val)) && Number(val) > 0;
}
function isFloat(val) {
    return !isNaN(parseFloat(val)) && parseFloat(val) >= 0 && parseFloat(val) <= 1;
}

const COUNTRY_MAP = {
    'afghanistan':'AF','albania':'AL','algeria':'DZ','angola':'AO','argentina':'AR','australia':'AU','austria':'AT','bahrain':'BH','bangladesh':'BD','belgium':'BE','benin':'BJ','bolivia':'BO','botswana':'BW','brazil':'BR','burkina faso':'BF','burundi':'BI','cameroon':'CM','canada':'CA','cape verde':'CV','central african republic':'CF','chad':'TD','chile':'CL','china':'CN','colombia':'CO','comoros':'KM','congo':'CG','dr congo':'CD','democratic republic of congo':'CD','republic of the congo':'CG','costa rica':'CR',"cote d'ivoire":'CI','ivory coast':'CI','croatia':'HR','cuba':'CU','denmark':'DK','djibouti':'DJ','ecuador':'EC','egypt':'EG','eritrea':'ER','ethiopia':'ET','finland':'FI','france':'FR','gabon':'GA','gambia':'GM','ghana':'GH','greece':'GR','guatemala':'GT','guinea':'GN','guinea-bissau':'GW','haiti':'HT','hungary':'HU','india':'IN','indonesia':'ID','iran':'IR','iraq':'IQ','ireland':'IE','israel':'IL','italy':'IT','jamaica':'JM','japan':'JP','jordan':'JO','kenya':'KE','kuwait':'KW','lebanon':'LB','lesotho':'LS','liberia':'LR','libya':'LY','madagascar':'MG','malawi':'MW','malaysia':'MY','mali':'ML','mauritania':'MR','mauritius':'MU','mexico':'MX','morocco':'MA','mozambique':'MZ','namibia':'NA','netherlands':'NL','new zealand':'NZ','niger':'NE','nigeria':'NG','norway':'NO','oman':'OM','pakistan':'PK','panama':'PA','peru':'PE','philippines':'PH','poland':'PL','portugal':'PT','qatar':'QA','romania':'RO','russia':'RU','rwanda':'RW','saudi arabia':'SA','senegal':'SN','sierra leone':'SL','somalia':'SO','south africa':'ZA','south sudan':'SS','spain':'ES','sri lanka':'LK','sudan':'SD','swaziland':'SZ','eswatini':'SZ','sweden':'SE','switzerland':'CH','syria':'SY','tanzania':'TZ','thailand':'TH','togo':'TG','tunisia':'TN','turkey':'TR','uganda':'UG','ukraine':'UA','united arab emirates':'AE','uae':'AE','united kingdom':'GB','uk':'GB','united states':'US','usa':'US','america':'US','uruguay':'UY','venezuela':'VE','vietnam':'VN','western sahara':'EH','yemen':'YE','zambia':'ZM','zimbabwe':'ZW'
};

function parseNaturalLanguage(q) {
    const text = q.toLowerCase().trim();
    const filters = {};
    let matched = false;
    if (/\b(male|males|men|man)\b/.test(text) && !/\bfe(male|males)\b/.test(text)) { filters.gender = 'male'; matched = true; }
    if (/\b(female|females|women|woman)\b/.test(text)) { filters.gender = 'female'; matched = true; }
    if (/\b(male|males|men)\b/.test(text) && /\b(female|females|women)\b/.test(text)) { delete filters.gender; }
    if (/\byoung\b/.test(text)) { filters.min_age = 16; filters.max_age = 24; matched = true; }
    if (/\b(child|children)\b/.test(text)) { filters.age_group = 'child'; matched = true; }
    if (/\b(teenager|teenagers|teen|teens)\b/.test(text)) { filters.age_group = 'teenager'; matched = true; }
    if (/\b(adult|adults)\b/.test(text)) { filters.age_group = 'adult'; matched = true; }
    if (/\b(senior|seniors|elderly|old)\b/.test(text)) { filters.age_group = 'senior'; matched = true; }
    const betweenMatch = text.match(/between\s+(\d+)\s+and\s+(\d+)/);
    if (betweenMatch) { filters.min_age = parseInt(betweenMatch[1]); filters.max_age = parseInt(betweenMatch[2]); matched = true; }
    const agedMatch = text.match(/\baged?\s+(\d+)\b/);
    if (agedMatch) { filters.min_age = parseInt(agedMatch[1]); filters.max_age = parseInt(agedMatch[1]); matched = true; }
    const aboveMatch = text.match(/\b(?:above|older than|over)\s+(\d+)\b/);
    if (aboveMatch) { filters.min_age = parseInt(aboveMatch[1]); matched = true; }
    const belowMatch = text.match(/\b(?:below|younger than|under)\s+(\d+)\b/);
    if (belowMatch) { filters.max_age = parseInt(belowMatch[1]); matched = true; }
    const countryMatch = text.match(/\b(?:from|in)\s+([a-z\s'-]+?)(?:\s*$|\s+(?:above|below|aged|between|who|with|and|over|under))/);
    if (countryMatch) {
        const iso = COUNTRY_MAP[countryMatch[1].trim()];
        if (iso) { filters.country_id = iso; matched = true; }
    } else {
        const countryEndMatch = text.match(/\b(?:from|in)\s+([a-z\s'-]+)$/);
        if (countryEndMatch) {
            const iso = COUNTRY_MAP[countryEndMatch[1].trim()];
            if (iso) { filters.country_id = iso; matched = true; }
        }
    }
    return matched ? filters : null;
}

// Build WHERE clause from filters
function buildWhereClause(filters) {
    let conditions = 'WHERE 1=1';
    const params = [];
    let idx = 1;
    if (filters.gender) { conditions += ` AND gender = $${idx++}`; params.push(filters.gender.toLowerCase()); }
    if (filters.age_group) { conditions += ` AND age_group = $${idx++}`; params.push(filters.age_group.toLowerCase()); }
    if (filters.country_id) { conditions += ` AND UPPER(country_id) = UPPER($${idx++})`; params.push(filters.country_id); }
    if (filters.min_age !== undefined) { conditions += ` AND age >= $${idx++}`; params.push(Number(filters.min_age)); }
    if (filters.max_age !== undefined) { conditions += ` AND age <= $${idx++}`; params.push(Number(filters.max_age)); }
    if (filters.min_gender_probability !== undefined) { conditions += ` AND gender_probability >= $${idx++}`; params.push(parseFloat(filters.min_gender_probability)); }
    if (filters.min_country_probability !== undefined) { conditions += ` AND country_probability >= $${idx++}`; params.push(parseFloat(filters.min_country_probability)); }
    return { conditions, params, idx };
}

function makePagination(pageNum, limitNum, total) {
    const total_pages = Math.ceil(total / limitNum) || 1;
    return { page: pageNum, limit: limitNum, total, total_pages, has_next: pageNum < total_pages, has_prev: pageNum > 1 };
}

module.exports = function(pool) {

    // POST /profiles — create profile (admin only)
    router.post('/', authenticate, authorize('admin'), async (req, res) => {
        try {
            const { name } = req.body;
            if (!name || typeof name !== 'string' || name.trim() === '') {
                return res.status(400).json({ status: 'error', message: 'Missing or empty name' });
            }
            const trimmedName = name.trim().toLowerCase();
            const existing = await pool.query('SELECT * FROM profiles WHERE name = $1', [trimmedName]);
            if (existing.rows.length > 0) {
                return res.status(200).json({ status: 'success', message: 'Profile already exists', data: existing.rows[0] });
            }
            const axiosConfig = { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 };
            const [genderRes, ageRes, countryRes] = await Promise.all([
                axios.get(`https://api.genderize.io?name=${trimmedName}`, axiosConfig),
                axios.get(`https://api.agify.io?name=${trimmedName}`, axiosConfig),
                axios.get(`https://api.nationalize.io?name=${trimmedName}`, axiosConfig)
            ]);
            if (!genderRes.data.gender) return res.status(502).json({ status: 'error', message: 'Genderize returned an invalid response' });
            if (!ageRes.data.age && ageRes.data.age !== 0) return res.status(502).json({ status: 'error', message: 'Agify returned an invalid response' });
            if (!countryRes.data.country || countryRes.data.country.length === 0) return res.status(502).json({ status: 'error', message: 'Nationalize returned an invalid response' });
            const topCountry = countryRes.data.country[0];
            let countryName = topCountry.country_id;
            try {
                const cRes = await axios.get(`https://restcountries.com/v3.1/alpha/${topCountry.country_id}`, { timeout: 5000 });
                countryName = cRes.data[0]?.name?.common || topCountry.country_id;
            } catch (_) {}
            const id = uuidv7();
            const createdAt = new Date().toISOString();
            const ageGroup = getAgeGroup(ageRes.data.age);
            await pool.query(
                `INSERT INTO profiles (id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [id, trimmedName, genderRes.data.gender, genderRes.data.probability, ageRes.data.age, ageGroup, topCountry.country_id, countryName, topCountry.probability, createdAt]
            );
            const saved = await pool.query('SELECT * FROM profiles WHERE id = $1', [id]);
            res.status(201).json({ status: 'success', data: saved.rows[0] });
        } catch (error) {
            console.error('POST /profiles error:', error.message);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    });

    // GET /profiles/search — NLP search (authenticated)
    router.get('/search', authenticate, async (req, res) => {
        try {
            const { q, page = '1', limit = '10' } = req.query;
            if (!q || typeof q !== 'string' || q.trim() === '') {
                return res.status(400).json({ status: 'error', message: 'Missing or empty parameter: q' });
            }
            const pageNum = parseInt(page); const limitNum = parseInt(limit);
            if (!isPositiveInt(page) || !isPositiveInt(limit)) return res.status(422).json({ status: 'error', message: 'Invalid query parameters' });
            if (limitNum > 50) return res.status(422).json({ status: 'error', message: 'Invalid query parameters' });
            const filters = parseNaturalLanguage(q.trim());
            if (!filters) return res.status(200).json({ status: 'error', message: 'Unable to interpret query' });
            const { conditions, params, idx } = buildWhereClause(filters);
            const countResult = await pool.query(`SELECT COUNT(*) FROM profiles ${conditions}`, params);
            const total = parseInt(countResult.rows[0].count);
            const offset = (pageNum - 1) * limitNum;
            let i = idx;
            const result = await pool.query(
                `SELECT * FROM profiles ${conditions} ORDER BY created_at ASC LIMIT $${i++} OFFSET $${i++}`,
                [...params, limitNum, offset]
            );
            res.status(200).json({ status: 'success', data: result.rows, pagination: makePagination(pageNum, limitNum, total) });
        } catch (error) {
            console.error('GET /profiles/search error:', error.message);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    });

    // GET /profiles/export/csv — CSV export (authenticated)
    router.get('/export/csv', authenticate, async (req, res) => {
        try {
            const { gender, age_group, country_id, min_age, max_age, sort_by = 'created_at', order = 'asc' } = req.query;
            const filters = { gender, age_group, country_id };
            if (min_age) filters.min_age = min_age;
            if (max_age) filters.max_age = max_age;
            const { conditions, params, idx } = buildWhereClause(filters);
            const safeSortBy = VALID_SORT_BY.includes(sort_by) ? sort_by : 'created_at';
            const safeOrder = VALID_ORDER.includes(order) ? order.toUpperCase() : 'ASC';
            const result = await pool.query(`SELECT * FROM profiles ${conditions} ORDER BY ${safeSortBy} ${safeOrder}`, params);
            const cols = ['id','name','gender','gender_probability','age','age_group','country_id','country_name','country_probability','created_at'];
            let csv = cols.join(',') + '\n';
            for (const row of result.rows) {
                csv += cols.map(c => {
                    const val = row[c] == null ? '' : String(row[c]);
                    return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
                }).join(',') + '\n';
            }
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=profiles_export.csv');
            res.send(csv);
        } catch (error) {
            console.error('CSV export error:', error.message);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    });

    // GET /profiles — filter, sort, paginate (authenticated)
    router.get('/', authenticate, async (req, res) => {
        try {
            const { gender, age_group, country_id, min_age, max_age, min_gender_probability, min_country_probability, sort_by = 'created_at', order = 'asc', page = '1', limit = '10' } = req.query;
            if (sort_by && !VALID_SORT_BY.includes(sort_by)) return res.status(422).json({ status: 'error', message: 'Invalid query parameters' });
            if (order && !VALID_ORDER.includes(order)) return res.status(422).json({ status: 'error', message: 'Invalid query parameters' });
            if (gender && !VALID_GENDERS.includes(gender.toLowerCase())) return res.status(422).json({ status: 'error', message: 'Invalid query parameters' });
            if (age_group && !VALID_AGE_GROUPS.includes(age_group.toLowerCase())) return res.status(422).json({ status: 'error', message: 'Invalid query parameters' });
            if (min_age && isNaN(Number(min_age))) return res.status(422).json({ status: 'error', message: 'Invalid query parameters' });
            if (max_age && isNaN(Number(max_age))) return res.status(422).json({ status: 'error', message: 'Invalid query parameters' });
            if (min_gender_probability && !isFloat(min_gender_probability)) return res.status(422).json({ status: 'error', message: 'Invalid query parameters' });
            if (min_country_probability && !isFloat(min_country_probability)) return res.status(422).json({ status: 'error', message: 'Invalid query parameters' });
            const pageNum = parseInt(page); const limitNum = parseInt(limit);
            if (!isPositiveInt(page) || !isPositiveInt(limit)) return res.status(422).json({ status: 'error', message: 'Invalid query parameters' });
            if (limitNum > 50) return res.status(422).json({ status: 'error', message: 'Invalid query parameters' });
            const filters = { gender, age_group, country_id };
            if (min_age) filters.min_age = min_age;
            if (max_age) filters.max_age = max_age;
            if (min_gender_probability) filters.min_gender_probability = min_gender_probability;
            if (min_country_probability) filters.min_country_probability = min_country_probability;
            const { conditions, params, idx } = buildWhereClause(filters);
            const countResult = await pool.query(`SELECT COUNT(*) FROM profiles ${conditions}`, params);
            const total = parseInt(countResult.rows[0].count);
            const offset = (pageNum - 1) * limitNum;
            let i = idx;
            const result = await pool.query(
                `SELECT * FROM profiles ${conditions} ORDER BY ${sort_by} ${order.toUpperCase()} LIMIT $${i++} OFFSET $${i++}`,
                [...params, limitNum, offset]
            );
            res.status(200).json({ status: 'success', data: result.rows, pagination: makePagination(pageNum, limitNum, total) });
        } catch (error) {
            console.error('GET /profiles error:', error.message);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    });

    // GET /profiles/:id (authenticated)
    router.get('/:id', authenticate, async (req, res) => {
        try {
            const result = await pool.query('SELECT * FROM profiles WHERE id = $1', [req.params.id]);
            if (result.rows.length === 0) return res.status(404).json({ status: 'error', message: 'Profile not found' });
            res.status(200).json({ status: 'success', data: result.rows[0] });
        } catch (error) { res.status(500).json({ status: 'error', message: 'Internal server error' }); }
    });

    // DELETE /profiles/:id (admin only)
    router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
        try {
            const result = await pool.query('DELETE FROM profiles WHERE id = $1', [req.params.id]);
            if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Profile not found' });
            res.status(204).send();
        } catch (error) { res.status(500).json({ status: 'error', message: 'Internal server error' }); }
    });

    return router;
};
