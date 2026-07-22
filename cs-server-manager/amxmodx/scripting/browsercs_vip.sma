#include <amxmodx>
#include <amxmisc>
#include <fakemeta>
#include <fakemeta_util>
#include <fun>
#include <hamsandwich>

/**
 * BrowserCS Classic VIP (Silver / Gold / Platinum)
 *
 * Ticket setinfo _bcs_vip → shared vip_sessions.txt → tier
 * Silver: name prefix, reserved slot, votekick immunity
 * Gold: money bonus, kevlar, classic model menu, /vip status
 * Platinum: priority reserved, clan tag, higher money OR defuse, stronger immunity
 *
 * Snapshot: ticket|userId|displayName|tier|port|expiresUnix|clanTag
 * Never trust client UUID or client-claimed tier.
 *
 * No #include <cstrike> — BrowserCS/Xash often lacks the cstrike module.
 * Money/model/defuse use fakemeta + fun (same stack as other browsercs_* plugins).
 */

#define PLUGIN_NAME    "BrowserCS VIP"
#define PLUGIN_VERSION "1.8.0"
#define PLUGIN_AUTHOR  "BrowserCS"

/* Linux CS 1.6 / ReGameDLL player pdata */
#define XO_PLAYER      5
#define OFFSET_MONEY   115
#define TEAM_T         1
#define TEAM_CT        2

#define SESSION_FILE   "addons/amxmodx/data/vip_sessions.txt"
#define PORT_FILE      "addons/amxmodx/configs/browsercs_rank_port.txt"
#define VIP_ONLY_FILE  "addons/amxmodx/configs/browsercs_vip_only.txt"

#define MAX_PLAYERS 32
#define USER_ID_LEN 40
#define NAME_LEN 32
#define TICKET_LEN 32
#define TIER_LEN 16
#define TAG_LEN 12

#define TIER_NONE      0
#define TIER_SILVER    1
#define TIER_GOLD      2
#define TIER_PLATINUM  3

/* Votekick immunity only. NOTE: ADMIN_RESERVATION is intentionally NOT set here —
 * adminslots.amxx recalculates reserved-slot occupancy on flag change and, with
 * amx_reservation 0 configured (as on Legality/27202), kicks the very client whose
 * flags just changed. Reserved-slot marketing is honored via TryPrioritySlot only
 * (currently gated off by bcs_vip_priority_kick, default 0). */
#define VIP_FLAGS_BASE (ADMIN_IMMUNITY)
/* Platinum: stronger vote/mute protection via ban immunity flag */
#define VIP_FLAGS_PLAT (VIP_FLAGS_BASE | ADMIN_BAN)

#define MONEY_CAP 16000
#define MENU_VIP_MODELS "BrowserCS VipModels"

new g_cvarEnabled;
new g_cvarPrefix;
new g_cvarPort;
new g_cvarMoneyGold;
new g_cvarMoneyPlat;
new g_cvarPlatBonus; /* 0 = money, 1 = CT defuse kit */
new g_cvarKevlar;
new g_cvarPriorityKick;

/* VIP ODA: 0=kapali, TIER_GOLD / TIER_PLATINUM = minimum giris paketi */
new g_vipRoomMinTier;

/* Kademeli rollout (27019 canary) TAMAMLANDI — v1.7.4'ten itibaren altin
 * silah + VIP model ozellikleri TUM sunucularda aktif. cs15-* container'lari
 * ayni /home/ubuntu/cstrike bind mount'unu paylastigi icin tek .amxx dosyasi
 * herkese ayni anda gider. */
#define GOLD_FEATURES_ENABLED true
new g_port;
new g_msgMoney;

new g_userId[MAX_PLAYERS + 1][USER_ID_LEN];
new g_displayName[MAX_PLAYERS + 1][NAME_LEN];
new g_tier[MAX_PLAYERS + 1];
new g_clanTag[MAX_PLAYERS + 1][TAG_LEN];
new bool:g_vip[MAX_PLAYERS + 1];
new bool:g_namePrefixed[MAX_PLAYERS + 1];
new bool:g_roundBonusDone[MAX_PLAYERS + 1];
new bool:g_goldVisualReady[MAX_PLAYERS + 1];
new bool:g_vipModelVisualReady[MAX_PLAYERS + 1];
new g_vipModel[MAX_PLAYERS + 1][16];
/* Platinum clan tag artik SABIT "[BCS]" (backend g_clanTag'a fixed deger yazar) —
 * oyuncu sadece acik/kapali durumunu /clantag ile degistirir (scoreboard/chat rozeti). */
new bool:g_clanTagEnabled[MAX_PLAYERS + 1];

/* Takım kimliği bozulmasın — CT sadece CT modeli, T sadece T modeli secer.
 * Karsi takim modeli giyip rakip/takim arkadasi karistirilmasi rekabetci
 * bütünlüğü bozar, bu yuzden /vipmodel takima gore ayri liste gosterir.
 *
 * "vip_" onekli modeller VIP'e ozel — standart oyuncularin goremeyecegi/
 * secemeyecegi ozel (klasik CS 1.6 "full pack") skinler, cstrike_models_
 * vip.pk3 icine eklendi (client) + cstrike/models/player/vip_* (server).
 * NOT: plugin_precache() kasitli olarak bu oyuncu modellerini precache
 * ETMEZ (asagida acikla) — userinfo "model" alani zaten client VFS'den
 * lazy-load ediyor. */
new const g_classicModelsCT[][] = {
	"vip_urban",
	"vip_gsg9",
	"vip_sas",
	"vip_gign"
};

new const g_classicModelsT[][] = {
	"vip_terror",
	"vip_leet",
	"vip_arctic",
	"vip_guerilla"
};

/* ── Gold/Platinum "altin silah" ─────────────────────────────────────────
 * g_goldClass = ReGameDLL_CS weapon entity classname (RegisterHam icin).
 * g_goldBase  = models/p_<base>.mdl -> models/p_vip_<base>.mdl eslesmesi
 * (ayni isim v_vip_/w_vip_ icin de gecerli).
 * (mp5navy classname'i "mp5" model adini kullanir — gamedll'de sabit boyle.)
 *
 * p_ (3.sahis, herkes gorur) ve v_ (1.sahis, SADECE sahibinin/onu izleyen
 * spectator'un gordugu viewmodel) her ikisi de per-entity set_pev ile
 * uygulanir — ikisi de sahibin pev'inde tutulan alanlar oldugu icin baska
 * oyuncuyu ETKILEMEZ. (Eskiden v_ icin "kendi istemcinde stok dosyayi ez"
 * teknigi kullanildi — spectator/chase-cam izleyen kisinin gordugu viewmodel
 * izlenen HEDEFE degil izleyenin kendi dosyasina baglandigi icin, VIP biri
 * izlerken HERKESI altin silahli gosteriyordu. Artik v_vip_*.mdl ayri
 * isimlerle var ve pev_viewmodel dogru sahibe gore ayarlaniyor.)
 *
 * w_ (yerde dusen model) icin: CS'de tek-silah drop'u da CWeaponBox
 * uzerinden yonetiliyor, CWeaponBox::SetModel hamsandwich'te yok. Bunun
 * yerine Ham_Item_Drop (asil silah nesnesinde, kutu SPAWN OLMADAN once
 * calisir) sonrasi olusan weaponbox'i entity aramasiyla bulup modelini
 * SET_MODEL ile kendimiz uzerine yaziyoruz (bkz. OnGoldWeaponDrop_Post). */
new const g_goldClass[][] = {
	"weapon_ak47", "weapon_aug", "weapon_awp", "weapon_c4", "weapon_deagle",
	"weapon_elite", "weapon_famas", "weapon_fiveseven", "weapon_flashbang",
	"weapon_g3sg1", "weapon_galil", "weapon_glock18", "weapon_hegrenade",
	"weapon_knife", "weapon_m249", "weapon_m3", "weapon_m4a1", "weapon_mac10",
	"weapon_mp5navy", "weapon_p228", "weapon_p90", "weapon_scout", "weapon_sg550",
	"weapon_sg552", "weapon_smokegrenade", "weapon_tmp", "weapon_ump45",
	"weapon_usp", "weapon_xm1014"
};

new const g_goldBase[][] = {
	"ak47", "aug", "awp", "c4", "deagle",
	"elite", "famas", "fiveseven", "flashbang",
	"g3sg1", "galil", "glock18", "hegrenade",
	"knife", "m249", "m3", "m4a1", "mac10",
	"mp5", "p228", "p90", "scout", "sg550",
	"sg552", "smokegrenade", "tmp", "ump45",
	"usp", "xm1014"
};

#define MAX_EDICTS_GOLD 2048
new bool:g_weaponGolden[MAX_EDICTS_GOLD];

