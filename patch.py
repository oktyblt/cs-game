const fs = require('fs');
let content = fs.readFileSync('/Users/oktaybulut/Desktop/Hlf/cs-web-game/public/cs-assets/cstrike/titles.txt', 'binary');

content = content.replace(/T_BuyRifle[\s\S]*?CT_BuyRifle/, `T_BuyRifle\r\n{\r\n\\yCatisma Tufekleri (Ana Silah)\\R$   Fiyat\r\n\r\n\\w1. AK-47\\y\\R2500\r\n\\w2. Steyr Scout\\y\\R2750\r\n\\w3. Sig SG-552 Commando\\y\\R3500\r\n\\w4. AI Arctic Warfare/Magnum\\y\\R4750\r\n\\w5. H&K G3/SG-1 Sniper Rifle\\y\\R5000\r\n\r\n\\w0. Kapat\r\n}\r\n\r\nCT_BuyRifle`);

content = content.replace(/CT_BuyRifle[\s\S]*?AS_T_BuyRifle/, `CT_BuyRifle\r\n{\r\n\\yCatisma Tufekleri (Ana Silah)\\R$   Fiyat\r\n\r\n\\w1. Colt M4A1 Carbine\\y\\R3100\r\n\\w2. Steyr Scout\\y\\R2750\r\n\\w3. Steyr Aug\\R3500\r\n\\w4. AI Arctic Warfare/Magnum\\y\\R4750\r\n\\w5. Sig SG-550 Sniper\\y\\R4200\r\n\r\n\\w0. Kapat\r\n}\r\n\r\n\r\nAS_T_BuyRifle`);

// Pistols
content = content.replace(/T_BuyPistol[\s\S]*?AS_BuyShotgun/, `T_BuyPistol\r\n{\r\n\\yTabancalar\\R$   Fiyat\r\n(Yedek Silah)\r\n\r\n\\w1. Glock18 Select Fire\\y\\R400\r\n\\w2. H&K USP .45 Tactical\\y\\R500\r\n\\w3. Desert Eagle .50AE\\y\\R650\r\n\\w4. SIG P228\\y\\R600\r\n\\w5. cift Beretta 96G Elite\\y\\R1000\r\n\r\n\\w0. Kapat\r\n}\r\n\r\n\r\nAS_BuyShotgun`);

content = content.replace(/CT_BuyPistol[\s\S]*?T_BuyPistol/, `CT_BuyPistol\r\n{\r\n\\yTabancalar\\R$   Fiyat\r\n(Yedek Silah)\r\n\r\n\\w1. Glock18 Select Fire\\y\\R400\r\n\\w2. H&K USP .45 Tactical\\y\\R500\r\n\\w3. Desert Eagle .50AE\\y\\R650\r\n\\w4. SIG P228\\y\\R600\r\n\\w5. FN Five-Seven\\y\\R750\r\n\r\n\\w0. Kapat\r\n}\r\n\r\nT_BuyPistol`);

fs.writeFileSync('/Users/oktaybulut/Desktop/Hlf/cs-web-game/public/cs-assets/cstrike/titles.txt', content, 'binary');
