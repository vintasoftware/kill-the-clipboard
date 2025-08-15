#!/usr/bin/env bash
set -euo pipefail

# Inputs
DOCS_DIR=${1:-docs}
BASE_URL=${2:-""}

# Normalize base URL (no trailing slash)
BASE_URL=${BASE_URL%/}

# Collect versions from tags (v*.*.*) and include "latest"
VERSIONS=("latest")
while IFS= read -r tag; do
  VERSIONS+=("${tag}")
done < <(git tag --list 'v*.*.*' --sort=-creatordate)

# Build JSON array
OUTPUT="["
FIRST=1
for ver in "${VERSIONS[@]}"; do
  url_suffix="/${ver}/"
  # Construct absolute or relative URL
  if [[ -n "$BASE_URL" ]]; then
    url="${BASE_URL}${url_suffix}"
  else
    url="${url_suffix}"
  fi

  if [[ $FIRST -eq 0 ]]; then
    OUTPUT+=" ,"
  fi
  OUTPUT+=" { \"label\": \"${ver}\", \"url\": \"${url}\" }"
  FIRST=0
done
OUTPUT+="]"

mkdir -p "${DOCS_DIR}"
echo "${OUTPUT}" > "${DOCS_DIR}/versions.json"
echo "Wrote ${DOCS_DIR}/versions.json: ${OUTPUT}"

# Generate a root redirect index.html to point to latest docs
# This will be deployed to the gh-pages root by the CI workflow
ROOT_REDIRECT_DIR="${DOCS_DIR}-root"
mkdir -p "${ROOT_REDIRECT_DIR}"

REDIRECT_URL="/latest/"

cat > "${ROOT_REDIRECT_DIR}/index.html" <<EOF
<!DOCTYPE html>
<html>
  <head>
    <title>Redirecting...</title>
    <link rel="canonical" href="${REDIRECT_URL}" />
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0; url=${REDIRECT_URL}" />
  </head>
  <body>
    <p>Redirecting...</p>
  </body>
</html>
EOF

echo "Wrote ${ROOT_REDIRECT_DIR}/index.html redirecting to ${REDIRECT_URL}"