/* Misafir/Silver'in yerden aldigi altin silah: weaponbox -> envanter
 * transferinde oyun DLL'i silah edict'ini yeniden kullanip/spawn edip
 * g_weaponGolden bayragini dusurebiliyor. Edict kimligine guvenmek yerine
 * oyuncu-bazli "beklenen altin silah" kaydi tutulur; CurWeapon eventi bu
 * silaha gecildigini gorunce guncel edict yeniden altin isaretlenir. */
new g_pendingGoldWeaponId[MAX_PLAYERS + 1];
new Float:g_pendingGoldUntil[MAX_PLAYERS + 1];

stock bool:GoldHasWorldModel(idx)
{
	/* w_vip_c4 / w_vip_knife kaynak pakette yok. */
	return (!equal(g_goldBase[idx], "c4") && !equal(g_goldBase[idx], "knife"));
}

GoldWeaponIndexForWorldModel(const model[])
{
	new i, stockPath[64];
	for (i = 0; i < sizeof g_goldBase; i++)
	{
		if (!GoldHasWorldModel(i))
			continue;

		formatex(stockPath, charsmax(stockPath), "models/w_%s.mdl", g_goldBase[i]);
		if (equal(model, stockPath))
			return i;
	}
	return -1;
}

GoldWeaponIndexForVipWorldModel(const model[])
{
	new i, vipPath[64];
	for (i = 0; i < sizeof g_goldBase; i++)
	{
		if (!GoldHasWorldModel(i))
			continue;

		formatex(vipPath, charsmax(vipPath), "models/w_vip_%s.mdl", g_goldBase[i]);
		if (equal(model, vipPath))
			return i;
	}
	return -1;
}

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);

	g_cvarEnabled = register_cvar("bcs_vip", "1");
	/* Empty default: name prefix is unsafe on Xash/WebRTC (infostring + userinfo churn). */
	g_cvarPrefix = register_cvar("bcs_vip_prefix", "");
	g_cvarPort = register_cvar("bcs_vip_port", "0");
	g_cvarMoneyGold = register_cvar("bcs_vip_money_gold", "400");
	g_cvarMoneyPlat = register_cvar("bcs_vip_money_plat", "550");
	g_cvarPlatBonus = register_cvar("bcs_vip_plat_bonus", "0"); /* 0 money, 1 defuse */
	g_cvarKevlar = register_cvar("bcs_vip_kevlar", "1");
	/* Priority kick touches connecting clients — off until slot logic is Xash-safe. */
	g_cvarPriorityKick = register_cvar("bcs_vip_priority_kick", "0");
	g_port = 0;
	g_vipRoomMinTier = 0;

	register_clcmd("say", "OnVipSay");
	register_clcmd("say_team", "OnVipSay");
	register_clcmd("say /vip", "CmdVipMenu");
	register_clcmd("say_team /vip", "CmdVipMenu");
	register_clcmd("say /vipmodel", "CmdVipModelMenu");
	register_clcmd("say_team /vipmodel", "CmdVipModelMenu");
	register_clcmd("say /clantag", "CmdClanTagToggle");
	register_clcmd("say_team /clantag", "CmdClanTagToggle");

	RegisterHam(Ham_Spawn, "player", "OnPlayerSpawnPost", 1);
	RegisterHam(Ham_AddPlayerItem, "player", "OnGoldWeaponPickedUp_Post", 1);
	register_event("HLTV", "OnRoundStart", "a", "1=0", "2=0");
	/* Aktif silah her degistiginde (yerden alma dahil) altin gorunumu tek
	 * gecikmeli refresh ile uygula — pickup-deploy yarisini kapatir. */
	register_event("CurWeapon", "OnCurWeaponEvent", "be", "1=1");

	register_menucmd(register_menuid(MENU_VIP_MODELS), 1023, "MenuVipModels");
	g_msgMoney = get_user_msgid("Money");

	/* Safety-net resync — covers clients that missed the per-bind broadcast
	 * (e.g. joined between two binds). Cheap: only runs if someone is VIP. */
	set_task(30.0, "BroadcastVipRoster", _, _, _, "b");

	/* KRITIK: ReGameDLL_CS'in CHalfLifeMultiplay::ClientUserInfoChanged'i HER
	 * userinfo degisiminde (periyodik rate/setinfo paketleri, C4 alma, spawn...)
	 * SetPlayerModel() cagirip modeli takim-standart ismine (arctic/terror/...)
	 * GERI YAZIYOR — cs_set_user_model (cstrike modulu) olmadan bunu engellemenin
	 * yolu yok, cstrike modulu de bu Xash ortaminda ClientDisconnect/ResetModel'de
	 * crash ettigi icin modules.ini'de kapali. Bu yuzden POST forward ile oyun
	 * DLL'inin sifirlamasindan HEMEN SONRA kendi secimimizi tekrar yaziyoruz. */
	register_forward(FM_ClientUserInfoChanged, "OnVipUserInfoChanged", 1);
	/* Yere dusen silah CWeaponBox tarafindan olusturulur. Burada modelini
	 * degistirmek, eldeki silah henuz oyuncudayken Ham_Item_Drop PRE'de
	 * degistirmekten farkli olarak viewmodel/eller durumunu bozmaz. */
	register_forward(FM_SetModel, "OnGoldWeaponBoxSetModel");
	/* Hamsandwich Ham_Touch Xash/YaPB'de server crash uretiyor. Fakemeta
	 * touch forward'i sadece golden weaponbox aktarimini isaretler; oyun
	 * Touch fonksiyonunu degistirmez. */
	register_forward(FM_Touch, "OnGoldenWeaponBoxTouch");

	/* Altin silah: her silah tipi icin Spawn (bayrak sifirlama — edict yeniden
	 * kullanildiginda eski "altin" bilgisi kalmasin), Deploy POST (ele alinca
	 * sahibin VIP kademesine gore altin/normal karar) hook'lari. */
	new i;
	for (i = 0; i < sizeof g_goldClass; i++)
	{
		RegisterHam(Ham_Spawn, g_goldClass[i], "OnGoldWeaponSpawn", 1);
		RegisterHam(Ham_Item_Deploy, g_goldClass[i], "OnGoldWeaponDeploy_Post", 1);
	}
}

/* p_ (3.sahis), v_ (1.sahis) ve w_ (yerdeki silah) modelleri ayni isimlerle
 * hem sunucuda hem istemci PK3'unde bulunur. Her biri sadece golden silah
 * nesnesine atanir; stok silahlarin model alanlarina dokunulmaz. */
public plugin_precache()
{
	/* v1.7.4: rollout tamam — VIP model + altin silah modelleri TUM
	 * sunucularda precache edilir. */
	new i, path[64], count;
	for (i = 0; i < sizeof g_classicModelsCT; i++)
	{
		formatex(path, charsmax(path), "models/player/%s/%s.mdl", g_classicModelsCT[i], g_classicModelsCT[i]);
		precache_model(path);
		count++;
	}
	for (i = 0; i < sizeof g_classicModelsT; i++)
	{
		formatex(path, charsmax(path), "models/player/%s/%s.mdl", g_classicModelsT[i], g_classicModelsT[i]);
		precache_model(path);
		count++;
	}
	for (i = 0; i < sizeof g_goldBase; i++)
	{
		formatex(path, charsmax(path), "models/p_vip_%s.mdl", g_goldBase[i]);
		precache_model(path);
		formatex(path, charsmax(path), "models/v_vip_%s.mdl", g_goldBase[i]);
		precache_model(path);
		count += 2;
		if (GoldHasWorldModel(i))
		{
			formatex(path, charsmax(path), "models/w_vip_%s.mdl", g_goldBase[i]);
			precache_model(path);
			count++;
		}
	}
	log_amx("[BrowserCS VIP] canary models precached (%d)", count);
}

GoldWeaponIndexFor(ent)
{
	new classname[32];
	pev(ent, pev_classname, classname, charsmax(classname));
	new i;
	for (i = 0; i < sizeof g_goldClass; i++)
	{
		if (equal(classname, g_goldClass[i]))
			return i;
	}
	return -1;
}

public OnGoldWeaponSpawn(ent)
{
	if (ent > 0 && ent < MAX_EDICTS_GOLD)
		g_weaponGolden[ent] = false;
	return HAM_IGNORED;
}

/* Silah alinirken oyun DLL'i kendi stok viewmodel'ini birkac adim sonra
 * yazabilir. Bu nedenle golden silah elde aktifse, kisa bir sonraki frame'de
 * modelini yeniden uygula; oyuncunun bicaga/silaha gecmesini bekleme. */
