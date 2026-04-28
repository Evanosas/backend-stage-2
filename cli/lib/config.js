const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.insighta');
const CREDS_FILE = path.join(CONFIG_DIR, 'credentials.json');
const API_URL = 'https://backendstage1-api.vercel.app';

function ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function loadCredentials() {
    ensureConfigDir();
    if (!fs.existsSync(CREDS_FILE)) return null;
    try { return JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8')); }
    catch { return null; }
}

function saveCredentials(data) {
    ensureConfigDir();
    fs.writeFileSync(CREDS_FILE, JSON.stringify(data, null, 2));
}

function clearCredentials() {
    if (fs.existsSync(CREDS_FILE)) fs.unlinkSync(CREDS_FILE);
}

module.exports = { CONFIG_DIR, CREDS_FILE, API_URL, loadCredentials, saveCredentials, clearCredentials };
