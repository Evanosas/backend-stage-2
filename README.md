# Insighta Labs — Demographic Intelligence API

A demographic query engine built with Node.js + Express, backed by PostgreSQL (Supabase), deployed on Vercel.

---

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/profiles` | Create a new profile via name (calls genderize/agify/nationalize) |
| `GET` | `/api/profiles` | List all profiles with filtering, sorting, and pagination |
| `GET` | `/api/profiles/search` | Natural language profile search |
| `GET` | `/api/profiles/:id` | Get a single profile by UUID |
| `DELETE` | `/api/profiles/:id` | Delete a profile |
| `GET` | `/api/health` | Health check |

---

## GET /api/profiles

Supports combining any of the following query parameters:

### Filters

| Parameter | Type | Example |
|-----------|------|---------|
| `gender` | `male` \| `female` | `gender=male` |
| `age_group` | `child` \| `teenager` \| `adult` \| `senior` | `age_group=adult` |
| `country_id` | ISO 3166-1 alpha-2 | `country_id=NG` |
| `min_age` | integer | `min_age=25` |
| `max_age` | integer | `max_age=45` |
| `min_gender_probability` | float 0–1 | `min_gender_probability=0.8` |
| `min_country_probability` | float 0–1 | `min_country_probability=0.5` |

### Sorting

| Parameter | Values | Default |
|-----------|--------|---------|
| `sort_by` | `age` \| `created_at` \| `gender_probability` | `created_at` |
| `order` | `asc` \| `desc` | `asc` |

### Pagination

| Parameter | Default | Max |
|-----------|---------|-----|
| `page` | `1` | — |
| `limit` | `10` | `50` |

### Example

```
GET /api/profiles?gender=male&country_id=NG&min_age=25&sort_by=age&order=desc&page=1&limit=10
```

---

## GET /api/profiles/search — Natural Language Query

### How It Works

The `/api/profiles/search?q=<query>` endpoint parses plain English queries into structured database filters using **rule-based pattern matching** — no AI, no LLMs.

The query string is lowercased, then scanned for known keyword patterns using regular expressions. Each pattern maps to one or more database filter conditions.

### Supported Keywords and Mappings

| Query Pattern | Filter Applied |
|---------------|----------------|
| `male` / `males` / `men` / `man` | `gender = male` |
| `female` / `females` / `women` / `woman` | `gender = female` |
| `young` | `min_age = 16`, `max_age = 24` |
| `child` / `children` | `age_group = child` |
| `teenager` / `teenagers` / `teen` / `teens` | `age_group = teenager` |
| `adult` / `adults` | `age_group = adult` |
| `senior` / `seniors` / `elderly` / `old` | `age_group = senior` |
| `above X` / `older than X` / `over X` | `min_age = X` |
| `below X` / `younger than X` / `under X` | `max_age = X` |
| `between X and Y` | `min_age = X`, `max_age = Y` |
| `aged X` / `age X` | `min_age = X`, `max_age = X` (exact) |
| `from <country>` / `in <country>` | `country_id = <ISO code>` (looked up from ~80-country map) |

### Example Queries

```
/api/profiles/search?q=young males from nigeria
→ gender=male, min_age=16, max_age=24, country_id=NG

/api/profiles/search?q=females above 30
→ gender=female, min_age=30

/api/profiles/search?q=adult males from kenya
→ gender=male, age_group=adult, country_id=KE

/api/profiles/search?q=male and female teenagers above 17
→ age_group=teenager, min_age=17

/api/profiles/search?q=people from angola
→ country_id=AO

/api/profiles/search?q=seniors in south africa
→ age_group=senior, country_id=ZA

/api/profiles/search?q=between 20 and 35
→ min_age=20, max_age=35
```

### Logic Flow

1. Lowercase and trim the query string
2. Detect gender keywords → set `gender` filter (if both male and female mentioned, gender filter is skipped)
3. Detect `young` → set `min_age=16, max_age=24`
4. Detect age group keywords → set `age_group` filter
5. Detect `between X and Y` → set `min_age` and `max_age`
6. Detect `aged X` → set exact age match
7. Detect `above/older than/over X` → set `min_age`
8. Detect `below/younger than/under X` → set `max_age`
9. Detect `from/in <country name>` → look up ISO code from country map → set `country_id`
10. If no filter was matched → return `{ "status": "error", "message": "Unable to interpret query" }`

Pagination (`page`, `limit`) applies to all search results.

---

## Limitations

The parser has the following known limitations:

1. **Country name must match exactly** — fuzzy matching is not supported. `"Naija"` will not resolve to `NG`. Only standard English country names from a predefined map (~80 countries) are recognized.

2. **`young` is not a stored age group** — it maps to ages 16–24 for query purposes only. Profiles in the database use `child`, `teenager`, `adult`, `senior`.

3. **No negation support** — queries like `"not from Nigeria"` or `"males excluding seniors"` are not interpreted.

4. **No OR logic across filters** — all conditions are ANDed. `"males or females from kenya"` becomes just `country_id=KE` (gender is skipped when both are mentioned).

5. **No compound age words** — `"thirties"`, `"middle-aged"`, `"twenties"` are not recognized.

6. **Single age group per query** — if both `teenager` and `adult` appear in the query, whichever was matched last wins.

7. **No typo correction** — `"nigria"` or `"namiiba"` will not be resolved.

8. **No context memory** — each query is stateless and parsed from scratch.

9. **`from/in` must precede the country name** — `"south africa people"` will not match; it must be `"people from south africa"`.

10. **No support for continent-level queries** — `"people from Africa"` or `"from West Africa"` will not resolve to any country filter.

---

## Error Responses

All errors follow this format:
```json
{ "status": "error", "message": "<description>" }
```

| Status | Meaning |
|--------|---------|
| `400` | Missing or empty required parameter |
| `404` | Profile not found |
| `422` | Invalid parameter type or value |
| `500` | Internal server error |

---

## Database Schema

```sql
CREATE TABLE profiles (
  id                  VARCHAR PRIMARY KEY,        -- UUID v7
  name                VARCHAR UNIQUE NOT NULL,    -- Lowercase full name
  gender              VARCHAR,                    -- 'male' or 'female'
  gender_probability  FLOAT,
  age                 INT,
  age_group           VARCHAR,                    -- child | teenager | adult | senior
  country_id          VARCHAR(2),                 -- ISO 3166-1 alpha-2 code
  country_name        VARCHAR,
  country_probability FLOAT,
  created_at          TIMESTAMP DEFAULT NOW()
);
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Supabase) |