public OnGoldWeaponPickedUp_Post(id, ent)
{
	if (!GOLD_FEATURES_ENABLED || !is_user_connected(id))
		return HAM_IGNORED;

	if (ent <= 0 || ent >= MAX_EDICTS_GOLD)
		return HAM_IGNORED;

	/* Gold/Platinum ilk kez normal bir silah aldiginda deploy forward'i bu
	 * noktadan SONRA calisabilir. Bayragi burada yazmazsak yenileme atlanir
	 * ve oyuncu ancak bicaga gecip geri donunce golden modeli gorur. */
	if (!g_weaponGolden[ent] && g_vip[id] && g_tier[id] >= TIER_GOLD)
		g_weaponGolden[ent] = true;

	if (!g_weaponGolden[ent])
		return HAM_IGNORED;

	new data[2];
	data[0] = id;
	data[1] = ent;
	remove_task(id + 500);
	set_task(0.12, "TaskRefreshGoldenPickup", id + 500, data, sizeof data);
	return HAM_IGNORED;
}

/* Altin world-model'e sahip kutuya dokunuldugunda child silahi transferden
 * once isaretle. Olum/drop sirasinda weaponbox owner'i degisebildigi icin
 * yalnizca SetModel forward'ina guvenmek misafir/Silver pickup'inda bayragin
 * kaybolmasina yol aciyordu. */
public OnGoldenWeaponBoxTouch_Pre(box, id)
{
	if (!GOLD_FEATURES_ENABLED || !is_user_connected(id) || !pev_valid(box))
		return HAM_IGNORED;

	new model[64];
	pev(box, pev_model, model, charsmax(model));
	if (GoldWeaponIndexForVipWorldModel(model) < 0)
		return HAM_IGNORED;

	new weaponEnt, i;
	for (i = 0; i < sizeof g_goldClass; i++)
	{
		weaponEnt = fm_find_ent_by_owner(-1, g_goldClass[i], box);
		if (weaponEnt > 0 && weaponEnt < MAX_EDICTS_GOLD)
		{
			g_weaponGolden[weaponEnt] = true;
			log_amx("[VipGoldWeapon] transfer box=%d weapon=%d recipient=%d", box, weaponEnt, id);
			break;
		}
	}
	return HAM_IGNORED;
}

public TaskRefreshGoldenPickup(data[])
{
	new id = data[0];
	new ent = data[1];
	if (!is_user_connected(id) || !pev_valid(ent) || pev(ent, pev_owner) != id)
		return;

	new idx = GoldWeaponIndexFor(ent);
	if (idx < 0)
		return;

	/* CWeaponBox -> oyuncu transferinde ReGameDLL silah entity'sini tekrar
	 * Spawn edebilir; OnGoldWeaponSpawn da eski bayragi temizler. Bu task
	 * transfer tamamlandiktan sonra calistigi icin kalici altin durumunu
	 * burada yeniden yazmak gerekir. */
	g_weaponGolden[ent] = true;

	new clip, ammo;
	if (get_user_weapon(id, clip, ammo) != get_weaponid(g_goldClass[idx]))
		return;

	OnGoldWeaponDeploy_Post(ent);
}

/* "Yapiskan" altin bayragi: silah nesnesi bir kez Gold/Plat elinde
 * calindiginda altin isaretlenir ve KIM ELİNE ALIRSA ALSIN (misafir/Silver
 * dahil) o silahi tasidigi surece altin gorunur — bkz. kullanici onayli
 * kural seti. Normal (hic altin olmamis) tazeden alinan silah her zaman
 * stok gorunur. */
public OnGoldWeaponDeploy_Post(ent)
{
	if (!GOLD_FEATURES_ENABLED)
		return HAM_IGNORED;

	if (!pev_valid(ent))
		return HAM_IGNORED;

	new idx = GoldWeaponIndexFor(ent);
	if (idx < 0)
		return HAM_IGNORED;

	new owner = pev(ent, pev_owner);
	new bool:golden = false;

	if (!is_user_alive(owner))
		return HAM_IGNORED;

	if (is_user_connected(owner) && g_vip[owner] && g_tier[owner] >= TIER_GOLD)
		golden = true;
	else if (ent > 0 && ent < MAX_EDICTS_GOLD && g_weaponGolden[ent])
		golden = true;

	if (ent > 0 && ent < MAX_EDICTS_GOLD)
		g_weaponGolden[ent] = golden;

	if (is_user_connected(owner) && golden && !g_goldVisualReady[owner])
		return HAM_IGNORED;

	if (is_user_connected(owner) && golden)
	{
		new path[64];
		formatex(path, charsmax(path), "models/p_vip_%s.mdl", g_goldBase[idx]);
		set_pev(owner, pev_weaponmodel2, path);

		/* Birinci sahis golden model, sadece baglanti/team-spawn asamasi
		 * bittikten sonra atanir. Bu, golden gorunumu korurken WASM'in erken
		 * v_ model gecisindeki OOB riskini engeller. */
		if (g_goldVisualReady[owner])
		{
			formatex(path, charsmax(path), "models/v_vip_%s.mdl", g_goldBase[idx]);
			set_pev(owner, pev_viewmodel2, path);
		}

		/* Test asamasinda gozlem icin — canary disinda hic calismiyor,
		 * dolayisiyla diger sunucularda log gurultusu yaratmiyor. */
		log_amx("[VipGoldWeapon] owner=%d weapon=%s golden=%d", owner, g_goldBase[idx], golden);
	}
	else if (is_user_connected(owner))
	{
		/* Onceki golden silahdan kalan p_vip_ modeli spectator/chase-cam'de
		 * normal silahi da golden gosterebilir. Her normal deploy'da stok
		 * ucuncu sahis modelini acikca geri yaz. */
		new stockPath[64];
		formatex(stockPath, charsmax(stockPath), "models/p_%s.mdl", g_goldBase[idx]);
		set_pev(owner, pev_weaponmodel2, stockPath);
		if (g_goldVisualReady[owner])
		{
			formatex(stockPath, charsmax(stockPath), "models/v_%s.mdl", g_goldBase[idx]);
			set_pev(owner, pev_viewmodel2, stockPath);
		}
	}
	return HAM_IGNORED;
}

public OnGoldWeaponBoxSetModel(ent, const model[])
{
	if (!GOLD_FEATURES_ENABLED || !pev_valid(ent))
		return FMRES_IGNORED;

	new classname[32];
	pev(ent, pev_classname, classname, charsmax(classname));

	/* Firlatilan bomba (HE/flash/smoke) yeni bir "grenade" entity'sidir —
	 * weaponbox kancasina girmez. Ucustaki model burada altina cevrilir. */
	if (equal(classname, "grenade"))
		return OnGoldGrenadeSetModel(ent, model);

	if (!equal(classname, "weaponbox"))
		return FMRES_IGNORED;

	new idx = GoldWeaponIndexForWorldModel(model);
	if (idx < 0)
		return FMRES_IGNORED;

	/* Kutudaki asil silah entity'sinin golden bayragini kontrol et. Bu bayrak
	 * silahi misafir/Silver alsa da korunur; boylece golden silah tekrar yere
	 * birakildiginda da golden dunya modeliyle kalir. */
	new weaponEnt = 0, candidateEnt, i, bool:golden = false;
	for (i = 0; i < sizeof g_goldClass; i++)
	{
		candidateEnt = fm_find_ent_by_owner(-1, g_goldClass[i], ent);
		if (candidateEnt > 0 && candidateEnt < MAX_EDICTS_GOLD)
		{
			/* Loop devam ederken weaponEnt'i ezme: Gold/Plat ilk kez
			 * biraktiginda bayrak henuz false olabilir. Bu durumda da
			 * sahibin tier'inden sonra ayni child entity'yi kalici
			 * golden olarak isaretlememiz gerekir. */
			weaponEnt = candidateEnt;
			if (g_weaponGolden[candidateEnt])
			{
				golden = true;
				break;
			}
		}
	}

	/* Ilk kez Gold/Platinum sahibi birakiyorsa deploy bayragi henuz okunmadan
	 * weaponbox olusabilir; bu durumda sahibinden de karar ver ve child silahi
	 * kalici golden olarak isaretle. */
	if (!golden)
	{
		new owner = pev(ent, pev_owner);
		if (is_user_connected(owner) && g_vip[owner] && g_tier[owner] >= TIER_GOLD)
		{
			golden = true;
			if (weaponEnt > 0 && weaponEnt < MAX_EDICTS_GOLD)
				g_weaponGolden[weaponEnt] = true;
		}
	}

	if (!golden)
		return FMRES_IGNORED;

	if (weaponEnt > 0 && weaponEnt < MAX_EDICTS_GOLD)
	{
		/* ReGameDLL spawn sirasi child silahin bayragini sonradan sifirlayabilir.
		 * Kutu olustuktan sonra bir kez daha yazmak, misafir/Silver'in golden
		 * silahi aldiginda da gorunumu korur. */
		new data[1];
		data[0] = weaponEnt;
		set_task(0.15, "TaskConfirmGoldenWeaponEntity", weaponEnt + 2000, data, sizeof data);
	}

	new vipWorldModel[64];
	formatex(vipWorldModel, charsmax(vipWorldModel), "models/w_vip_%s.mdl", g_goldBase[idx]);
	engfunc(EngFunc_SetModel, ent, vipWorldModel);
	return FMRES_SUPERCEDE;
}

