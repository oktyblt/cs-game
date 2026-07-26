# BrowserCS Full Recovery — 2026-07-26

Mac local kaybı sonrası tüm canlı kaynakların kurtarma kaydı.

## Kaynak durumu

| Kaynak | Konum | Son tarih | Not |
|--------|--------|-----------|-----|
| Frontend source | `cs-web-game/` (branch base: `feature/vip-subscriptions`) | 2026-07-22 | GitHub’daki en güncel kaynak |
| Frontend live build | `recovery/cloudflare-live-snapshot-20260726/` | 2026-07-26 | Cloudflare Pages canlı HTML/JS/CSS snapshot |
| Backend live | `cs-server-manager/` | 2026-07-23 | AWS `35.159.95.54` üzerindeki canlı kod |
| AWS deploy yedekleri | `recovery/aws-20260726/` | 2026-07-20… | deploy-backup-*, rankings, server_configs, AMXX addons |
| Secrets | Cursor artifacts (git’te yok) | — | `.env` + SSH key |

## Cloudflare

- Pages proje adı: `cs-web-game` (`cs-web-game/wrangler.toml`)
- Canlı site: https://browsercs.com (`server: cloudflare`)
- Bu ortamda Wrangler auth yok → dashboard’dan Deployments geçmişi ayrıca kontrol edilmeli
- Live snapshot: `recovery/cloudflare-live-snapshot-20260726/`

## AWS (backend)

- Host: `ubuntu@35.159.95.54`
- Process: PM2 `cs-manager` → `/home/ubuntu/cs-server-manager/index.js`
- Bu PR’daki `cs-server-manager/` canlı sunucudan 2026-07-26’da alındı

## Secrets (git’e yazılmadı)

Artifact klasörü (agent ortamı):

- `cs-server-manager.env` — canlı `.env`
- `cs-key.pem` — EC2 SSH key
- `browsercs-full-recovery-20260726.tar.gz` — tam sunucu arşivi
- `binaries/pack/` + `loggan_s_15_transformation_pack_18.7z`

Yerel kurulum:

```bash
cp /path/to/cs-server-manager.env cs-server-manager/.env
# .env içinde ADMIN_PASS satırında # varsa tırnakla yaz:
# ADMIN_PASS="Bcs@2026!Admin#Secure"
```

## Master Admin

- URL: `https://browsercs.com/oyna/#csadmin` (veya `?admin=1`)
- Canlı şifre dotenv `#` kesmesi nedeniyle: `Bcs@2026!Admin`  
  (`.env` dosyasında tam değer `Bcs@2026!Admin#Secure` — `#Secure` yorum sayılıyor)

## Yapılacaklar (senin taraf)

1. Cloudflare Dashboard → Workers & Pages → `cs-web-game` → son deployment’ı doğrula / kaynak branch bağla
2. Bu recovery branch’ini `main` ile birleştir veya sunucuya deploy et
3. Mac’te Time Machine / iCloud varsa ek local farkları karşılaştır
4. `.env` ve `cs-key.pem`’i güvenli password manager’a koy
