# Orbit Advancement — Production Deployment Guide
**Version 1.0 · March 2026**

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20 LTS | Backend runtime |
| PostgreSQL | 15+ | Primary database |
| Redis | 7+ | Session store, rate limiting, queues |
| PM2 or Docker | Latest | Process management |

---

## Step 1: Server Setup (Ubuntu 22.04 LTS)

```bash
# System packages
sudo apt update && sudo apt upgrade -y
sudo apt install -y nodejs npm postgresql-15 redis-server nginx certbot python3-certbot-nginx

# Node version manager (optional but recommended)
npm install -g n && n 20

# PM2 for process management
npm install -g pm2

# Orbit backend dependencies
cd /var/www/orbit-backend
npm install --production
```

---

## Step 2: Database Setup

```bash
# Create production database and user
sudo -u postgres psql << EOF
CREATE USER orbit_user WITH PASSWORD 'STRONG_PASSWORD_HERE';
CREATE DATABASE orbit_prod OWNER orbit_user;
GRANT ALL PRIVILEGES ON DATABASE orbit_prod TO orbit_user;
\q
EOF

# Run migrations
cd /var/www/orbit-backend
psql -U orbit_user -d orbit_prod -f schema.sql

# Verify tables created
psql -U orbit_user -d orbit_prod -c "\dt"
```

---

## Step 3: Environment Configuration

```bash
# Copy template and fill in ALL values
cp .env.production.template .env

# CRITICAL: Set permissions — only owner can read
chmod 600 .env

# Verify .env is in .gitignore
echo ".env" >> .gitignore

# Generate secrets (run these commands, paste output into .env)
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
```

---

## Step 4: Nginx Reverse Proxy

```nginx
# /etc/nginx/sites-available/orbit-api
server {
    listen 80;
    server_name api.orbit.ai;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.orbit.ai;

    ssl_certificate     /etc/letsencrypt/live/api.orbit.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.orbit.ai/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer-when-downgrade always;
    add_header Content-Security-Policy "default-src 'self'" always;

    # Rate limiting at nginx level (belt-and-suspenders with app-level)
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;   # AI responses can take up to 30s
    }
}
```

```bash
# Enable site and get SSL certificate
sudo ln -s /etc/nginx/sites-available/orbit-api /etc/nginx/sites-enabled/
sudo certbot --nginx -d api.orbit.ai
sudo nginx -t && sudo systemctl reload nginx
```

---

## Step 5: Frontend Deployment

The frontend is a single-file HTML app (orbit-dashboard.html). Deploy it to any static host:

### Option A: Netlify (Recommended — free tier works)
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod --dir . --site-id YOUR_SITE_ID

# Set environment variable in Netlify dashboard:
# ORBIT_API_URL = https://api.orbit.ai
```

### Option B: AWS S3 + CloudFront
```bash
aws s3 cp orbit-dashboard.html s3://your-bucket/index.html \
  --content-type "text/html" \
  --cache-control "max-age=300"
```

### Option C: Same server as backend (simplest)
```bash
# Serve from nginx on the app domain
sudo mkdir -p /var/www/orbit-app
sudo cp orbit-dashboard.html /var/www/orbit-app/index.html
# Add nginx server block for app.orbit.ai pointing to /var/www/orbit-app
```

---

## Step 6: Start the Backend

```bash
# PM2 ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name:        'orbit-api',
    script:      'src/server.js',
    instances:   'max',           // One per CPU core
    exec_mode:   'cluster',
    env_production: {
      NODE_ENV:  'production',
      PORT:      3001,
    },
    error_file:  'logs/error.log',
    out_file:    'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    max_memory_restart: '512M',
  }]
};
EOF

# Start
pm2 start ecosystem.config.js --env production

# Save PM2 config so it restarts on server reboot
pm2 save
pm2 startup  # follow the instructions it prints
```

---

## Step 7: Health Check Verification

```bash
# API health
curl https://api.orbit.ai/health
# Expected: {"ok":true,"ts":"..."}

