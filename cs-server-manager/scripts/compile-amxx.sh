#!/usr/bin/env bash
# BrowserCS AMXX compile — ONLY AMX Mod X 1.8.1/1.8.2 (server runtime).
# NEVER use AMXX 1.10 amxxpc on EC2 (/home/ubuntu/cstrike/.../amxxpc without
# the 182 tree) — produces Load error 17 and kills VIP on all servers.
#
# Usage (from Mac or any host with SSH key):
#   ./cs-server-manager/scripts/compile-amxx.sh browsercs_vip.sma
#   ./cs-server-manager/scripts/compile-amxx.sh browsercs_maprotate.sma
#   ./cs-server-manager/scripts/compile-amxx.sh --all
#   ./cs-server-manager/scripts/compile-amxx.sh --all --deploy
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
KEY="${BCS_SSH_KEY:-$REPO_ROOT/.agents/cs-key.pem}"
HOST="${BCS_SSH_HOST:-ubuntu@35.159.95.54}"
# Canonical 1.8.1-300 compiler (has amxxpc32.so). Do NOT use cstrike/.../amxxpc alone.
REMOTE_COMP="/home/ubuntu/browsercs-live-addons-20260715_103444/amxx182-root/addons/amxmodx/scripting"
REMOTE_PLUGINS="/home/ubuntu/cstrike/addons/amxmodx/plugins"
REMOTE_MGR_PLUGINS="/home/ubuntu/cs-server-manager/amxmodx/plugins"

DEPLOY=0
ALL=0
FILES=()

for arg in "$@"; do
  case "$arg" in
    --deploy) DEPLOY=1 ;;
    --all) ALL=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *.sma) FILES+=("$arg") ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [[ "$ALL" -eq 1 ]]; then
  FILES=(browsercs_vip.sma browsercs_maprotate.sma)
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "Usage: $0 <file.sma>|--all [--deploy]" >&2
  exit 2
fi

if [[ ! -f "$KEY" ]]; then
  echo "SSH key missing: $KEY" >&2
  exit 1
fi

SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=no "$HOST")
SCP=(scp -i "$KEY" -o StrictHostKeyChecking=no)

sanitize_to_tmp() {
  local src="$1"
  local dest="$2"
  python3 - "$src" "$dest" <<'PY'
import sys
from pathlib import Path
src, dest = Path(sys.argv[1]), Path(sys.argv[2])
text = src.read_text("utf-8")
repl = {
  "\u2014": "-", "\u2013": "-", "\u2192": "->", "\u201c": '"', "\u201d": '"',
  "\u2018": "'", "\u2019": "'", "\u2026": "...", "\u2500": "-",
  "ı": "i", "İ": "I", "ş": "s", "Ş": "S", "ğ": "g", "Ğ": "G",
  "ü": "u", "Ü": "U", "ö": "o", "Ö": "O", "ç": "c", "Ç": "C",
}
for a, b in repl.items():
  text = text.replace(a, b)
text = "".join(ch if ord(ch) < 128 else "?" for ch in text)
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(text, "ascii")
print(f"sanitized {src.name} -> {dest} ({len(text)} bytes)")
PY
}

echo "==> Using remote AMXX compiler: $REMOTE_COMP"
"${SSH[@]}" "test -x '$REMOTE_COMP/amxxpc' && test -f '$REMOTE_COMP/amxxpc32.so'"
BANNER="$("${SSH[@]}" "export LD_LIBRARY_PATH='$REMOTE_COMP'; cd '$REMOTE_COMP' && ./amxxpc 2>&1 | head -1" || true)"
echo "==> Compiler banner: $BANNER"
if ! echo "$BANNER" | grep -qE '1\.8\.[12]'; then
  echo "REFUSING: compiler is not AMXX 1.8.1/1.8.2 (got: $BANNER)" >&2
  echo "Do NOT compile with AMXX 1.10 — causes Load error 17 on live servers." >&2
  exit 1
fi

LOCAL_STAGE="$ROOT/amxmodx/scripting/_compile182"
mkdir -p "$LOCAL_STAGE"
REMOTE_STAGE="/tmp/bcs-amxx-compile-$$"
"${SSH[@]}" "mkdir -p '$REMOTE_STAGE' '$REMOTE_COMP/compiled'"

for f in "${FILES[@]}"; do
  base="$(basename "$f")"
  src="$ROOT/amxmodx/scripting/$base"
  if [[ ! -f "$src" ]]; then
    echo "Missing source: $src" >&2
    exit 1
  fi
  sanitize_to_tmp "$src" "$LOCAL_STAGE/$base"
  "${SCP[@]}" "$LOCAL_STAGE/$base" "$HOST:$REMOTE_STAGE/$base"

  echo "==> Compiling $base with AMXX 1.8.x ..."
  "${SSH[@]}" "export LD_LIBRARY_PATH='$REMOTE_COMP'; cd '$REMOTE_COMP' && \
    cp -f '$REMOTE_STAGE/$base' . && \
    rm -f compiled/${base%.sma}.amxx && \
    ./amxxpc '$base' -ocompiled/${base%.sma}.amxx && \
    test -f compiled/${base%.sma}.amxx && \
    SIZE=\$(stat -c%s compiled/${base%.sma}.amxx) && \
    echo SIZE=\$SIZE && \
    if [ \"\$SIZE\" -gt 22000 ] && [ \"$base\" = browsercs_vip.sma ]; then \
      echo 'REFUSING: output looks like AMXX 1.10 build' >&2; exit 1; \
    fi && \
    BANNER2=\$(./amxxpc 2>&1 | head -1) && echo \"OK \$BANNER2 -> compiled/${base%.sma}.amxx (\$SIZE bytes)\""

  # Pull artifact locally
  "${SCP[@]}" "$HOST:$REMOTE_COMP/compiled/${base%.sma}.amxx" "$ROOT/amxmodx/plugins/${base%.sma}.amxx"
  echo "==> Wrote $ROOT/amxmodx/plugins/${base%.sma}.amxx"
done

if [[ "$DEPLOY" -eq 1 ]]; then
  echo "==> Deploying to live cstrike plugins + restarting official servers"
  for f in "${FILES[@]}"; do
    base="$(basename "$f")"
    amxx="${base%.sma}.amxx"
    "${SCP[@]}" "$ROOT/amxmodx/plugins/$amxx" "$HOST:$REMOTE_PLUGINS/$amxx"
    "${SCP[@]}" "$ROOT/amxmodx/plugins/$amxx" "$HOST:$REMOTE_MGR_PLUGINS/$amxx"
  done
  "${SSH[@]}" 'for p in 27015 27016 27017 27018 27019 27020; do docker restart "cs15-$p" >/dev/null && echo restarted "$p"; done; sleep 3; \
    docker logs cs15-27015 2>&1 | grep -iE "BrowserCS VIP|Map Rotate|Load error 17" | tail -8; \
    docker logs cs15-27020 2>&1 | grep -iE "BrowserCS VIP|vipRoom|Load error 17" | tail -8'
fi

echo "Done."
