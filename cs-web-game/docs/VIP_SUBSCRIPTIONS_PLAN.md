# BrowserCS VIP Subscriptions — Implementation Plan

Classic CS 1.5 VIP (Silver / Gold / Platinum). No spawn kits, no modern cosmetics, no P2W weapons.

**Prices (TRY / month):** Silver **49** · Gold **99** · Platinum **199**

**Backup (pre-work):** `backups/vip-pre-20260721_002655/` (+ `TOUCHPOINTS.md`)  
**Branch:** `feature/vip-subscriptions` (local; no commit required)

---

## Goals

| Tier | Price | In-game / web |
|------|------:|---------------|
| **Silver** | 49₺ | Scoreboard/name `[VIP]` or ★ (visible only); reserved slot; votekick immunity; web VIP badge |
| **Gold** | 99₺ | All Silver + classic VIP model pool; round-start money +$300–500 (capped); free kevlar (modest); VIP room access; `/vip` menu |
| **Platinum** | 199₺ | All Gold + priority reserved slot; clan tag; higher round money **or** CT defuse kit (pick one); extra vote/mute protection; 1 map suggestion/month; rental discount |

---

## Non-goals (explicit)

- No P2W weapons, damage buffs, or aim helpers
- No spawn grenade / armor spam kits
- No modern skins / shop cosmetics — classic VIP model pool only
- No client-trusted UUID for privileges (ticket + server snapshot only)
- No iyzico/Stripe/PayTR in Phase 1 (structure only; grant path for testing)

---

## Auth / rank / admin touchpoints (current)

| Area | Path |
|------|------|
| JWT auth | `cs-server-manager/index.js` → `requireAuth` |
| Profiles | `cs-web-game/supabase/schema.sql` → `profiles` |
| Rank ticket client | `cs-web-game/src/net/rankTicket.js` → `setinfo _bcs_rank` |
| Rank sessions | `cs-server-manager/lib/rankSessions.js` → `rank_sessions.txt` |
| Rank AMXX | `browsercs_rank.sma` |
| Admin grant style | `routes/admin.js` → `x-admin-token` |
| Payments today | ENPARA IBAN rentals only; Stripe removed |

VIP mirrors the **rank ticket** pattern: short-lived random ticket in `setinfo`, never trust client UUID.

---

## Phases

### Phase 1 — Foundation (this PR / WIP)

1. **DB:** `vip_tier`, `vip_expires_at`, `vip_clan_tag` on `profiles` (+ optional grant metadata)
2. **Backend:** VIP session snapshot + `POST /api/me/vip-ticket`; admin grant; `GET /api/me/vip`
3. **Client:** prefetch VIP ticket on join (parallel to rank) → `setinfo _bcs_vip`
4. **AMXX:** `browsercs_vip.sma` — Silver: reserved slot + votekick immunity + name prefix; Gold/Platinum stubs
5. **Payment:** constants only; no checkout UI yet
6. **Deploy:** local / one test server when Silver path is stable — not AWS by default

### Phase 2 — Billing + web UI

- Manual/admin grant remains
- Optional IBAN VIP order flow (reuse rental pattern) **or** later PayTR/iyzico
- Profile / rank panel VIP badge
- Pricing page (Turkish copy)

### Phase 3 — Gold AMXX

- Classic model pool (existing CS models only)
- Round-start money bonus (capped)
- Free kevlar (no helmet unless product decides otherwise)
- VIP server/room gate (port or password list)
- `/vip` say command → status + remaining days

### Phase 4 — Platinum AMXX + ops

- Priority reserved slot (tier order: platinum > gold > silver)
- Clan tag (fixed short tag in name)
- Money **or** defuse kit (config pick)
- Stronger vote/mute protection
- Map suggestion quota (1/month → enters vote)
- Rental discount field / coupon

---

## Data model (Supabase)

```sql
-- profiles extensions
vip_tier text not null default 'none'
  check (vip_tier in ('none', 'silver', 'gold', 'platinum'));
vip_expires_at timestamptz;          -- null = none / expired
vip_clan_tag text;                   -- platinum; short, sanitized
vip_granted_at timestamptz;
vip_granted_by text;                 -- 'admin' | 'payment' | …
vip_notes text;                      -- admin only
```