/* Havada ucan HE/flash/smoke projektili. Sahibi Gold/Platinum ise (veya
 * misafir/Silver devralinmis altin bombayi atiyorsa) w_vip_ modeliyle ucar.
 * Planted C4 de "grenade" classname'i kullanir ama w_c4 modeli
 * GoldHasWorldModel disi oldugundan eslesmez — dokunulmaz. Icerideki
 * EngFunc_SetModel bu forward'i tekrar tetikler; w_vip_ yolu stok w_
 * listesinde olmadigi icin ikinci cagri IGNORED ile biter (recursion yok). */
OnGoldGrenadeSetModel(ent, const model[])
{
	new idx = GoldWeaponIndexForWorldModel(model);
	if (idx < 0)
		return FMRES_IGNORED;

	new owner = pev(ent, pev_owner);
	if (owner < 1 || owner > MAX_PLAYERS || !is_user_connected(owner) || !is_user_alive(owner))
		return FMRES_IGNORED;

	new bool:golden = (g_vip[owner] && g_tier[owner] >= TIER_GOLD);
	if (!golden)
	{
		new weaponEnt = fm_find_ent_by_owner(-1, g_goldClass[idx], owner);
		if (weaponEnt > 0 && weaponEnt < MAX_EDICTS_GOLD && g_weaponGolden[weaponEnt])
			golden = true;
	}
	if (!golden)
		return FMRES_IGNORED;

	new vipModel[64];
	formatex(vipModel, charsmax(vipModel), "models/w_vip_%s.mdl", g_goldBase[idx]);
	engfunc(EngFunc_SetModel, ent, vipModel);
	return FMRES_SUPERCEDE;
}

public OnGoldenWeaponBoxTouch(box, id)
{
	if (!GOLD_FEATURES_ENABLED || !is_user_connected(id) || !pev_valid(box))
		return FMRES_IGNORED;

	new classname[32], model[64];
	pev(box, pev_classname, classname, charsmax(classname));
	if (!equal(classname, "weaponbox"))
		return FMRES_IGNORED;
	pev(box, pev_model, model, charsmax(model));
	if (GoldWeaponIndexForVipWorldModel(model) < 0)
		return FMRES_IGNORED;

	new weaponEnt, i;
	for (i = 0; i < sizeof g_goldClass; i++)
	{
		weaponEnt = fm_find_ent_by_owner(-1, g_goldClass[i], box);
		if (weaponEnt > 0 && weaponEnt < MAX_EDICTS_GOLD)
		{
			g_weaponGolden[weaponEnt] = true;
			/* Edict kimligi transferde degisebilir/spawn'la sifirlanabilir.
			 * Oyuncu-bazli beklenen altin silah kaydi CurWeapon eventiyle
			 * guncel edict uzerinde bayragi geri yazar (misafir/Silver dahil). */
			g_pendingGoldWeaponId[id] = get_weaponid(g_goldClass[i]);
			g_pendingGoldUntil[id] = get_gametime() + 6.0;
			/* Touch birden fazla frame tetiklenebilir; tek gecikmeli yenileme
			 * silah envantere girdikten SONRA owner/viewmodel alanlarini yazar. */
			new data[2];
			data[0] = id;
			data[1] = weaponEnt;
			remove_task(id + 500);
			set_task(0.20, "TaskRefreshGoldenPickup", id + 500, data, sizeof data);
			break;
		}
	}
	return FMRES_IGNORED;
}

/* Aktif silah degisti (satin alma, slot degisimi, yerden alma). Deploy POST
 * bazi pickup akislarinda owner henuz oyuncuya yazilmadan calisiyor ve altin
 * gorunum ilk deploy'da atlaniyordu (Q ile gidip gelince duzeliyordu). Bu
 * event her gecişten SONRA tetiklendigi icin tek gecikmeli refresh kesindir. */
public OnCurWeaponEvent(id)
{
	if (!GOLD_FEATURES_ENABLED || !is_user_alive(id))
		return;

	new wid = read_data(2);

	/* Yerden alinan altin silah bu mu? Guncel edict'i yeniden isaretle. */
	if (g_pendingGoldWeaponId[id] && g_pendingGoldWeaponId[id] == wid
		&& get_gametime() < g_pendingGoldUntil[id])
	{
		new ent = fm_get_user_weapon_entity(id);
		if (ent > 0 && ent < MAX_EDICTS_GOLD && pev_valid(ent))
		{
			g_weaponGolden[ent] = true;
			g_pendingGoldWeaponId[id] = 0;
		}
	}

	/* Refresh sadece gerekliyse planla: eldeki silah altin isaretli veya
	 * sahibi Gold/Platinum. Digerlerinde hicbir sey yapma (maliyet ~0). */
	new curEnt = fm_get_user_weapon_entity(id);
	if (curEnt <= 0 || curEnt >= MAX_EDICTS_GOLD || !pev_valid(curEnt))
		return;
	if (!g_weaponGolden[curEnt] && !(g_vip[id] && g_tier[id] >= TIER_GOLD))
		return;

	remove_task(id + 600);
	set_task(0.10, "TaskRefreshCurrentGoldenWeapon", id + 600);
}

public TaskConfirmGoldenWeaponEntity(data[])
{
	new ent = data[0];
	if (ent > 0 && ent < MAX_EDICTS_GOLD && pev_valid(ent))
		g_weaponGolden[ent] = true;
}

public OnVipUserInfoChanged(id, infobuffer)
{
	if (!is_user_connected(id) || !g_vip[id] || g_tier[id] < TIER_GOLD)
		return FMRES_IGNORED;
	/* Takim secim ekraninda oyuncu henuz spawn olmamisken model userinfo'su
	 * birkac kez degisir. Bu anda vip_* modelini zorlamak Xash WASM'de ilk
	 * giriste model/yukleme yarisi ve OOB crash uretebiliyor. Model yalnizca
	 * spawn sonrasi TaskApplyVipModel ile yazilir. */
	if (!is_user_alive(id))
		return FMRES_IGNORED;
	if (!g_vipModelVisualReady[id])
		return FMRES_IGNORED;
	if (!g_vipModel[id][0])
		return FMRES_IGNORED;
	if (!VipModelMatchesTeam(g_vipModel[id], VipGetTeam(id)))
		return FMRES_IGNORED;

	/* Oyun DLL'i bu forward'in ORIJINAL (pre) kismi icinde modeli zaten
	 * standarda sifirladi — biz POST'ta calisiyoruz, yani son yazan biziz. */
	new current[32];
	get_user_info(id, "model", current, charsmax(current));
	if (!equal(current, g_vipModel[id]))
	{
		engfunc(EngFunc_SetClientKeyValue, id, infobuffer, "model", g_vipModel[id]);
		log_amx("[VipModelDebug] OnVipUserInfoChanged id=%d gamedll-set=%s -> forced=%s", id, current, g_vipModel[id]);
	}
	return FMRES_IGNORED;
}

/* NOT: plugin_precache() KASITLI OLARAK YOK. precache_model() cagirmak
 * sunucuyu bu 8 modeli HERKESE (VIP olmayanlar dahil) baglanti/precache
 * asamasinda zorla yukletmeye iter — WASM istemcisi bu asamada crash
 * verdi ("memory access out of bounds", baglanti aninda). Takim skini
 * (userinfo "model") zaten client-side VFS/pk3 uzerinden gecmisteki
 * "urban"/"gsg9" gibi stok isimlerle precache'siz calisiyordu; sadece
 * VIP modeli SECEN oyuncu icin lazy-load yeterli, precache gereksiz risk. */

public plugin_cfg()
{
	g_port = ResolveVipPort();
	if (g_port > 0)
		set_pcvar_num(g_cvarPort, g_port);

	LoadVipRoomGate();
	log_amx("[BrowserCS VIP] v%s enabled=%d port=%d vipRoomMin=%d", PLUGIN_VERSION, get_pcvar_num(g_cvarEnabled), g_port, g_vipRoomMinTier);
}

stock LoadVipRoomGate()
{
	g_vipRoomMinTier = 0;
	if (!file_exists(VIP_ONLY_FILE))
		return;

	new line[32], len;
	if (!read_file(VIP_ONLY_FILE, 0, line, charsmax(line), len))
		return;
	trim(line);
	if (equali(line, "gold") || equali(line, "2"))
		g_vipRoomMinTier = TIER_GOLD;
	else if (equali(line, "platinum") || equali(line, "3"))
		g_vipRoomMinTier = TIER_PLATINUM;
	else if (equali(line, "silver") || equali(line, "1"))
		g_vipRoomMinTier = TIER_SILVER;
}

