# Orbit CI/CD Setup Guide

## Overview

Pipeline: `.github/workflows/ci-cd.yml`

Every PR → **lint → tests → docker build**
Push to `staging` → auto-deploys to staging
Push to `main` → requires human approval → deploys to production

---

## Step 1: GitHub Repository Secrets

Repo → Settings → Secrets and variables → Actions → New repository secret

### Staging Server
```
STAGING_HOST    IP or hostname (e.g. 138.197.x.x)
STAGING_USER    SSH username (e.g. deploy)
STAGING_SSH_KEY Full private key content
```
Generate SSH key: `ssh-keygen -t ed25519 -C "github-ci-staging"`

### Production Server
```
PROD_HOST    IP or hostname
PROD_USER    SSH username
PROD_SSH_KEY Private key (different from staging)
```

### Slack (optional)
```
SLACK_WEBHOOK_URL   From Slack: Apps → Incoming Webhooks
```

---

## Step 2: GitHub Environments

Repo → Settings → Environments

**staging**: No protection rules (auto-deploys)

**production**:
- Enable Required reviewers (add yourself + 1 other)
- This means someone must click Approve in GitHub before prod deploys

---

## Step 3: Server Setup (run on each server)

```bash
# Create deploy user
adduser deploy && usermod -aG docker deploy

# Add CI public key
mkdir -p /home/deploy/.ssh
echo "YOUR_PUBLIC_KEY" >> /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys && chmod 700 /home/deploy/.ssh

# Create app dir
mkdir -p /var/www/orbit && chown deploy:deploy /var/www/orbit

# Install Docker
curl -fsSL https://get.docker.com | sh

# Copy files
scp docker-compose.yml .env deploy@YOUR_SERVER:/var/www/orbit/

# Login to GitHub Container Registry
echo "GITHUB_PAT" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin

# First start
cd /var/www/orbit && docker compose up -d
```

---

## Step 4: Branch Protection

Repo → Settings → Branches → Add rule for `main`:
- Require PR before merging
- Require status checks: "Tests", "Lint & Audit"
- Restrict who can push

---

## Deployment Flow

```
PR opened
  → lint (2 min)
  → tests with Postgres + Redis (4 min)
  → docker build + security scan (5 min)

Merge to staging  → auto-deploys to staging
Merge to main     → REQUIRES APPROVAL → deploys prod
                     → GitHub Release created
                     → Slack notification
```

---

## Rollback

```bash
# Option 1: git revert (preferred — triggers CI/CD)
git revert HEAD && git push origin main

# Option 2: Manual on server
ssh deploy@PROD_HOST
cd /var/www/orbit
# Images are tagged rollback-YYYYMMDDHHMI before each deploy
docker tag ghcr.io/ORG/orbit-api:rollback-20260308 ghcr.io/ORG/orbit-api:latest
pm2 reload orbit-api
```

---

## Monitoring After Deploy

```bash
docker compose logs -f api
curl https://api.orbit.ai/health
docker compose logs api --since 5m | grep '"level":"error"'
```
