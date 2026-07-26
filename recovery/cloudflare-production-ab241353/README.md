# Cloudflare Production Snapshot — ab241353

Bu klasör, `browsercs.com` üzerinde canlı olan Cloudflare Pages production
deploy’unun birebir kopyasıdır (2026-07-26 rollback sonrası canonical).

| Alan | Değer |
|------|--------|
| Deployment ID | `ab241353-457b-4882-b31d-e008bb7a3265` |
| URL | https://ab241353.cs-web-game.pages.dev |
| Alias | https://browsercs.com |
| Source commit | `6dd89ec` (`feature/vip-subscriptions`) |
| Captured | 2026-07-26 |

## İçerik
- HTML / JS / CSS / marketing assets / `wasm/` (mümkün olanlar)
- `MANIFEST.json` — Cloudflare’deki **tüm** dosya path → hash listesi (cs-assets dahil)
- `cs-assets/` bu klasöre indirilmedi; repoda `cs-web-game/public/cs-assets/` kullan
- `*.pk3` gitignore nedeniyle commit edilmeyebilir; hash’leri manifest’te

## Geri yükleme
```bash
npx wrangler pages deploy recovery/cloudflare-production-ab241353 \
  --project-name=cs-web-game --branch=main
```
(Eksik pk3/cs-assets için `cs-web-game/public` ile birleştir.)