stock EnforceVipRoom(id)
{
	if (g_vipRoomMinTier <= TIER_NONE)
		return;
	if (!is_user_connected(id) || is_user_bot(id) || is_user_hltv(id))
		return;

	if (g_vip[id] && g_tier[id] >= g_vipRoomMinTier)
		return;

	client_print(id, print_chat, "[VIP ODA] Bu odaya sadece Gold veya Platinum VIP girebilir.");
	new userid = get_user_userid(id);
	if (userid > 0)
		server_cmd("kick #%d ^"VIP ODA — Gold/Platinum gerekli^"", userid);
}

/*
 * Never touch connecting clients. Xash drops mid-handshake if AMXX
 * sets flags / set_user_info(name|model) too early. Bind like rank:
 * only after putinserver, then delay cosmetics/flags further.
 */
public client_putinserver(id)
{
	if (!get_pcvar_num(g_cvarEnabled) || is_user_bot(id) || is_user_hltv(id))
		return;

	/* Takim secimi/spawn asamasinda ozel v_ model set etmek WASM istemciyi
	 * bozabiliyor. Golden viewmodel'leri ancak baglanti tamamen oturduktan
	 * sonra etkinlestir. */
	g_goldVisualReady[id] = false;
	g_vipModelVisualReady[id] = false;
	/* Xash WASM, ilk team/spawn paketleri devam ederken dynamic player/weapon
	 * modeli yazilirsa OOB ile dusuyor. Kozmetikleri baglanti oturduktan sonra
	 * tek seferde uygula. */
	set_task(8.0, "TaskEnableGoldenVisuals", id + 800);
	set_task(8.0, "TaskEnableVipModelVisuals", id + 900);

	/* Her baglantida clan tag varsayilan ACIK — oturum boyunca /clantag ile degistirilir. */
	g_clanTagEnabled[id] = true;

	new port = g_port;
	if (port <= 0)
		port = ResolveVipPort();
	if (port <= 0)
		return;
	g_port = port;

	/* setinfo _bcs_vip may arrive slightly after putinserver */
	set_task(0.5, "TaskBindVip", id);
	set_task(1.5, "TaskBindVip", id + 100);
	/* Flags only after client is fully settled (reserved slot via late flags). */
	set_task(2.0, "TaskApplyVipFlags", id + 200);
	/* VIP ODA: bilet gecikebilir — 4sn sonra tekrar kontrol, yetkisiz kick */
	if (g_vipRoomMinTier > TIER_NONE)
		set_task(4.0, "TaskVipRoomGate", id + 400);
	/* Give this newly-connected client the current roster right away —
	 * otherwise they only see badges after the next 30s safety broadcast. */
	set_task(2.6, "TaskSendVipRosterToNew", id);
}

public TaskSendVipRosterToNew(id)
{
	if (!is_user_connected(id))
		return;
	SendVipRosterTo(id);
}

public TaskBindVip(taskid)
{
	new id = taskid;
	if (id >= 100)
		id -= 100;

	if (!is_user_connected(id) || !get_pcvar_num(g_cvarEnabled))
		return;

	new port = g_port;
	if (port <= 0)
		port = ResolveVipPort();
	if (port <= 0)
		return;
	g_port = port;

	BindVipIdentity(id, port);
}

public TaskApplyVipFlags(taskid)
{
	new id = taskid;
	if (id >= 200)
		id -= 200;

	if (!is_user_connected(id) || !get_pcvar_num(g_cvarEnabled))
		return;

	if (!g_vip[id])
	{
		new port = g_port;
		if (port <= 0)
			port = ResolveVipPort();
		if (port > 0)
			BindVipIdentity(id, port);
	}

	ApplyVipFlags(id);
	EnforceVipRoom(id);
}

public TaskVipRoomGate(taskid)
{
	new id = taskid;
	if (id >= 400)
		id -= 400;
	if (!is_user_connected(id))
		return;
	if (!g_vip[id])
	{
		new port = g_port;
		if (port <= 0)
			port = ResolveVipPort();
		if (port > 0)
			BindVipIdentity(id, port);
	}
	EnforceVipRoom(id);
}

public client_disconnect(id)
{
	new bool:wasVip = g_vip[id];
	ClearSlot(id);
	if (wasVip)
		BroadcastVipRoster();
}

public client_infochanged(id)
{
	/* Late _bcs_vip setinfo after browser handshake — bind only, no name rewrite. */
	if (!get_pcvar_num(g_cvarEnabled) || !is_user_connected(id))
		return;
	if (is_user_bot(id) || is_user_hltv(id))
		return;
	if (g_vip[id])
		return;

	set_task(0.25, "TaskBindVip", id);
	set_task(2.0, "TaskApplyVipFlags", id + 200);
}

ClearSlot(id)
{
	g_userId[id][0] = 0;
	g_displayName[id][0] = 0;
	g_tier[id] = TIER_NONE;
	g_clanTag[id][0] = 0;
	g_vip[id] = false;
	g_namePrefixed[id] = false;
	g_roundBonusDone[id] = false;
	g_goldVisualReady[id] = false;
	g_vipModelVisualReady[id] = false;
	g_vipModel[id][0] = 0;
	g_pendingGoldWeaponId[id] = 0;
	g_pendingGoldUntil[id] = 0.0;
}

BindVipIdentity(id, port)
{
	new ticket[TICKET_LEN];
	get_user_info(id, "_bcs_vip", ticket, charsmax(ticket));
	SanitizeTicket(ticket, charsmax(ticket));

	if (!ticket[0])
	{
		ClearSlot(id);
		return;
	}

	new userId[USER_ID_LEN], displayName[NAME_LEN], tierStr[TIER_LEN], clanTag[TAG_LEN];
	new sessionPort, tier;

	if (!LookupVipSession(ticket, port, userId, charsmax(userId), displayName, charsmax(displayName), tierStr, charsmax(tierStr), clanTag, charsmax(clanTag), sessionPort))
	{
		ClearSlot(id);
		log_amx("[BrowserCS VIP] invalid/expired ticket for #%d", id);
		return;
	}

	tier = TierFromString(tierStr);
	if (tier < TIER_SILVER)
	{
		ClearSlot(id);
		return;
	}

	copy(g_userId[id], charsmax(g_userId[]), userId);
	copy(g_displayName[id], charsmax(g_displayName[]), displayName);
	copy(g_clanTag[id], charsmax(g_clanTag[]), clanTag);
	g_tier[id] = tier;
	g_vip[id] = true;

	/* Identity only here. Flags deferred (TaskApplyVipFlags). Name prefix
	 * disabled by default — set_user_info(name) breaks Xash browser clients. */

	log_amx("[BrowserCS VIP] bound #%d tier=%s user=%s", id, tierStr, userId);

	/* Everyone should see the VIP badge/color — broadcast the roster
	 * (client-side HTML scoreboard renders name/color per tier). */
	BroadcastVipRoster();

	/* _bcs_vip baglantidan sonra geldigi icin oyuncunun ilk tabanca/bicak
	 * deploy'u VIP baglanmadan once olmus olabilir. Aktif silahi yeniden
	 * uygula; oyuncunun bicaga gecip geri donmesini bekleme. */
	if (tier >= TIER_GOLD)
	{
		set_task(0.15, "TaskRefreshCurrentGoldenWeapon", id + 600);
		set_task(0.55, "TaskRefreshCurrentGoldenWeapon", id + 700);
	}
}

/* WHITELIST, not blacklist — roster string is stuffed into the client's
 * console command buffer via client_cmd("echo BROWSERCS_VIP_ROSTER|...").
 * A player name with '"', ';', '%', '`', '$' or control bytes can break out
 * of that command / get re-parsed by the client engine and corrupt its
 * state (manifests later as a client-side WASM "memory access out of
 * bounds" crash on the next chat print or death message — not immediately
 * on broadcast, which made this hard to trace back to the roster feature). */
SanitizeRosterToken(s[], len)
{
	new i;
	for (i = 0; s[i] != 0 && i < len; i++)
	{
		new c = s[i];
		new bool:ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
			|| c == ' ' || c == '-' || c == '.' || c == '_';
		if (!ok)
			s[i] = '_';
	}
}

BuildVipRoster(out[], outLen)
{
	out[0] = 0;

	new players[32], num, i, id, name[32], tierStr[16], len, clanOn;
	get_players(players, num, "ch");
	for (i = 0; i < num; i++)
	{
		id = players[i];
		if (!g_vip[id])
			continue;

		get_user_name(id, name, charsmax(name));
		SanitizeRosterToken(name, charsmax(name));
		TierName(g_tier[id], tierStr, charsmax(tierStr));
		clanOn = (g_tier[id] >= TIER_PLATINUM && g_clanTag[id][0] && g_clanTagEnabled[id]) ? 1 : 0;

		if (len > 0)
			len += formatex(out[len], outLen - len, ",");
		/* name:tier:clanOn — clanOn=1 ise scoreboard/chat'te sabit [BCS] etiketi gosterilir */
		len += formatex(out[len], outLen - len, "%s:%s:%d", name, tierStr, clanOn);
	}
}