**Active VIP:** `vip_tier != 'none' AND vip_expires_at > now()`.

Future (Phase 2+): `vip_orders` table mirroring `rental_orders` if IBAN checkout is added.

**RLS:** users can **select** own VIP fields; **update** only via service role / admin API (prevent self-upgrade).

---

## How game servers learn VIP status

```
Browser (JWT) → POST /api/me/vip-ticket { port }
  → issueVipTicket() writes vip_sessions.txt
  → client setinfo _bcs_vip <ticket>
AMXX browsercs_vip → read setinfo → lookup snapshot → apply flags
```

- Snapshot line: `ticket|userId|displayName|tier|port|expiresUnix|clanTag`
- TTL ~5 minutes (same order as rank tickets)
- Client UUID ignored; spoofed tickets fail lookup
- Guests: no ticket, no VIP

---

## Payment

| Provider | Status |
|----------|--------|
| Stripe | Removed (legacy stubs return error) |
| iyzico / PayTR | Not present |
| ENPARA IBAN | Used for **server rental** only |

**Phase 1:** admin grant (`POST /api/admin/vip/grant`) + price constants.  
**Phase 2:** either VIP IBAN orders or external PSP — keep grant path for comps/testing.

---

## Feature flags (tier → AMXX)

| Feature | Silver | Gold | Platinum |
|---------|:------:|:----:|:--------:|
| Name prefix `[VIP]` / ★ | ✓ | ✓ | ✓ |
| Reserved slot (`ADMIN_RESERVATION`) | ✓ | ✓ | ✓ priority |
| Votekick immunity (`ADMIN_IMMUNITY` light) | ✓ | ✓ | ✓+ |
| Classic VIP models | | ✓ | ✓ |
| Round money bonus | | ✓ | ✓ / higher |
| Free kevlar | | ✓ | ✓ |
| VIP room | | ✓ | ✓ |
| `/vip` menu | | ✓ | ✓ |
| Clan tag | | | ✓ |
| Defuse kit **or** extra money | | | ✓ (one) |
| Vote/mute extra protection | | | ✓ |
| Map suggestion /mo | | | ✓ (web/ops) |
| Rental discount | | | ✓ (web) |

Cvars (planned): `bcs_vip 1`, `bcs_vip_prefix "[VIP]"`, `bcs_vip_money_min/max`, `bcs_vip_plat_bonus` (`money`|`defuse`).

---

## Test plan

1. **DB:** migrate; grant silver to test user; confirm `GET /api/me/vip`
2. **Ticket:** logged-in VIP → ticket issued; guest → no ticket; expired → rejected
3. **setinfo:** connect with `_bcs_vip` present; AMXX log bind success
4. **Silver:** full server → VIP joins via reserved slot; votekick against VIP fails; name shows prefix
5. **Negative:** forge ticket / wrong port → no VIP
6. **Admin:** grant/revoke; expire → next ticket fails
7. **Regression:** rank ticket still works in parallel
8. **Non-goals:** no extra weapons/grenades on spawn

---

## Deploy status

- **Code:** Phase 1 skeleton in repo (see file list below)
- **AMXX:** `browsercs_vip.amxx` compiled locally (Docker i386 + amxxpc 1.8.1); wired in `plugins.ini` / `plugins-dm.ini`
- **AWS / production:** **not deployed** — verify Silver reserved-slot + `[VIP]` prefix on one test server first
- **Supabase:** run `20260721_vip_subscriptions.sql` before grant/ticket APIs work against real profiles

### Phase 1 files

| Layer | Path |
|-------|------|
| Plan | `cs-web-game/docs/VIP_SUBSCRIPTIONS_PLAN.md` |
| Migration | `cs-web-game/supabase/migrations/20260721_vip_subscriptions.sql` |
| Constants | `cs-server-manager/lib/vipConstants.js` |
| Sessions | `cs-server-manager/lib/vipSessions.js` |
| API | `cs-server-manager/routes/vip.js` |
| Client ticket | `cs-web-game/src/net/vipTicket.js` |
| AMXX | `cs-server-manager/amxmodx/scripting/browsercs_vip.sma` (+ `.amxx`) |
