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