SendVipRosterTo(id)
{
	new roster[480];
	BuildVipRoster(roster, charsmax(roster));
	client_cmd(id, "echo BROWSERCS_VIP_ROSTER|%s", roster);
	client_print(id, print_console, "[BROWSERCS_VIP_ROSTER]%s", roster);
}

public BroadcastVipRoster()
{
	new roster[480];
	BuildVipRoster(roster, charsmax(roster));

	new players[32], num, i, cmd[600];
	formatex(cmd, charsmax(cmd), "echo BROWSERCS_VIP_ROSTER|%s", roster);
	get_players(players, num, "ch");
	for (i = 0; i < num; i++)
	{
		client_cmd(players[i], "%s", cmd);
		client_print(players[i], print_console, "[BROWSERCS_VIP_ROSTER]%s", roster);
	}
}

ApplyVipFlags(id)
{
	if (!g_vip[id])
		return;

	if (g_tier[id] >= TIER_PLATINUM)
		set_user_flags(id, get_user_flags(id) | VIP_FLAGS_PLAT);
	else
		set_user_flags(id, get_user_flags(id) | VIP_FLAGS_BASE);
}

public TaskRefreshCurrentGoldenWeapon(taskid)
{
	new id = taskid;
	if (id >= 700)
		id -= 700;
	else if (id >= 600)
		id -= 600;

	/* Team menu/dead state'te weapon entity'sine custom model yazmak ilk
	 * baglantida WASM model yukleme yarisi olusturuyor. Silah gorunumu ancak
	 * oyuncu spawn olup tamamen canliyken uygulanir. */
	if (!is_user_alive(id))
		return;

	new ent = fm_get_user_weapon_entity(id);
	if (ent <= 0 || ent >= MAX_EDICTS_GOLD || !pev_valid(ent))
		return;

	if (g_vip[id] && g_tier[id] >= TIER_GOLD)
	{
		/* Gold/Platinum'un elindeki her silah kalici altin. */
		g_weaponGolden[ent] = true;
		OnGoldWeaponDeploy_Post(ent);
	}
	else if (g_weaponGolden[ent])
	{
		/* Misafir/Silver'in tasidigi (devralinmis) altin silah. */
		OnGoldWeaponDeploy_Post(ent);
	}
}

public TaskEnableGoldenVisuals(taskid)
{
	new id = taskid - 800;
	if (!is_user_connected(id))
		return;

	g_goldVisualReady[id] = true;
	log_amx("[VipInitTrace] gold visuals ready id=%d alive=%d", id, is_user_alive(id));

	/* Takim seciminde degil, yalnizca canli oyuncunun aktif silahini yenile. */
	if (g_vip[id] && g_tier[id] >= TIER_GOLD)
		TaskRefreshCurrentGoldenWeapon(id + 600);
}

public TaskEnableVipModelVisuals(taskid)
{
	new id = taskid - 900;
	if (!is_user_connected(id))
		return;

	g_vipModelVisualReady[id] = true;
	log_amx("[VipInitTrace] player model visuals ready id=%d alive=%d model=%s", id, is_user_alive(id), g_vipModel[id]);
	if (is_user_alive(id))
		ApplyVipModel(id);
}

bool:LookupVipSession(const ticket[], port, userId[], userIdLen, displayName[], displayNameLen, tierStr[], tierLen, clanTag[], clanTagLen, &outPort)
{
	userId[0] = 0;
	displayName[0] = 0;
	tierStr[0] = 0;
	clanTag[0] = 0;
	outPort = 0;

	if (!file_exists(SESSION_FILE))
		return false;

	new line[288], lineNumber, textLength;
	new tokTicket[TICKET_LEN], rest[240];
	new tokUser[USER_ID_LEN], tokName[NAME_LEN], tokTier[TIER_LEN];
	new tokPort[12], tokExp[16], tokTag[TAG_LEN];
	new now = get_systime();

	while (read_file(SESSION_FILE, lineNumber, line, charsmax(line), textLength))
	{
		lineNumber++;
		trim(line);
		if (!line[0] || line[0] == '#')
			continue;

		strtok(line, tokTicket, charsmax(tokTicket), rest, charsmax(rest), '|');
		strtok(rest, tokUser, charsmax(tokUser), rest, charsmax(rest), '|');
		strtok(rest, tokName, charsmax(tokName), rest, charsmax(rest), '|');
		strtok(rest, tokTier, charsmax(tokTier), rest, charsmax(rest), '|');
		strtok(rest, tokPort, charsmax(tokPort), rest, charsmax(rest), '|');
		strtok(rest, tokExp, charsmax(tokExp), tokTag, charsmax(tokTag), '|');

		trim(tokTicket);
		trim(tokUser);
		trim(tokName);
		trim(tokTier);
		trim(tokExp);
		trim(tokTag);

		if (!equali(tokTicket, ticket))
			continue;

		new sessPort = str_to_num(tokPort);
		new expires = str_to_num(tokExp);
		if (sessPort != port)
			return false;
		if (expires > 0 && expires < now)
			return false;
		if (!IsUuid(tokUser))
			return false;

		copy(userId, userIdLen, tokUser);
		copy(displayName, displayNameLen, tokName[0] ? tokName : "Oyuncu");
		copy(tierStr, tierLen, tokTier);
		copy(clanTag, clanTagLen, tokTag);
		Sanitize(displayName, displayNameLen);
		outPort = sessPort;
		return true;
	}

	return false;
}

TierFromString(const s[])
{
	if (equali(s, "platinum"))
		return TIER_PLATINUM;
	if (equali(s, "gold"))
		return TIER_GOLD;
	if (equali(s, "silver"))
		return TIER_SILVER;
	return TIER_NONE;
}

/* Platinum > Gold > Silver */
stock CompareVipPriority(idA, idB)
{
	return g_tier[idA] - g_tier[idB];
}

/* Priority kick disabled (bcs_vip_priority_kick default 0). Kept as stock for later. */
stock TryPrioritySlot(connectingId)
{
	if (!get_pcvar_num(g_cvarEnabled) || !get_pcvar_num(g_cvarPriorityKick))
		return;
	if (!is_user_connected(connectingId) || !g_vip[connectingId])
		return;
	if (g_tier[connectingId] < TIER_SILVER)
		return;

	new maxp = get_maxplayers();
	new players[32], num, i;
	get_players(players, num, "ch");
	if (num < maxp)
		return;

	new victim = 0;
	new victimTier = 999;

	for (i = 0; i < num; i++)
	{
		new pid = players[i];
		if (pid == connectingId)
			continue;
		if (is_user_bot(pid) || is_user_hltv(pid))
			continue;

		if (!g_vip[pid])
		{
			victim = pid;
			victimTier = TIER_NONE;
			break;
		}
		if (g_tier[pid] < victimTier)
		{
			victimTier = g_tier[pid];
			victim = pid;
		}
	}

	if (victim && victimTier < g_tier[connectingId])
	{
		new uid = get_user_userid(victim);
		server_cmd("kick #%d ^"VIP oncelikli rezerve slot^"", uid);
		log_amx("[BrowserCS VIP] priority kick #%d (tier %d) for #%d (tier %d)", victim, victimTier, connectingId, g_tier[connectingId]);
	}
}

StripLeadingToken(base[], const token[])
{
	if (!token[0] || contain(base, token) != 0)
		return;

	new i = strlen(token);
	while (base[i] == ' ')
		i++;

	new j, c;
	while ((c = base[i]) != 0 && j < 31)
	{
		base[j] = c;
		i++;
		j++;
	}
	base[j] = 0;
}

ApplyNamePrefix(id)
{
	/* Opt-in only via non-empty bcs_vip_prefix. Default "" = never touch name. */
	if (!is_user_connected(id) || !g_vip[id])
		return;

	new prefix[16];
	get_pcvar_string(g_cvarPrefix, prefix, charsmax(prefix));
	if (!prefix[0])
		return;

	new name[32], base[32], newname[32];
	get_user_name(id, name, charsmax(name));
	copy(base, charsmax(base), name);

	StripLeadingToken(base, prefix);
	if (g_tier[id] >= TIER_PLATINUM && g_clanTag[id][0])
		StripLeadingToken(base, g_clanTag[id]);

	if (!base[0])
		copy(base, charsmax(base), "Oyuncu");

	if (g_tier[id] >= TIER_PLATINUM && g_clanTag[id][0])
		formatex(newname, charsmax(newname), "%s %s %s", prefix, g_clanTag[id], base);
	else
		formatex(newname, charsmax(newname), "%s %s", prefix, base);

	if (strlen(newname) > 31)
	{
		new maxBase = 31 - strlen(prefix) - 1;
		if (g_tier[id] >= TIER_PLATINUM && g_clanTag[id][0])
			maxBase -= (strlen(g_clanTag[id]) + 1);
		if (maxBase < 3)
			maxBase = 3;
		base[maxBase] = 0;
		if (g_tier[id] >= TIER_PLATINUM && g_clanTag[id][0])
			formatex(newname, charsmax(newname), "%s %s %s", prefix, g_clanTag[id], base);
		else
			formatex(newname, charsmax(newname), "%s %s", prefix, base);
	}

	if (!equali(name, newname))
		set_user_info(id, "name", newname);

	g_namePrefixed[id] = true;
}

