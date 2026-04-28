# Insighta Labs+ Web Portal

Browser-based dashboard for the Insighta Labs+ Demographic Intelligence Platform.

## Features

- **GitHub OAuth login** with HTTP-only cookie session management
- **CSRF protection** on all mutating requests
- **Profile browsing** with filtering, sorting, and pagination
- **Natural language search** (e.g., "young males from nigeria")
- **CSV export** of filtered profiles
- **Admin panel** (admin role only) — manage users and view request logs

## Running Locally

```bash
npm run dev
# Opens on http://localhost:3000
```

## Authentication Flow

1. User clicks "Login with GitHub"
2. Backend handles OAuth, sets HTTP-only cookies (access_token, refresh_token)
3. A non-HTTP-only csrf_token cookie is set for CSRF protection
4. All API requests include credentials and X-CSRF-Token header
