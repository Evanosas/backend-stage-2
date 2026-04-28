const API = 'https://backendstage1-api.vercel.app';
let currentUser = null;
let profilesPage = 1;
let searchPage = 1;

// ─── Auth ────────────────────────────────────────────────────────────────────
function startLogin() {
    window.location.href = `${API}/api/v1/auth/github?client=web`;
}

function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2] : null;
}

function getCSRF() { return getCookie('csrf_token'); }

async function api(method, path, body = null, params = null) {
    const opts = {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    };
    const csrf = getCSRF();
    if (csrf) opts.headers['X-CSRF-Token'] = csrf;
    if (body) opts.body = JSON.stringify(body);
    let url = `${API}${path}`;
    if (params) {
        const sp = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => { if (v) sp.set(k, v); });
        if (sp.toString()) url += '?' + sp.toString();
    }
    const res = await fetch(url, opts);
    if (res.status === 401) {
        // Try refresh
        const refreshRes = await fetch(`${API}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
        if (refreshRes.ok) {
            const retryRes = await fetch(url, opts);
            if (retryRes.status === 204) return {};
            return retryRes.json();
        }
        showPage('login'); return null;
    }
    if (res.status === 204) return {};
    return res.json();
}

async function checkAuth() {
    try {
        const data = await api('GET', '/api/v1/auth/me');
        if (data && data.status === 'success') {
            currentUser = data.data;
            document.getElementById('user-name').textContent = currentUser.username;
            const badge = document.getElementById('user-badge');
            badge.textContent = currentUser.role;
            badge.className = `badge badge-${currentUser.role}`;
            if (currentUser.role === 'admin') {
                document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
            }
            showPage('dashboard');
            loadProfiles();
            return;
        }
    } catch {}
    showPage('login');
}

async function doLogout() {
    await api('POST', '/api/v1/auth/logout');
    currentUser = null;
    showPage('login');
}

// ─── Navigation ──────────────────────────────────────────────────────────────
function showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`${name}-page`).classList.add('active');
}

document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        const page = link.dataset.page;
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById(`${page}-section`).classList.add('active');
    });
});

// ─── Profiles ────────────────────────────────────────────────────────────────
async function loadProfiles(page = 1) {
    profilesPage = page;
    const params = {
        page: String(page), limit: '10',
        sort_by: document.getElementById('filter-sort').value,
        order: document.getElementById('filter-order').value,
        gender: document.getElementById('filter-gender').value,
        age_group: document.getElementById('filter-age-group').value,
        country_id: document.getElementById('filter-country').value
    };
    const data = await api('GET', '/api/v1/profiles', null, params);
    if (!data || data.status !== 'success') return;
    renderTable('profiles-table-container', data.data, [
        { key: 'name', label: 'Name' }, { key: 'gender', label: 'Gender' },
        { key: 'age', label: 'Age' }, { key: 'age_group', label: 'Group' },
        { key: 'country_name', label: 'Country' }, { key: 'gender_probability', label: 'Gender Prob', fmt: v => v ? (v * 100).toFixed(0) + '%' : '-' }
    ]);
    renderPagination('profiles-pagination', data.pagination, loadProfiles);
}

// ─── Search ──────────────────────────────────────────────────────────────────
async function doSearch(page = 1) {
    searchPage = page;
    const q = document.getElementById('search-input').value;
    if (!q) return;
    const data = await api('GET', '/api/v1/profiles/search', null, { q, page: String(page), limit: '10' });
    if (!data) return;
    if (data.status === 'error') {
        document.getElementById('search-results').innerHTML = `<p style="color:var(--text-muted)">${data.message}</p>`;
        return;
    }
    renderTable('search-results', data.data, [
        { key: 'name', label: 'Name' }, { key: 'gender', label: 'Gender' },
        { key: 'age', label: 'Age' }, { key: 'country_name', label: 'Country' }
    ]);
    renderPagination('search-pagination', data.pagination, doSearch);
}

// ─── Admin ───────────────────────────────────────────────────────────────────
function showAdminTab(tab) {
    document.querySelectorAll('.admin-tabs .tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.admin-tabs .tab[onclick*="${tab}"]`).classList.add('active');
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`admin-${tab}`).classList.add('active');
    if (tab === 'users') loadUsers();
    if (tab === 'logs') loadLogs();
}

async function loadUsers() {
    const data = await api('GET', '/api/v1/admin/users');
    if (!data || data.status !== 'success') return;
    let html = '<table class="data-table"><thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Action</th></tr></thead><tbody>';
    data.data.forEach(u => {
        const roleOpts = `<select onchange="changeRole('${u.id}',this.value)" style="background:var(--bg);color:var(--text);border:1px solid var(--border);padding:0.3rem;border-radius:4px">
            <option value="analyst" ${u.role === 'analyst' ? 'selected' : ''}>analyst</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option></select>`;
        html += `<tr><td>${u.username}</td><td>${u.email || '-'}</td><td><span class="badge badge-${u.role}">${u.role}</span></td><td>${roleOpts}</td></tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('admin-users').innerHTML = html;
}

async function changeRole(userId, role) {
    await api('PATCH', `/api/v1/admin/users/${userId}/role`, { role });
    loadUsers();
}

async function loadLogs() {
    const data = await api('GET', '/api/v1/admin/logs', null, { limit: '20' });
    if (!data || data.status !== 'success') return;
    let html = '<table class="data-table"><thead><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Duration</th></tr></thead><tbody>';
    data.data.forEach(l => {
        html += `<tr><td>${new Date(l.created_at).toLocaleString()}</td><td>${l.method}</td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">${l.path}</td><td>${l.status_code || '-'}</td><td>${l.response_time || '-'}ms</td></tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('admin-logs').innerHTML = html;
}

// ─── CSV Export ──────────────────────────────────────────────────────────────
async function exportCSV() {
    const params = new URLSearchParams({
        gender: document.getElementById('filter-gender').value,
        country_id: document.getElementById('filter-country').value
    });
    window.open(`${API}/api/v1/profiles/export/csv?${params.toString()}`, '_blank');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function renderTable(containerId, rows, columns) {
    if (!rows.length) {
        document.getElementById(containerId).innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem">No results found</p>';
        return;
    }
    let html = '<table class="data-table"><thead><tr>';
    columns.forEach(c => html += `<th>${c.label}</th>`);
    html += '</tr></thead><tbody>';
    rows.forEach(row => {
        html += '<tr>';
        columns.forEach(c => {
            const val = c.fmt ? c.fmt(row[c.key]) : (row[c.key] ?? '-');
            html += `<td>${val}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody></table>';
    document.getElementById(containerId).innerHTML = html;
}

function renderPagination(containerId, pag, loadFn) {
    if (!pag || pag.total_pages <= 1) { document.getElementById(containerId).innerHTML = ''; return; }
    document.getElementById(containerId).innerHTML = `
        <button ${pag.has_prev ? '' : 'disabled'} onclick="(${loadFn.name})(${pag.page - 1})">← Prev</button>
        <span class="page-info">Page ${pag.page} of ${pag.total_pages} (${pag.total} total)</span>
        <button ${pag.has_next ? '' : 'disabled'} onclick="(${loadFn.name})(${pag.page + 1})">Next →</button>`;
}

// ─── Init ────────────────────────────────────────────────────────────────────
checkAuth();
