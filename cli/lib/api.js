const axios = require('axios');
const { loadCredentials, saveCredentials, API_URL } = require('./config');

async function refreshTokens(creds) {
    try {
        const res = await axios.post(`${API_URL}/api/v1/auth/refresh`, {
            refresh_token: creds.refresh_token
        }, { timeout: 10000 });
        const newCreds = {
            ...creds,
            access_token: res.data.data.access_token,
            refresh_token: res.data.data.refresh_token
        };
        saveCredentials(newCreds);
        return newCreds;
    } catch {
        console.error('Session expired. Please run: insighta login');
        process.exit(1);
    }
}

async function apiRequest(method, path, data = null, params = null) {
    let creds = loadCredentials();
    if (!creds || !creds.access_token) {
        console.error('Not logged in. Run: insighta login');
        process.exit(1);
    }

    const makeRequest = async (token) => {
        const config = {
            method, url: `${API_URL}${path}`, timeout: 15000,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        };
        if (data) config.data = data;
        if (params) config.params = params;
        return axios(config);
    };

    try {
        return await makeRequest(creds.access_token);
    } catch (err) {
        if (err.response && err.response.status === 401) {
            // Try refresh
            creds = await refreshTokens(creds);
            return await makeRequest(creds.access_token);
        }
        throw err;
    }
}

module.exports = { apiRequest };
