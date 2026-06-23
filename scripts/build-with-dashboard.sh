#!/usr/bin/env bash
# build-with-dashboard.sh
#
# Reviewable, NOT auto-triggered. Builds the landing site, builds the dashboard,
# merges dashboard output into the landing-page deploy dir under dist/dashboard/,
# then PRINTS (does not run) the manual wrangler deploy command.
#
# It deliberately does NOT call wrangler. Deploy stays a human step on uther-mini
# after Cloudflare Access is configured. See ../dashboard/deploy/INTEGRATION.md.
#
# Assumptions: run from the accoworks-dev repo root, with the dashboard repo checked
# out as a sibling at ../dashboard. node >= 22.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # accoworks-dev repo root
LANDING="$HERE"
DASHBOARD="$(cd "$HERE/../dashboard" && pwd)"

echo "==> landing-page repo : $LANDING"
echo "==> dashboard repo    : $DASHBOARD"

# 1. Build the landing site (produces $LANDING/dist)
echo "==> building accoworks-dev"
cd "$LANDING"
npm ci
npm run build

# 2. Build the dashboard (prebuild validator + base=/dashboard, produces $DASHBOARD/dist)
echo "==> building dashboard"
cd "$DASHBOARD"
npm ci
npm run build

# 3. Merge dashboard output into the landing deploy dir under /dashboard
echo "==> merging dashboard/dist -> accoworks-dev/dist/dashboard"
rm -rf "$LANDING/dist/dashboard"
mkdir -p "$LANDING/dist/dashboard"
cp -r "$DASHBOARD/dist/"* "$LANDING/dist/dashboard/"

# 4. Sanity checks (fail loudly rather than deploy a broken merge)
test -f "$LANDING/dist/dashboard/index.html" \
  || { echo "ERROR: dist/dashboard/index.html missing after merge"; exit 1; }
grep -q '/dashboard/_astro/' "$LANDING/dist/dashboard/index.html" \
  || { echo "ERROR: dashboard index.html does not reference /dashboard/_astro/ assets (base path wrong)"; exit 1; }
echo "==> merge OK: dist/dashboard/index.html present and base-prefixed"

# 5. Print (do NOT run) the deploy command. Human runs this on uther-mini AFTER
#    Cloudflare Access is configured and CLOUDFLARE_* env is set.
cat <<'EOF'

------------------------------------------------------------------
Build + merge complete. NOTHING has been deployed.

To deploy MANUALLY (uther-mini, after Cloudflare Access is live and
CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID=cbe88fc4554540cca4e0408f40372216
are set in the environment):

    npx wrangler pages deploy dist --project-name landing-page --branch main

Then verify the gate from a logged-out client BEFORE sharing the URL:

    curl -sI https://accoworks.dev/dashboard/ | head -n1            # expect 302 -> cloudflareaccess.com
    curl -sI https://landing-page.pages.dev/dashboard/ | head -n1   # expect 302, NOT 200
------------------------------------------------------------------
EOF
