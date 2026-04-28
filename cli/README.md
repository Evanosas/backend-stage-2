# Insighta Labs+ CLI

Command-line interface for the Insighta Labs+ Demographic Intelligence API.

## Install

```bash
npm install -g insighta-cli
# or run directly
npx insighta-cli
```

## Authentication

Uses GitHub OAuth with PKCE flow:

```bash
insighta login    # Opens browser for GitHub login
insighta logout   # Clears stored credentials
insighta whoami   # Shows current user info
```

Credentials are stored at `~/.insighta/credentials.json`.

## Commands

```bash
# List profiles with filters
insighta profiles list --gender male --country NG --page 1 --limit 10

# Natural language search
insighta profiles search "young males from nigeria"

# Get/create/delete profiles
insighta profiles get <id>
insighta profiles create <name>    # admin only
insighta profiles delete <id>      # admin only

# Export to CSV
insighta export --output profiles.csv
```

## Token Handling

- Access tokens (JWT, 15min expiry) are auto-refreshed on 401 responses
- Refresh tokens (7-day expiry) enable seamless re-authentication
- All tokens stored locally at `~/.insighta/credentials.json`
