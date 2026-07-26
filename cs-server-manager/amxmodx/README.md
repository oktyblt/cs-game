# BrowserCS AMXX plugins

**Runtime:** AMX Mod X **1.8.2** on all game containers (shared `/home/ubuntu/cstrike`).

## Compile (required)

Do **not** use AMXX 1.10. It breaks live plugins (`Load error 17`).

```bash
# from repo root
./cs-server-manager/scripts/compile-amxx.sh --all --deploy
```

Script uses the pinned 1.8.1-300 compiler on EC2, sanitizes SMA to ASCII, size-checks output, installs into `cstrike/addons/amxmodx/plugins/`, and restarts official servers when `--deploy` is set.

## Sources

- `scripting/*.sma` — edit here (UTF-8 OK in comments; compile path sanitizes)
- `plugins/*.amxx` — build artifacts from the 1.8.x script only