public TaskApplyNamePrefix(id)
{
	ApplyNamePrefix(id);
}

public OnRoundStart()
{
	new i;
	for (i = 1; i <= MAX_PLAYERS; i++)
		g_roundBonusDone[i] = false;
}

public OnPlayerSpawnPost(id)
{
	if (!is_user_alive(id) || !g_vip[id])
		return;

	log_amx("[VipInitTrace] spawn id=%d team=%d goldReady=%d modelReady=%d selected=%s", id, VipGetTeam(id), g_goldVisualReady[id], g_vipModelVisualReady[id], g_vipModel[id]);

	if (g_tier[id] >= TIER_GOLD)
	{
		set_task(0.35, "TaskVipSpawnBonus", id);
		set_task(0.80, "TaskRefreshCurrentGoldenWeapon", id + 600);
	}

	if (g_tier[id] >= TIER_GOLD && g_vipModelVisualReady[id] && g_vipModel[id][0])
		set_task(0.5, "TaskApplyVipModel", id);
}

public TaskVipSpawnBonus(id)
{
	if (!is_user_alive(id) || !g_vip[id] || g_tier[id] < TIER_GOLD)
		return;
	if (g_roundBonusDone[id])
		return;
	g_roundBonusDone[id] = true;

	GiveVipMoney(id);
	if (get_pcvar_num(g_cvarKevlar))
		GiveVipKevlar(id);

	if (g_tier[id] >= TIER_PLATINUM && get_pcvar_num(g_cvarPlatBonus) == 1)
	{
		if (VipGetTeam(id) == TEAM_CT)
			give_item(id, "item_thighpack");
	}
}

GiveVipMoney(id)
{
	new bonus;
	if (g_tier[id] >= TIER_PLATINUM)
	{
		if (get_pcvar_num(g_cvarPlatBonus) == 1)
			bonus = get_pcvar_num(g_cvarMoneyGold); /* defuse mode: gold-level money */
		else
			bonus = get_pcvar_num(g_cvarMoneyPlat);
	}
	else
		bonus = get_pcvar_num(g_cvarMoneyGold);

	if (bonus < 0) bonus = 0;
	if (bonus > 800) bonus = 800;

	/* Mild random within ±100 of configured, still capped */
	new jitter = random_num(-50, 50);
	bonus += jitter;
	if (bonus < 200) bonus = 200;

	new money = VipGetMoney(id) + bonus;
	if (money > MONEY_CAP) money = MONEY_CAP;
	VipSetMoney(id, money, 1);
}

GiveVipKevlar(id)
{
	/* Modest kevlar only — no helmet spam */
	if (get_user_armor(id) < 100)
		set_user_armor(id, 100);
	give_item(id, "item_kevlar");
}

public TaskApplyVipModel(id)
{
	ApplyVipModel(id);
}

ApplyVipModel(id)
{
	if (!is_user_connected(id) || !g_vip[id] || g_tier[id] < TIER_GOLD)
		return;
	if (!g_vipModelVisualReady[id])
		return;
	if (!g_vipModel[id][0])
		return;
	/* Takim degistiyse eski secim gecersiz — varsayilan takim skinine dus */
	if (!VipModelMatchesTeam(g_vipModel[id], VipGetTeam(id)))
	{
		log_amx("[VipModelDebug] ApplyVipModel id=%d team-mismatch model=%s team=%d — reset", id, g_vipModel[id], VipGetTeam(id));
		g_vipModel[id][0] = 0;
		return;
	}
	VipApplyModel(id, g_vipModel[id]);
}

/* --- cstrike-free helpers (fakemeta / engine / fun) --- */

stock VipGetTeam(id)
{
	new team = pev(id, pev_team);
	if (team == TEAM_T || team == TEAM_CT)
		return team;
	return get_user_team(id);
}

/* Kayitli VIP modeli oyuncunun SU ANKI takimina uygun mu? Takim degistirince
 * eski secim gecersiz sayilir — varsayilan takim skinine dusulur. */
stock bool:VipModelMatchesTeam(const model[], team)
{
	new i;
	if (team == TEAM_CT)
	{
		for (i = 0; i < sizeof g_classicModelsCT; i++)
			if (equal(model, g_classicModelsCT[i])) return true;
		return false;
	}
	if (team == TEAM_T)
	{
		for (i = 0; i < sizeof g_classicModelsT; i++)
			if (equal(model, g_classicModelsT[i])) return true;
		return false;
	}
	return false;
}

/* Scoreboard/HUD rozetleriyle ayni renk paleti (hudBridge.js VIP_TIER_STYLE). */
stock VipTierColor(tier, &r, &g, &b)
{
	switch (tier)
	{
		case TIER_SILVER:   { r = 231; g = 237; b = 241; }
		case TIER_GOLD:     { r = 255; g = 215; b = 0;   }
		case TIER_PLATINUM: { r = 29;  g = 233; b = 182; }
		default:            { r = 255; g = 255; b = 255; }
	}
}

/* KALDIRILDI (v1.3.x): Kolluk/aksesuar yerine denenen 2 native temp-entity
 * efekti de bu Xash3D/WASM istemcisinde calismadi:
 *
 * 1) TE_ELIGHT (takim-ici bas isigi) — motor duzgun parse edemedi, hem
 *    gorunmuyordu hem de surekli tekrar (1s'de bir, tum takima) "memory
 *    access out of bounds" client crash'ine yol acti.
 *
 * 2) TE_SPARKS + TE_DLIGHT (olum kivilcim/renk patlamasi) — server-side
 *    dogru calisip mesaji gonderdi (log ile dogrulandi), crash de yoktu,
 *    AMA hicbir sey gorunmedi. Kok sebep engine.js'te istemcinin
 *    +r_dynamic 0 ile ACILMASI: TE_DLIGHT tum dunyada butun dinamik
 *    isiklari devre disi biraktigi icin dlight nesnesi olusuyor ama asla
 *    isik yaymiyor. TE_SPARKS ise zaten renksiz (sabit beyaz/sari), tier
 *    rengini hic tasiyamiyor. r_dynamic'i global acmak butun oyunun
 *    performansini/gorsellerini (namlu atesi, patlama isiklari dahil)
 *    etkiler — kontrolsuz denenmedi.
 *
 * Sonuc: bu motor build'inde renkli/isikli 3D VIP efekti pratik degil.
 * VIP ayrimi icin scoreboard/isim rozetleri (hudBridge.js) kullaniliyor —
 * bu yaklasim stabil ve calisiyor. */

stock VipGetMoney(id)
{
	return get_pdata_int(id, OFFSET_MONEY, XO_PLAYER);
}

stock VipSetMoney(id, amount, flash)
{
	if (amount < 0) amount = 0;
	if (amount > MONEY_CAP) amount = MONEY_CAP;

	set_pdata_int(id, OFFSET_MONEY, amount, XO_PLAYER);

	if (g_msgMoney && is_user_connected(id))
	{
		message_begin(MSG_ONE, g_msgMoney, {0, 0, 0}, id);
		write_long(amount);
		write_byte(flash ? 1 : 0);
		message_end();
	}
}

stock VipApplyModel(id, const model[])
{
	if (!is_user_connected(id) || !model[0])
		return;

	new buffer = engfunc(EngFunc_GetInfoKeyBuffer, id);
	engfunc(EngFunc_SetClientKeyValue, id, buffer, "model", model);
	set_user_info(id, "model", model);

	/* Userinfo tek basina ReGameDLL'nin player modelindex'ini degistirmiyor.
	 * Precache edilmis gercek model yolunu entity'ye de yaz; bu sayede hem
	 * oyuncu hem spectator/corpse ayni VIP modelini gorur. */
	new modelPath[64];
	formatex(modelPath, charsmax(modelPath), "models/player/%s/%s.mdl", model, model);
	engfunc(EngFunc_SetModel, id, modelPath);

	new check[32];
	get_user_info(id, "model", check, charsmax(check));
	log_amx("[VipModelDebug] VipApplyModel id=%d requested=%s readback=%s modelpath=%s modelindex=%d", id, model, check, modelPath, pev(id, pev_modelindex));
}

