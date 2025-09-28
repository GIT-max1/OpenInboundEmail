#!/usr/bin/env bash
# backup-data.sh - create encrypted tarball of apps/server/data
set -euo pipefail
OUT_DIR=${OUT_DIR:-/var/backups/openinbound}
DATA_DIR=${DATA_DIR:-/opt/openinbound/apps/server/data}
KEY=${ADMIN_STORE_KEY:-}
AGE_RECIPIENT=${AGE_RECIPIENT:-}
MODE=${MODE:-dev}
mkdir -p "$OUT_DIR"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
TARFILE="$OUT_DIR/openinbound-data-$TIMESTAMP.tar.gz"
# create tar.gz
tar -czf "$TARFILE" -C "${DATA_DIR%/}" .
if [ "$MODE" = 'prod' ] && [ -z "$KEY" ]; then
  echo "ERROR: ADMIN_STORE_KEY required in prod for backups" >&2
  exit 2
fi

if [ -n "$KEY" ] || [ -n "$AGE_RECIPIENT" ]; then
  # Prefer 'age' if a recipient is provided and the binary exists
  if [ -n "$AGE_RECIPIENT" ] && command -v age >/dev/null 2>&1; then
    age -r "$AGE_RECIPIENT" -o "$TARFILE".age "$TARFILE"
    rm "$TARFILE"
    echo "$TARFILE.age"
  else
    # Fallback to OpenSSL AEAD (AES-256-GCM) when available
    if openssl enc -aes-256-gcm -help >/dev/null 2>&1; then
      openssl enc -aes-256-gcm -pbkdf2 -salt -in "$TARFILE" -out "$TARFILE".enc -pass env:ADMIN_STORE_KEY
    else
      # Older OpenSSL might not support GCM; fallback to CBC but note it's weaker
      openssl enc -aes-256-cbc -pbkdf2 -salt -in "$TARFILE" -out "$TARFILE".enc -pass env:ADMIN_STORE_KEY
    fi
    rm "$TARFILE"
    echo "$TARFILE".enc
  fi
else
  echo "$TARFILE"
fi
