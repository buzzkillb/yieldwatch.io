# U.S. Treasury Yield Curve Dashboard

A real-time dashboard tracking U.S. Treasury yield curve rates with over 35 years of historical data and interactive charts.

![Dashboard Preview](https://via.placeholder.com/800x400/0a0a0f/6366f1?text=Treasury+Dashboard)

## Features

- **Daily Treasury Rates**: Real-time yield curve data from the U.S. Treasury Department
- **35+ Years of History**: Data spanning from 1990 to present (~9,000 trading days)
- **14 Maturities**: 4WK to 30YR spanning the entire yield curve
- **Interactive Chart**: Toggle individual maturities on/off, multiple time ranges (3M, 6M, 1Y, 2Y, 5Y, ALL)
- **Dark Theme**: Beautiful, eye-friendly dark interface
- **Rate Limited API**: 100 requests/minute to prevent abuse
- **Auto-Import**: On first run, automatically loads all historical data from Treasury archives
- **Self-Updating**: Scheduler checks every 15 minutes for new data after ~3:30 PM ET
- **Production Ready**: Docker Compose with Traefik + Cloudflare DNS + Let's Encrypt SSL

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | [Bun](https://bun.sh) |
| API Framework | [Elysia](https://elysia.dev) (TypeScript) |
| Database | [PostgreSQL 16](https://postgresql.org) |
| ORM | [Drizzle ORM](https://orm.drizzle.team) |
| Charts | [Chart.js](https://www.chartjs.org) |
| Reverse Proxy | [Traefik](https://traefik.io) |
| SSL | Let's Encrypt via Cloudflare DNS challenge |
| Container | Docker Compose |

## Prerequisites

- **Local**: Docker Desktop, Bun (optional for local development outside Docker)
- **Production**: VPS with Docker, domain name, Cloudflare account

## Quick Start (Local Development)

### 1. Clone and Setup

```bash
git clone <your-repo-url>
cd treasury
cp .env.example .env
```

The default `.env` is configured for local development with Docker.

### 2. Start Services

```bash
# Start all services (database, API, scheduler)
docker compose up -d

# Watch the scheduler load historical data (first run only - takes ~2-3 minutes)
docker compose logs -f scheduler
```

On first run, the scheduler will automatically:
1. Detect an empty database
2. Fetch all historical data from Treasury archives (1990-2026)
3. Start the daily update loop

### 3. Access Dashboard

- Dashboard: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:3000/api/rates/latest](http://localhost:3000/api/rates/latest)

## Production Deployment on Cloudflare VPS

### 1. VPS Setup

Ensure your VPS has Docker and Docker Compose installed:

```bash
# On Ubuntu 22.04+
sudo apt update && sudo apt upgrade -y
sudo apt install docker.io docker-compose -y
sudo systemctl start docker
sudo systemctl enable docker
```

### 2. Configure DNS in Cloudflare

1. Log into [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your domain
3. Go to **DNS** > **Records**
4. Add an A record:
   - Name: `@` (or your subdomain)
   - IPv4 address: `<your-vps-ip>`
   - Proxy status: **DNS only** (grey cloud) - will enable later
5. Go to **My Profile** > **API Tokens**
6. Create a custom token with:
   - Account: None
   - Zone: DNS > Edit
7. Copy the token

### 3. Configure Environment

```bash
cp .env.example .env
nano .env
```

Update these required values:

```env
# REQUIRED - Security
POSTGRES_USER=treasury
POSTGRES_PASSWORD=<generate-strong-password>  # See below

# REQUIRED - Production
NODE_ENV=production
ALLOWED_ORIGINS=https://yourdomain.com

# REQUIRED - Cloudflare SSL
CF_API_EMAIL=your@cloudflare-email.com
CF_API_TOKEN=<cloudflare-api-token>
DOMAIN=yourdomain.com
```

**Generate a strong password on Ubuntu:**

```bash
# Method 1: Using openssl (installed by default)
openssl rand -base64 32

# Method 2: Using /dev/urandom
head -c 32 /dev/urandom | base64

# Method 3: Using pwgen (install: apt install pwgen)
pwgen -s 32 1
```

Example output: `dGhpcyBpcyBhIHNhbXBsZSBwYXNzd29yZCBmb3IgZXhhbXBsZS4uLg==`

### 4. Create acme.json for Traefik

```bash
touch acme.json
chmod 600 acme.json
```

### 5. Deploy

```bash
# Start with production config (includes Traefik)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Watch Traefik logs for SSL certificate issuance
docker compose logs -f traefik
```

You should see: `"level":"info","msg":"certificate obtained successfully"`

### 6. Enable Cloudflare Proxy

Once SSL is working (2-5 minutes), go back to Cloudflare DNS settings and toggle the proxy to **ON** (orange cloud).

### 7. Verify

- Visit `https://yourdomain.com` - dashboard should load
- Visit `https://yourdomain.com/api/rates/latest` - API should respond

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_USER` | Yes | `treasury` | PostgreSQL username |
| `POSTGRES_PASSWORD` | **Yes** | - | PostgreSQL password (must be set) |
| `POSTGRES_DB` | No | `treasury` | Database name |
| `POSTGRES_HOST` | No | `db` | Database host |
| `POSTGRES_PORT` | No | `5432` | Database port |
| `PORT` | No | `3000` | API port |
| `NODE_ENV` | No | `development` | Set to `production` for prod |
| `ALLOWED_ORIGINS` | Prod | - | Comma-separated allowed CORS origins |
| `CRON_TZ` | No | `America/New_York` | Timezone for daily update check |
| `SCHEDULER_CRON_HOUR` | No | `16` | Hour to check for updates (24h format) |
| `SCHEDULER_CRON_MINUTE` | No | `30` | Minute to check for updates |
| `SCHEDULER_CHECK_INTERVAL_MS` | No | `900000` | Check interval when not at cron time (15 min) |
| `RATE_LIMIT_MAX` | No | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window (1 min) |
| `CF_API_EMAIL` | Prod | - | Cloudflare account email |
| `CF_API_TOKEN` | Prod | - | Cloudflare API token (Traefik v3) |
| `DOMAIN` | Prod | - | Your domain name |

## API Endpoints

All endpoints are rate-limited to 100 requests per minute per IP.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Dashboard UI |
| `GET` | `/health` | Health check |
| `GET` | `/api/rates/latest` | Most recent yield curve |
| `GET` | `/api/rates/stats` | Year highs/lows |
| `GET` | `/api/rates/maturities` | Available maturities |
| `GET` | `/api/rates?from=&to=&maturity=` | Historical data |

### Example Responses

**GET /api/rates/latest**
```json
{
  "success": true,
  "data": {
    "date": "2026-03-20",
    "dateFormatted": "March 20, 2026",
    "rates": [
      { "maturity": "4WK", "rate": 3.73 },
      { "maturity": "6WK", "rate": 3.71 },
      ...
    ]
  }
}
```

**GET /api/rates?from=2025-03-20&to=2026-03-20**
```json
{
  "success": true,
  "data": [
    { "date": "2025-03-20", "rates": [{ "maturity": "10YR", "rate": 4.05 }] },
    ...
  ],
  "meta": { "from": "2025-03-20", "to": "2026-03-20", "maturity": "all", "count": 211 }
}
```

## Data

- **Timestamps**: Stored as UTC (`TIMESTAMPTZ`)
- **Display**: Converted to browser's local timezone
- **Source**: U.S. Treasury Department Daily Yield Curve
- **Update Frequency**: Daily at ~3:30 PM ET (Treasury publish time)
- **Historical Data**: Automatically loaded on first run from Treasury archives

## Project Structure

```
treasury/
├── api/
│   ├── src/
│   │   ├── index.ts           # Elysia app entry point
│   │   ├── db/
│   │   │   ├── schema.ts      # Drizzle ORM schema
│   │   │   └── index.ts       # Database connection
│   │   ├── routes/
│   │   │   └── rates.ts       # API route handlers
│   │   ├── middleware/
│   │   │   └── rateLimit.ts   # Rate limiting (sliding window)
│   │   └── services/
│   │       ├── fetcher.ts     # Treasury XML/CSV fetch
│   │       └── scheduler.ts    # Cron job for daily updates
│   ├── public/
│   │   └── index.html         # Dashboard frontend
│   └── package.json
├── docker-compose.yml          # Local: db + api + scheduler
├── docker-compose.prod.yml    # Production: adds Traefik
├── traefik/
│   ├── traefik.yml           # Traefik static config
│   └── dynamic.yml           # Dynamic routing rules
├── .env.example              # Environment template
└── README.md
```

## Troubleshooting

### Database Connection Failed

```bash
# Check if PostgreSQL is running
docker compose ps db

# View logs
docker compose logs db

# Restart if needed
docker compose restart db
```

### Historical Data Not Loading

The scheduler handles this automatically on first run. To manually trigger:

```bash
# Restart scheduler (it will detect empty DB and re-import)
docker compose restart scheduler
docker compose logs -f scheduler
```

### Scheduler Not Updating

```bash
# Check scheduler logs
docker compose logs scheduler

# Verify CRON_TZ matches your timezone
# Treasury publishes at ~3:30 PM ET, so CRON_TZ=America/New_York
```

### Rate Limit Hit

The API allows 100 requests per minute per IP. If you hit the limit:

```bash
# Wait 60 seconds and try again
# The dashboard caches data locally, minimizing API calls
```

### SSL Certificate Issues

```bash
# Verify acme.json exists and has correct permissions
ls -la acme.json        # Should show: -rw-------
chmod 600 acme.json

# Check Traefik logs for ACME errors
docker compose logs traefik | grep -i acme
```

## Security Notes

- All credentials are loaded from `.env` - never hardcoded
- `POSTGRES_USER` and `POSTGRES_PASSWORD` are required
- API uses sliding window rate limiting (100 req/min per IP)
- CORS origins must be explicitly set in production via `ALLOWED_ORIGINS`
- Health endpoint does not expose environment information

## License

MIT