# Auth endpoint
curl -X POST https://api.orbit.ai/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@greenfield.edu","password":"test"}' 
# Expected: {"token":"...","user":{...}}

# AI proxy (requires valid token)
TOKEN=$(curl -s -X POST https://api.orbit.ai/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@greenfield.edu","password":"test"}' | jq -r '.token')

curl -X POST https://api.orbit.ai/api/v1/ai/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Say hello in one sentence","maxTokens":50}'
# Expected: {"text":"Hello! ...","usage":{...}}
```

---

## Step 8: Point Dashboard to Production Backend

In `orbit-dashboard.html`, find this line near the top:

```javascript
const API_BASE = window.ORBIT_API_BASE || 'http://localhost:3001/api/v1';
```

Change to:
```javascript
const API_BASE = window.ORBIT_API_BASE || 'https://api.orbit.ai/api/v1';
```

Or set `window.ORBIT_API_BASE` in a `<script>` tag before loading the app.

---

## Step 9: Set Up Automated Backups

```bash
# Daily database backup to S3
cat > /etc/cron.d/orbit-backup << EOF
0 2 * * * postgres pg_dump orbit_prod | gzip | aws s3 cp - s3://orbit-backups/db/$(date +%Y-%m-%d).sql.gz
EOF

# Verify backup runs
sudo crontab -l
```

---

## Step 10: Monitoring

### Sentry (error tracking — free tier)
```bash
# Add to .env
SENTRY_DSN=https://xxx@o0.ingest.sentry.io/0

# In server.js (already configured if DSN is set)
```

### Uptime monitoring — UptimeRobot (free)
- Monitor: `https://api.orbit.ai/health`
- Alert if down > 1 min
- Alert email: your team

### Log monitoring
```bash
# View live logs
pm2 logs orbit-api

# Search for errors in last hour
pm2 logs orbit-api --lines 1000 | grep ERROR
```

---

## Security Checklist (Before Going Live)

- [ ] All `.env` secrets are unique, generated (not defaults)
- [ ] `.env` permissions: `chmod 600 .env`
- [ ] `.env` is in `.gitignore` — verify with `git status`
- [ ] `DEMO_MODE=false` in production `.env`
- [ ] SSL certificate installed and auto-renewing (`certbot renew --dry-run`)
- [ ] Database not exposed to internet (firewall: postgres port 5432 localhost only)
- [ ] Redis not exposed to internet (firewall: redis port 6379 localhost only)
- [ ] API health check returns 200 from external URL
- [ ] AI proxy: verify Anthropic key is NOT in any client-side response
- [ ] Rate limiting: test by hitting `/api/v1/ai/generate` 61 times — should 429 on 61st
- [ ] Stripe webhook secret configured in `.env` and tested in Stripe dashboard
- [ ] Backups: run manual backup and confirm file appears in S3

---

## Estimated Monthly Infrastructure Cost

| Service | Tier | Monthly Cost |
|---------|------|-------------|
| VPS (DigitalOcean/Linode) | 2 vCPU, 4GB RAM | $24 |
| PostgreSQL (managed) | 1 vCPU, 1GB RAM | $15 |
| Redis (managed) | 25MB cache | $7 |
| S3 (backups + docs) | 10GB | $0.25 |
| SendGrid (email) | Essentials 50K/mo | $20 |
| Twilio SMS | Pay-as-you-go | $0.0075/SMS |
| Anthropic API | ~2M tokens/day | ~$180 |
| Netlify (frontend) | Free tier | $0 |
| Sentry (errors) | Free tier | $0 |
| **Total** | | **~$246/mo** |

At $499/mo Starter pricing, this gives ~51% gross margin on infrastructure before team costs.

---

## Support & Escalation

| Issue | Response |
|-------|----------|
| API down | PM2 auto-restarts; check `pm2 logs` |
| Database full | Expand volume, then `VACUUM ANALYZE` |
| Anthropic rate limit | Reduce `AI_DAILY_TOKEN_BUDGET`; add request queuing |
| High memory | Reduce `PM2 instances`, add swap |

**Emergency contact:** ops@orbit.ai · (617) 555-0190
