# Insighta Labs+ — Secure Demographic Intelligence API

A demographic intelligence platform with GitHub OAuth (PKCE), role-based access control, and multi-interface support (API, CLI, Web Portal). Built with Node.js + Express, backed by PostgreSQL (Supabase), deployed on Vercel.

**Live Backend URL:** https://backendstage1-api.vercel.app

---

## System Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐
│  CLI Tool    │     │  Web Portal  │     │  Direct API Client   │
│  (Bearer)    │     │  (Cookies)   │     │  (Bearer Token)      │
└──────┬───────┘     └──────┬───────┘     └──────────┬───────────┘
       │                    │                        │
       └────────────────────┼────────────────────────┘
                            │
                   ┌────────▼────────┐
                   │  Express API    │
                   │  /api/v1/*      │
                   ├─────────────────┤
                   │ Rate Limiter    │
                   │ Request Logger  │
                   │ CSRF Protection │
                   │ JWT Auth        │
                   │ RBAC Middleware  │
                   └────────┬────────┘
                            │
                   ┌────────▼────────┐
                   │  PostgreSQL     │
                   │  (Supabase)     │
                   └─────────────────┘
```

### Components
- **Backend API** (this repo): Express.js REST API with GitHub OAuth, JWT auth, RBAC
- **CLI Tool** (insighta-cli repo): Globally installable Node.js CLI with PKCE auth
- **Web Portal** (insighta-web-portal repo): Browser-based dashboard with cookie auth + CSRF

---

## Authentication Flow

### GitHub OAuth with PKCE

1. Client initiates login → backend generates `code_verifier` + `code_challenge` (S256)
2. User redirected to GitHub authorize URL with `code_challenge`
3. GitHub redirects back with `code` → backend exchanges it with `code_verifier`
4. Backend fetches GitHub user profile, creates/updates user in DB
5. Backend issues JWT access token (15min) + refresh token (7 days)

### Token Delivery by Client Type

| Client | Access Token | Refresh Token | CSRF |
|--------|-------------|---------------|------|
| **CLI** | JSON response body | JSON response body | N/A |
| **Web Portal** | HTTP-only cookie | HTTP-only cookie | Non-HTTP-only cookie |
| **API** | Bearer header | Request body | N/A |

### Token Refresh
- `POST /api/v1/auth/refresh` with refresh token → new access + refresh token pair
- Old refresh token is invalidated (rotation)
- Refresh tokens are SHA-256 hashed before DB storage

---

## Token Handling Approach

- **Access tokens**: JWT signed with `JWT_SECRET`, 15-minute expiry, payload contains `{ userId, role, githubUsername }`
- **Refresh tokens**: Random 64-byte hex strings, hashed (SHA-256) before database storage, 7-day expiry
- **Token rotation**: Each refresh invalidates the old token and issues a new pair
- **Storage**: CLI stores tokens in `~/.insighta/credentials.json`; Web Portal uses HTTP-only cookies
- **Extraction**: Middleware checks `Authorization: Bearer <token>` header first, then falls back to cookies

---

## Role Enforcement Logic

Two roles: **admin** and **analyst**

### Role Assignment
- First registered user automatically becomes `admin`
- Users matching `DEFAULT_ADMIN_GITHUB_ID` env var become `admin`
- All other users default to `analyst`
- Admins can change any user's role via `PATCH /api/v1/admin/users/:id/role`

### Endpoint Permissions

| Endpoint | Method | Admin | Analyst |
|----------|--------|-------|---------|
| `/api/v1/profiles` | GET | ✅ | ✅ |
| `/api/v1/profiles` | POST | ✅ | ❌ |
| `/api/v1/profiles/:id` | GET | ✅ | ✅ |
| `/api/v1/profiles/:id` | DELETE | ✅ | ❌ |
| `/api/v1/profiles/search` | GET | ✅ | ✅ |
| `/api/v1/profiles/export/csv` | GET | ✅ | ✅ |
| `/api/v1/auth/*` | ALL | ✅ | ✅ |
| `/api/v1/admin/users` | GET | ✅ | ❌ |
| `/api/v1/admin/users/:id/role` | PATCH | ✅ | ❌ |
| `/api/v1/admin/logs` | GET | ✅ | ❌ |

Enforcement is done via `authorize('admin')` middleware that returns 403 for unauthorized roles.

---

## API Endpoints (v1)

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/auth/github` | Start GitHub OAuth + PKCE flow |
| `GET` | `/api/v1/auth/github/callback` | OAuth callback handler |
| `POST` | `/api/v1/auth/refresh` | Refresh access token |
| `POST` | `/api/v1/auth/logout` | Invalidate refresh token |
| `GET` | `/api/v1/auth/me` | Get current user profile |

### Profiles (authenticated)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/profiles` | Create profile (admin only) |
| `GET` | `/api/v1/profiles` | List profiles with filtering/sorting/pagination |
| `GET` | `/api/v1/profiles/search` | Natural language search |
| `GET` | `/api/v1/profiles/:id` | Get single profile |
| `DELETE` | `/api/v1/profiles/:id` | Delete profile (admin only) |
| `GET` | `/api/v1/profiles/export/csv` | Export profiles as CSV |

### Admin (admin only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/admin/users` | List all users |
| `PATCH` | `/api/v1/admin/users/:id/role` | Change user role |
| `GET` | `/api/v1/admin/logs` | View request logs |

### System
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/v1/health` | V1 health check |

---

## Updated Pagination Shape

All paginated endpoints return:
```json
{
  "status": "success",
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 250,
    "total_pages": 25,
    "has_next": true,
    "has_prev": false
  }
}
```

---

## Natural Language Search

The `/api/v1/profiles/search?q=<query>` endpoint parses plain English queries into structured database filters using **rule-based pattern matching** — no AI, no LLMs.

### Supported Patterns
| Query Pattern | Filter Applied |
|---------------|----------------|
| `male` / `men` | `gender = male` |
| `female` / `women` | `gender = female` |
| `young` | `min_age = 16`, `max_age = 24` |
| `child` / `teenager` / `adult` / `senior` | `age_group = <value>` |
| `above X` / `older than X` / `over X` | `min_age = X` |
| `below X` / `younger than X` / `under X` | `max_age = X` |
| `between X and Y` | `min_age = X`, `max_age = Y` |
| `from <country>` / `in <country>` | `country_id = <ISO code>` |

### Example
```
GET /api/v1/profiles/search?q=young males from nigeria
→ gender=male, min_age=16, max_age=24, country_id=NG
```

---

## CLI Usage

### Install
```bash
npm install -g insighta-cli
```

### Commands
```bash
insighta login              # Authenticate via GitHub OAuth (opens browser)
insighta logout             # Clear stored credentials
insighta whoami             # Show current user info
insighta profiles list      # List profiles (supports --gender, --country, --page, --limit)
insighta profiles search "young males from nigeria"
insighta profiles get <id>  # Get single profile
insighta profiles create <name>  # Create profile (admin only)
insighta profiles delete <id>    # Delete profile (admin only)
insighta export --format csv     # Export profiles as CSV
```

### Credential Storage
Tokens are stored at `~/.insighta/credentials.json` with auto-refresh on expiry.

---

## Rate Limiting

| Scope | Limit |
|-------|-------|
| General API | 100 requests / 15 min per IP |
| Auth endpoints | 20 requests / 15 min per IP |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Supabase) |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `JWT_SECRET` | Secret for signing JWT access tokens |
| `BACKEND_URL` | Backend URL (for OAuth callback) |
| `WEB_PORTAL_URL` | Web portal URL (for CORS + redirect) |
| `DEFAULT_ADMIN_GITHUB_ID` | GitHub user ID to auto-assign admin role |

---

## Database Schema

```sql
-- Profiles (Stage 2)
CREATE TABLE profiles (
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
);

-- Users (Stage 3)
CREATE TABLE users (
  id          VARCHAR PRIMARY KEY,
  github_id   BIGINT UNIQUE NOT NULL,
  username    VARCHAR NOT NULL,
  email       VARCHAR,
  avatar_url  VARCHAR,
  role        VARCHAR DEFAULT 'analyst',
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- Refresh Tokens (Stage 3)
CREATE TABLE refresh_tokens (
  id          VARCHAR PRIMARY KEY,
  user_id     VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Request Logs (Stage 3)
CREATE TABLE request_logs (
  id            VARCHAR PRIMARY KEY,
  user_id       VARCHAR,
  method        VARCHAR NOT NULL,
  path          VARCHAR NOT NULL,
  status_code   INT,
  response_time INT,
  ip_address    VARCHAR,
  user_agent    VARCHAR,
  created_at    TIMESTAMP DEFAULT NOW()
);
```
