import re

with open('public/cs-assets/cstrike/titles.txt', 'r', encoding='windows-1254') as f:
    content = f.read()

# Replace CT_BuyPistol with T_BuyPistol and CT_BuyPistol
ct_pistol_old = r"""CT_BuyPistol
{
\yTabancalar\R$   Fiyat
(Yedek Silah)

\w1. Glock18 Select Fire\y\R400
\w2. H&K USP .45 Tactical\y\R500
\w3. Desert Eagle .50AE\y\R650
\w4. SIG P228\y\R600
\w5. cift Beretta 96G Elite\y\R1000

\w0. Kapat
}"""

ct_pistol_new = r"""T_BuyPistol
{
\yTabancalar\R$   Fiyat
(Yedek Silah)

\w1. H&K USP .45 Tactical\y\R500
\w2. Glock18 Select Fire\y\R400
\w3. Desert Eagle .50AE\y\R650
\w4. SIG P228\y\R600
\w5. cift Beretta 96G Elite\y\R1000

\w0. Kapat
}

CT_BuyPistol
{
\yTabancalar\R$   Fiyat
(Yedek Silah)

\w1. H&K USP .45 Tactical\y\R500
\w2. Glock18 Select Fire\y\R400
\w3. Desert Eagle .50AE\y\R650
\w4. SIG P228\y\R600
\d5. cift Beretta 96G Elite\y\R1000
\w6. FN Five-Seven\y\R750

\w0. Kapat
}"""

content = content.replace(ct_pistol_old, ct_pistol_new)

# Replace T_BuyRifle and CT_BuyRifle
rifle_old = r"""T_BuyRifle
{
\yCatisma Tufekleri (Ana Silah)\R$   Fiyat

\w1. AK-47\y\R2500
\w2. Steyr Scout\y\R2750
\w3. Sig SG-552 Commando\y\R3500
\w4. AI Arctic Warfare/Magnum\y\R4750
\w5. H&K G3/SG-1 Sniper Rifle\y\R5000

\w0. Kapat
}

CT_BuyRifle
{
\yCatisma Tufekleri (Ana Silah)\R$   Fiyat

\w1. Colt M4A1 Carbine\y\R3100
\w2. Steyr Scout\y\R2750
\w3. Steyr Aug\R3500
\w4. AI Arctic Warfare/Magnum\y\R4750
\w5. Sig SG-550 Sniper\y\R4200

\w0. Kapat
}"""

rifle_new = r"""T_BuyRifle
{
\yCatisma Tufekleri (Ana Silah)\R$   Fiyat

\w1. AK-47\y\R2500
\w2. Sig SG-552 Commando\y\R3500
\w5. Steyr Scout\y\R2750
\w6. AI Arctic Warfare/Magnum\y\R4750
\w7. H&K G3/SG-1 Sniper Rifle\y\R5000

\w0. Kapat
}

CT_BuyRifle
{
\yCatisma Tufekleri (Ana Silah)\R$   Fiyat

\w3. Colt M4A1 Carbine\y\R3100
\w4. Steyr Aug\y\R3500
\w5. Steyr Scout\y\R2750
\w6. AI Arctic Warfare/Magnum\y\R4750
\w8. Sig SG-550 Sniper\y\R4200

\w0. Kapat
}"""

content = content.replace(rifle_old, rifle_new)

# Insert T_BuyItem and CT_BuyItem
dt_buyitem = r"""DT_BuyItem
{
\yEkipmanlar\R$   Fiyat

\w1. Yelek\y\R650
\w2. Yelek & Kask\y\R1000
\w3. Flash Bombasi\y\R200	
\w4. El Bombasi\y\R300
\w5. Sis Bombasi\y\R300
\d6. Imha Kiti\y\R200
\w7. Gecegorus Gozlukleri\y\R1250

\w0. Kapat
}"""

items_new = dt_buyitem + r"""

T_BuyItem
{
\yEkipmanlar\R$   Fiyat

\w1. Yelek\y\R650
\w2. Yelek & Kask\y\R1000
\w3. Flash Bombasi\y\R200
\w4. El Bombasi\y\R300
\w5. Sis Bombasi\y\R300
\w6. Gecegorus Gozlukleri\y\R1250

\w0. Kapat
}

CT_BuyItem
{
\yEkipmanlar\R$   Fiyat

\w1. Yelek\y\R650
\w2. Yelek & Kask\y\R1000
\w3. Flash Bombasi\y\R200
\w4. El Bombasi\y\R300
\w5. Sis Bombasi\y\R300
\w6. Imha Kiti\y\R200
\w7. Gecegorus Gozlukleri\y\R1250
\d8. Taktik Kalkan\y\R2200

\w0. Kapat
}"""

content = content.replace(dt_buyitem, items_new)

with open('public/cs-assets/cstrike/titles.txt', 'w', encoding='windows-1254') as f:
    f.write(content)

print("Patched successfully")
