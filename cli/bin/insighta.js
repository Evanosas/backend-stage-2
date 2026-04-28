#!/usr/bin/env node
const { Command } = require('commander');
const { startAuthFlow } = require('../lib/auth');
const { loadCredentials, clearCredentials } = require('../lib/config');
const { apiRequest } = require('../lib/api');

const program = new Command();
program.name('insighta').description('Insighta Labs+ CLI').version('1.0.0');

// ─── Login ───────────────────────────────────────────────────────────────────
program.command('login').description('Login via GitHub OAuth').action(async () => {
    try {
        const creds = await startAuthFlow();
        console.log(`✅ Logged in as ${creds.user.username} (${creds.user.role})`);
    } catch (err) { console.error('❌ Login failed:', err.message); process.exit(1); }
});

// ─── Logout ──────────────────────────────────────────────────────────────────
program.command('logout').description('Clear stored credentials').action(async () => {
    const creds = loadCredentials();
    if (creds) {
        try { await apiRequest('POST', '/api/v1/auth/logout', { refresh_token: creds.refresh_token }); } catch {}
    }
    clearCredentials();
    console.log('✅ Logged out');
});

// ─── Whoami ──────────────────────────────────────────────────────────────────
program.command('whoami').description('Show current user').action(async () => {
    try {
        const res = await apiRequest('GET', '/api/v1/auth/me');
        const u = res.data.data;
        console.log(`Username: ${u.username}\nRole: ${u.role}\nEmail: ${u.email || 'N/A'}\nID: ${u.id}`);
    } catch (err) { console.error('Error:', err.response?.data?.message || err.message); }
});

// ─── Profiles ────────────────────────────────────────────────────────────────
const profiles = program.command('profiles').description('Manage profiles');

profiles.command('list').description('List profiles')
    .option('-g, --gender <gender>', 'Filter by gender')
    .option('-c, --country <code>', 'Filter by country code')
    .option('-a, --age-group <group>', 'Filter by age group')
    .option('--min-age <n>', 'Minimum age')
    .option('--max-age <n>', 'Maximum age')
    .option('-s, --sort <field>', 'Sort by field', 'created_at')
    .option('-o, --order <dir>', 'Sort order', 'asc')
    .option('-p, --page <n>', 'Page number', '1')
    .option('-l, --limit <n>', 'Items per page', '10')
    .action(async (opts) => {
        try {
            const params = { sort_by: opts.sort, order: opts.order, page: opts.page, limit: opts.limit };
            if (opts.gender) params.gender = opts.gender;
            if (opts.country) params.country_id = opts.country;
            if (opts.ageGroup) params.age_group = opts.ageGroup;
            if (opts.minAge) params.min_age = opts.minAge;
            if (opts.maxAge) params.max_age = opts.maxAge;
            const res = await apiRequest('GET', '/api/v1/profiles', null, params);
            const d = res.data;
            console.log(`\nProfiles (Page ${d.pagination.page}/${d.pagination.total_pages}, Total: ${d.pagination.total})\n`);
            d.data.forEach(p => console.log(`  ${p.name} | ${p.gender} | ${p.age} | ${p.country_name} (${p.country_id})`));
            if (d.pagination.has_next) console.log(`\n→ Next page: insighta profiles list -p ${d.pagination.page + 1}`);
        } catch (err) { console.error('Error:', err.response?.data?.message || err.message); }
    });

profiles.command('search <query>').description('Natural language search')
    .option('-p, --page <n>', 'Page', '1').option('-l, --limit <n>', 'Limit', '10')
    .action(async (query, opts) => {
        try {
            const res = await apiRequest('GET', '/api/v1/profiles/search', null, { q: query, page: opts.page, limit: opts.limit });
            const d = res.data;
            if (d.status === 'error') { console.log(d.message); return; }
            console.log(`\nSearch: "${query}" (${d.pagination.total} results)\n`);
            d.data.forEach(p => console.log(`  ${p.name} | ${p.gender} | ${p.age} | ${p.country_name}`));
        } catch (err) { console.error('Error:', err.response?.data?.message || err.message); }
    });

profiles.command('get <id>').description('Get profile by ID').action(async (id) => {
    try {
        const res = await apiRequest('GET', `/api/v1/profiles/${id}`);
        console.log(JSON.stringify(res.data.data, null, 2));
    } catch (err) { console.error('Error:', err.response?.data?.message || err.message); }
});

profiles.command('create <name>').description('Create profile (admin only)').action(async (name) => {
    try {
        const res = await apiRequest('POST', '/api/v1/profiles', { name });
        console.log('✅ Created:', JSON.stringify(res.data.data, null, 2));
    } catch (err) { console.error('Error:', err.response?.data?.message || err.message); }
});

profiles.command('delete <id>').description('Delete profile (admin only)').action(async (id) => {
    try {
        await apiRequest('DELETE', `/api/v1/profiles/${id}`);
        console.log('✅ Deleted');
    } catch (err) { console.error('Error:', err.response?.data?.message || err.message); }
});

// ─── Export ──────────────────────────────────────────────────────────────────
program.command('export').description('Export profiles as CSV')
    .option('-g, --gender <gender>').option('-c, --country <code>').option('-o, --output <file>', 'Output file', 'profiles.csv')
    .action(async (opts) => {
        try {
            const params = {};
            if (opts.gender) params.gender = opts.gender;
            if (opts.country) params.country_id = opts.country;
            const res = await apiRequest('GET', '/api/v1/profiles/export/csv', null, params);
            require('fs').writeFileSync(opts.output, res.data);
            console.log(`✅ Exported to ${opts.output}`);
        } catch (err) { console.error('Error:', err.response?.data?.message || err.message); }
    });

program.parse();
