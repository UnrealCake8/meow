#!/usr/bin/env bash
set -euo pipefail
: "${BACKUP_DIR:?Set BACKUP_DIR to a secure directory outside the repository}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
file="$BACKUP_DIR/asanib-cloud-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker exec asanib-cloud-postgres-1 pg_dump -U asanib -d asanib_cloud -Fc > "$file"
chmod 600 "$file"
echo "Backup saved: $file"
