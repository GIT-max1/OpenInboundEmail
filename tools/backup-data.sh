#!/usr/bin/env bash
# backup-data.sh - create encrypted tarball of apps/server/data
set -euo pipefail
OUT_DIR=${OUT_DIR:-/var/backups/openinbound}
DATA_DIR=${DATA_DIR:-/opt/openinbound/apps/server/data}
KEY=${ADMIN_STORE_KEY:-}
mkdir -p "$OUT_DIR"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
TARFILE="$OUT_DIR/openinbound-data-$TIMESTAMP.tar.gz"
# create tar.gz
tar -czf "$TARFILE" -C "${DATA_DIR%/}" .
if [ -n "$KEY" ]; then
  # use openssl to encrypt the archive with AES-256-CBC
  openssl enc -aes-256-cbc -pbkdf2 -salt -in "$TARFILE" -out "$TARFILE".enc -pass env:ADMIN_STORE_KEY
  rm "$TARFILE"
  echo "$TARFILE.enc"
else
  echo "$TARFILE"
fi
