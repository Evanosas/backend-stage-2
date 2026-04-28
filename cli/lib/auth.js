const http = require('http');
const { URL } = require('url');
const { saveCredentials, API_URL } = require('./config');

function startAuthFlow() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, 'http://localhost:9876');
            if (url.pathname === '/callback') {
                const accessToken = url.searchParams.get('access_token');
                const refreshToken = url.searchParams.get('refresh_token');
                const userStr = url.searchParams.get('user');
                if (accessToken && refreshToken) {
                    let user = {};
                    try { user = JSON.parse(userStr); } catch {}
                    const creds = { access_token: accessToken, refresh_token: refreshToken, user };
                    saveCredentials(creds);
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<html><body><h1>✅ Login successful!</h1><p>You can close this tab and return to the terminal.</p></body></html>');
                    server.close();
                    resolve(creds);
                } else {
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end('<html><body><h1>❌ Login failed</h1></body></html>');
                    server.close();
                    reject(new Error('Missing tokens'));
                }
            }
        });
        server.listen(9876, () => {
            const authUrl = `${API_URL}/api/v1/auth/github?client=cli`;
            console.log(`\n🔗 Opening browser for GitHub login...\n`);
            console.log(`If the browser doesn't open, visit:\n${authUrl}\n`);
            import('open').then(mod => mod.default(authUrl)).catch(() => {
                console.log('Could not auto-open browser. Please visit the URL above.');
            });
        });
        // Timeout after 2 minutes
        setTimeout(() => { server.close(); reject(new Error('Login timeout')); }, 120000);
    });
}

module.exports = { startAuthFlow };