public CmdVipMenu(id)
{
	if (!is_user_connected(id))
		return PLUGIN_HANDLED;

	if (!g_vip[id])
	{
		client_print(id, print_chat, "[VIP] Aktif aboneligin yok. Silver 49 / Gold 99 / Platinum 199 TL.");
		return PLUGIN_HANDLED;
	}

	new tierName[16];
	TierName(g_tier[id], tierName, charsmax(tierName));

	if (g_tier[id] >= TIER_GOLD)
	{
		client_print(id, print_chat, "[VIP] Durum: %s | /vipmodel klasik model | round para+kevlar aktif", tierName);
		if (g_tier[id] >= TIER_PLATINUM && g_clanTag[id][0])
			client_print(id, print_chat, "[VIP] Clan tag: %s (%s) | /clantag ile ac/kapa | oncelikli slot aktif", g_clanTag[id], g_clanTagEnabled[id] ? "ACIK" : "KAPALI");
	}
	else
	{
		client_print(id, print_chat, "[VIP] Durum: %s | rezerve slot + votekick bagisikligi", tierName);
	}
	return PLUGIN_HANDLED;
}

public CmdClanTagToggle(id)
{
	if (!is_user_connected(id))
		return PLUGIN_HANDLED;

	if (!g_vip[id] || g_tier[id] < TIER_PLATINUM)
	{
		client_print(id, print_chat, "[VIP] Clan tag ozelligi sadece Platinum uyeler icin.");
		return PLUGIN_HANDLED;
	}

	g_clanTagEnabled[id] = !g_clanTagEnabled[id];
	client_print(id, print_chat, "[VIP] [BCS] clan tag: %s", g_clanTagEnabled[id] ? "ACIK" : "KAPALI");
	BroadcastVipRoster();
	return PLUGIN_HANDLED;
}

public CmdVipModelMenu(id)
{
	if (!is_user_connected(id))
		return PLUGIN_HANDLED;

	if (!g_vip[id] || g_tier[id] < TIER_GOLD)
	{
		client_print(id, print_chat, "[VIP] Klasik model menusu Gold/Platinum icin.");
		return PLUGIN_HANDLED;
	}

	new team = VipGetTeam(id);
	if (team != TEAM_CT && team != TEAM_T)
	{
		client_print(id, print_chat, "[VIP] Once bir takim sec (CT/T), sonra /vipmodel yaz.");
		return PLUGIN_HANDLED;
	}

	/* Takim disi model gosterilmez — CT sadece CT, T sadece T listesini gorur */
	new menu[512], len;
	len = formatex(menu, charsmax(menu), "\yKlasik VIP Modeller (%s)^n^n", (team == TEAM_CT) ? "CT" : "T");
	new i, keys, label[24];
	if (team == TEAM_CT)
	{
		for (i = 0; i < sizeof g_classicModelsCT; i++)
		{
			VipModelLabel(g_classicModelsCT[i], label, charsmax(label));
			len += formatex(menu[len], charsmax(menu) - len, "\r%d. \w%s^n", i + 1, label);
			keys |= (1 << i);
		}
	}
	else
	{
		for (i = 0; i < sizeof g_classicModelsT; i++)
		{
			VipModelLabel(g_classicModelsT[i], label, charsmax(label));
			len += formatex(menu[len], charsmax(menu) - len, "\r%d. \w%s^n", i + 1, label);
			keys |= (1 << i);
		}
	}
	len += formatex(menu[len], charsmax(menu) - len, "^n\r0. \wKapat");
	keys |= MENU_KEY_0;
	show_menu(id, keys, menu, 20, MENU_VIP_MODELS);
	return PLUGIN_HANDLED;
}

/* "vip_urban" -> "Urban" — menude gosterilecek temiz isim, gercek model
 * adi (set_user_info icin) degismez. */
stock VipModelLabel(const model[], out[], outLen)
{
	new src[32];
	copy(src, charsmax(src), model);
	new startIdx = (equal(src, "vip_", 4)) ? 4 : 0;
	copy(out, outLen, src[startIdx]);
	if (out[0])
		out[0] = toupper(out[0]);
}

public MenuVipModels(id, key)
{
	if (key == 9 || !g_vip[id] || g_tier[id] < TIER_GOLD)
		return PLUGIN_HANDLED;

	/* Secim anindaki takima gore dogrula — menu acikken takim degisse bile
	 * gecerli takimin listesinden secilmis olur, karisik model atanmaz. */
	new team = VipGetTeam(id);
	if (team != TEAM_CT && team != TEAM_T)
		return PLUGIN_HANDLED;

	if (team == TEAM_CT)
	{
		if (key < 0 || key >= sizeof g_classicModelsCT)
			return PLUGIN_HANDLED;
		copy(g_vipModel[id], charsmax(g_vipModel[]), g_classicModelsCT[key]);
	}
	else
	{
		if (key < 0 || key >= sizeof g_classicModelsT)
			return PLUGIN_HANDLED;
		copy(g_vipModel[id], charsmax(g_vipModel[]), g_classicModelsT[key]);
	}

	log_amx("[VipModelDebug] id=%d key=%d team=%d selected=%s alive=%d", id, key, team, g_vipModel[id], is_user_alive(id));

	if (is_user_alive(id))
		ApplyVipModel(id);

	new label[24];
	VipModelLabel(g_vipModel[id], label, charsmax(label));
	client_print(id, print_chat, "[VIP] Model: %s", label);
	return PLUGIN_HANDLED;
}

public OnVipSay(id)
{
	return PLUGIN_CONTINUE;
}

TierName(tier, out[], len)
{
	if (tier >= TIER_PLATINUM)
		copy(out, len, "Platinum");
	else if (tier >= TIER_GOLD)
		copy(out, len, "Gold");
	else if (tier >= TIER_SILVER)
		copy(out, len, "Silver");
	else
		copy(out, len, "Yok");
}

bool:IsUuid(const s[])
{
	if (strlen(s) != 36)
		return false;
	if (s[8] != '-' || s[13] != '-' || s[18] != '-' || s[23] != '-')
		return false;
	return true;
}

ResolveVipPort()
{
	new buf[32], port;

	port = get_pcvar_num(g_cvarPort);
	if (port > 0)
		return port;

	get_localinfo("bcs_rank_port", buf, charsmax(buf));
	port = str_to_num(buf);
	if (port > 0)
		return port;

	get_localinfo("bcs_vip_port", buf, charsmax(buf));
	port = str_to_num(buf);
	if (port > 0)
		return port;

	if (file_exists(PORT_FILE))
	{
		new line[32], len;
		if (read_file(PORT_FILE, 0, line, charsmax(line), len))
		{
			trim(line);
			port = str_to_num(line);
			if (port > 0)
				return port;
		}
	}

	/* plugin_precache() gibi cok erken asamalarda cvar/localinfo henuz
	 * server.cfg tarafindan set edilmemis olabilir (+servercfgfile komut
	 * kuyruğu ilk frame'de islenir, precache ondan once calisir) — ayni
	 * per-container server.cfg dosyasini DOGRUDAN okuyup "bcs_rank_port"/
	 * "bcs_vip_port" satirindaki sayiyi cikariyoruz, engine'in onu isleme
	 * almasini beklemeden. */
	port = ReadPortFromServerCfg();
	if (port > 0)
		return port;

	return 0;
}

ReadPortFromServerCfg()
{
	if (!file_exists("server.cfg"))
		return 0;

	new line[128], len, lineNum;
	while (read_file("server.cfg", lineNum, line, charsmax(line), len))
	{
		lineNum++;
		trim(line);
		if (!line[0] || line[0] == '/' || line[0] == '#')
			continue;
		if (contain(line, "bcs_rank_port") == -1 && contain(line, "bcs_vip_port") == -1)
			continue;

		new tok[32], rest[100], lastNum;
		copy(rest, charsmax(rest), line);
		while (rest[0])
		{
			strtok(rest, tok, charsmax(tok), rest, charsmax(rest), ' ');
			trim(tok);
			new n = str_to_num(tok);
			if (n > 1000)
				lastNum = n;
		}
		if (lastNum > 0)
			return lastNum;
	}
	return 0;
}

SanitizeTicket(s[], len)
{
	new i, j, c;
	new out[TICKET_LEN];
	for (i = 0; s[i] != 0 && j < charsmax(out); i++)
	{
		c = s[i];
		if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'))
			out[j++] = c;
	}
	out[j] = 0;
	copy(s, len, out);
}

Sanitize(s[], len)
{
	new i;
	for (i = 0; s[i] != 0 && i < len; i++)
	{
		if (s[i] < 32 || s[i] == '|' || s[i] == '<' || s[i] == '>')
			s[i] = '_';
	}
}
