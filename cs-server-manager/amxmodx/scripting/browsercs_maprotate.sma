#include <amxmodx>

#define PLUGIN_NAME "BrowserCS Map Rotate"
#define PLUGIN_VERSION "1.3.0"
#define PLUGIN_AUTHOR "BrowserCS"

#define VOTE_TIMELEFT_SEC 180
#define VOTE_MENU_SEC 15
#define SELECTMAPS 5
#define MAX_PINNED 2
#define QUEUE_FILE "addons/amxmodx/data/vip_map_queue.txt"
#define PORT_FILE "addons/amxmodx/configs/browsercs_rank_port.txt"

new const g_OfficialMaps[][] = {
	"de_dust2",
	"de_inferno",
	"de_aztec",
	"de_dust",
	"fy_iceworld",
	"de_nuke",
	"cs_assault",
	"cs_office",
	"de_train",
	"de_cbble"
};

new g_cvarNextMap;
new bool:g_changing;
new bool:g_voteStarted;
new bool:g_voteDone;
new Float:g_mapStartTime;

new g_nextName[SELECTMAPS];
new g_voteCount[SELECTMAPS + 1];
new g_mapVoteNum;
new g_port;

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);
	g_cvarNextMap = register_cvar("browsercs_nextmap", "", FCVAR_SERVER);
	register_event("30", "BrowserCS_OnIntermission", "a");
	register_menucmd(register_menuid("BrowserCS Next Map"), 1023, "BrowserCS_CountVote");
	set_task(5.0, "BrowserCS_VoteTick", _, _, _, "b");
	log_amx("[BrowserCS] Map Rotate %s loaded (vote at %ds left, VIP pin)", PLUGIN_VERSION, VOTE_TIMELEFT_SEC);
	server_print("[BrowserCS] Map Rotate %s loaded", PLUGIN_VERSION);
}

public plugin_cfg()
{
	g_changing = false;
	g_voteStarted = false;
	g_voteDone = false;
	g_mapStartTime = get_gametime();
	g_port = BrowserCS_ResolvePort();
}

stock BrowserCS_ResolvePort()
{
	new buf[32], port, line[32], len;
	get_localinfo("bcs_rank_port", buf, charsmax(buf));
	port = str_to_num(buf);
	if (port > 0)
		return port;
	if (file_exists(PORT_FILE))
	{
		if (read_file(PORT_FILE, 0, line, charsmax(line), len))
		{
			trim(line);
			port = str_to_num(line);
			if (port > 0)
				return port;
		}
	}
	return 0;
}

stock BrowserCS_MapIndex(const mapName[])
{
	for (new i = 0; i < sizeof(g_OfficialMaps); i++)
	{
		if (equali(mapName, g_OfficialMaps[i]))
			return i;
	}
	return -1;
}

stock BrowserCS_GetNextInRotation(const currentMap[], dest[], len)
{
	new idx = BrowserCS_MapIndex(currentMap);
	if (idx == -1)
	{
		copy(dest, len, "de_dust2");
		return;
	}
	copy(dest, len, g_OfficialMaps[(idx + 1) % sizeof(g_OfficialMaps)]);
}

stock bool:BrowserCS_IsValidMap(const mapName[])
{
	if (!mapName[0])
		return false;
	return is_map_valid(mapName) != 0;
}

public BrowserCS_VoteTick()
{
	if (g_voteStarted || g_voteDone || g_changing)
		return;
	if (get_cvar_float("mp_timelimit") <= 0.0)
		return;
	new timeleft = get_timeleft();
	if (timeleft < 1 || timeleft > (VOTE_TIMELEFT_SEC + 10))
		return;
	BrowserCS_StartVote();
}

stock bool:BrowserCS_IsInMenu(id)
{
	for (new a = 0; a < g_mapVoteNum; ++a)
		if (id == g_nextName[a])
			return true;
	return false;
}

/**
 * Platinum VIP önerilerini oylama menüsüne pinler.
 * Satır: map|port|userId|unix
 * port=0 → herhangi bir sunucu; aksi halde sadece eşleşen port.
 * Kullanılan satırlar kuyruktan silinir.
 */
stock BrowserCS_SplitQueueLine(const line[], map[], mapLen, portStr[], portLen)
{
	new i, j;
	map[0] = 0;
	portStr[0] = 0;
	for (i = 0; line[i] && line[i] != '|' && i < mapLen; i++)
		map[i] = line[i];
	map[i] = 0;
	if (line[i] == '|')
		i++;
	for (j = 0; line[i] && line[i] != '|' && j < portLen; i++, j++)
		portStr[j] = line[i];
	portStr[j] = 0;
}

stock BrowserCS_ConsumePinned(pinned[], &pinnedCount, const currentMap[])
{
	pinnedCount = 0;
	if (!file_exists(QUEUE_FILE))
		return;

	new line[192], map[32], portStr[16], keep[64][192], keepCount;
	new len, linePort, mapIdx, i, fh, size;
	new bool:alreadyPinned;
	keepCount = 0;
	size = file_size(QUEUE_FILE, 1);
	if (size < 0)
		size = 0;

	for (i = 0; i < size; i++)
	{
		if (!read_file(QUEUE_FILE, i, line, charsmax(line), len))
			continue;
		trim(line);
		if (!line[0] || line[0] == ';')
			continue;

		BrowserCS_SplitQueueLine(line, map, charsmax(map), portStr, charsmax(portStr));
		trim(map);
		trim(portStr);
		linePort = str_to_num(portStr);
		mapIdx = BrowserCS_MapIndex(map);

		alreadyPinned = false;
		for (new p = 0; p < pinnedCount; p++)
		{
			if (pinned[p] == mapIdx)
			{
				alreadyPinned = true;
				break;
			}
		}

		if (mapIdx == -1 || equali(map, currentMap) || BrowserCS_IsInMenu(mapIdx) || alreadyPinned)
		{
			if (keepCount < 64)
				copy(keep[keepCount++], 191, line);
			continue;
		}

		/* Port eşleşmesi: 0 = her sunucu, aksi halde bu sunucu */
		if (linePort > 0 && g_port > 0 && linePort != g_port)
		{
			if (keepCount < 64)
				copy(keep[keepCount++], 191, line);
			continue;
		}

		if (pinnedCount < MAX_PINNED && pinnedCount < SELECTMAPS)
		{
			pinned[pinnedCount++] = mapIdx;
			client_print(0, print_chat, "[BrowserCS] VIP harita onerisi oylamada: %s", g_OfficialMaps[mapIdx]);
			log_amx("[BrowserCS] VIP pin map=%s port=%d", g_OfficialMaps[mapIdx], g_port);
		}
		else if (keepCount < 64)
		{
			copy(keep[keepCount++], 191, line);
		}
	}

	delete_file(QUEUE_FILE);
	if (keepCount > 0)
	{
		fh = fopen(QUEUE_FILE, "wt");
		if (fh)
		{
			for (i = 0; i < keepCount; i++)
			{
				fputs(fh, keep[i]);
				fputs(fh, "^n");
			}
			fclose(fh);
		}
	}
}

stock BrowserCS_StartVote()
{
	g_voteStarted = true;
	if (g_port <= 0)
		g_port = BrowserCS_ResolvePort();

	new currentMap[32];
	get_mapname(currentMap, charsmax(currentMap));

	new menu[512];
	new pos = format(menu, charsmax(menu), "\yBrowserCS — Sonraki harita:\w^n^n");
	new keys = 0;

	g_mapVoteNum = 0;
	new dmax = SELECTMAPS;
	if (dmax > sizeof(g_OfficialMaps))
		dmax = sizeof(g_OfficialMaps);

	new pinned[MAX_PINNED], pinnedCount;
	BrowserCS_ConsumePinned(pinned, pinnedCount, currentMap);

	for (new p = 0; p < pinnedCount && g_mapVoteNum < dmax; p++)
	{
		g_nextName[g_mapVoteNum] = pinned[p];
		pos += format(menu[pos], charsmax(menu) - pos, "%d. %s \r(VIP)^n\w", g_mapVoteNum + 1, g_OfficialMaps[pinned[p]]);
		keys |= (1 << g_mapVoteNum);
		g_voteCount[g_mapVoteNum] = 0;
		g_mapVoteNum++;
	}

	while (g_mapVoteNum < dmax)
	{
		new a = random_num(0, sizeof(g_OfficialMaps) - 1);
		new guard = 0;
		while ((BrowserCS_IsInMenu(a) || equali(g_OfficialMaps[a], currentMap)) && guard < 40)
		{
			if (++a >= sizeof(g_OfficialMaps)) a = 0;
			guard++;
		}
		g_nextName[g_mapVoteNum] = a;
		pos += format(menu[pos], charsmax(menu) - pos, "%d. %s^n", g_mapVoteNum + 1, g_OfficialMaps[a]);
		keys |= (1 << g_mapVoteNum);
		g_voteCount[g_mapVoteNum] = 0;
		g_mapVoteNum++;
	}

	menu[pos++] = '^n';
	pos += format(menu[pos], charsmax(menu) - pos, "%d. Mevcut haritayi uzat (+10 dk)^n", SELECTMAPS + 1);
	keys |= (1 << SELECTMAPS);
	g_voteCount[SELECTMAPS] = 0;

	show_menu(0, keys, menu, VOTE_MENU_SEC, "BrowserCS Next Map");
	client_cmd(0, "spk Gman/Gman_Choose2");
	client_print(0, print_chat, "[BrowserCS] Sonraki harita oylamasi — %d saniye!", VOTE_MENU_SEC);
	log_amx("[BrowserCS] Map vote started (timeleft=%d pinned=%d)", get_timeleft(), pinnedCount);
	set_task(float(VOTE_MENU_SEC) + 0.5, "BrowserCS_FinishVote");
}

public BrowserCS_CountVote(id, key)
{
	if (key < 0 || key > SELECTMAPS)
		return PLUGIN_HANDLED;
	if (!g_voteStarted || g_voteDone)
		return PLUGIN_HANDLED;

	g_voteCount[key]++;
	new name[32];
	get_user_name(id, name, charsmax(name));
	if (key == SELECTMAPS)
		client_print(0, print_chat, "[BrowserCS] %s: haritayi uzat", name);
	else if (key < g_mapVoteNum)
		client_print(0, print_chat, "[BrowserCS] %s: %s", name, g_OfficialMaps[g_nextName[key]]);
	return PLUGIN_HANDLED;
}

public BrowserCS_FinishVote()
{
	if (g_voteDone)
		return;
	g_voteDone = true;

	new best = 0;
	for (new a = 1; a <= SELECTMAPS; ++a)
		if (g_voteCount[a] > g_voteCount[best])
			best = a;

	if (g_voteCount[best] <= 0)
	{
		new currentMap[64], nextMap[64];
		get_mapname(currentMap, charsmax(currentMap));
		BrowserCS_GetNextInRotation(currentMap, nextMap, charsmax(nextMap));
		set_pcvar_string(g_cvarNextMap, nextMap);
		client_print(0, print_chat, "[BrowserCS] Oy yok — sonraki harita: %s", nextMap);
		return;
	}

	if (best == SELECTMAPS)
	{
		new Float:tl = get_cvar_float("mp_timelimit");
		set_cvar_float("mp_timelimit", tl + 10.0);
		g_voteStarted = false;
		g_voteDone = false;
		client_print(0, print_chat, "[BrowserCS] Harita 10 dakika uzatildi (toplam %.0f dk).", tl + 10.0);
		return;
	}

	new nextMap[64];
	copy(nextMap, charsmax(nextMap), g_OfficialMaps[g_nextName[best]]);
	set_pcvar_string(g_cvarNextMap, nextMap);
	if (cvar_exists("amx_nextmap"))
		set_cvar_string("amx_nextmap", nextMap);
	client_print(0, print_chat, "[BrowserCS] Sonraki harita: %s", nextMap);
	log_amx("[BrowserCS] Map vote finished — next=%s", nextMap);
}

public BrowserCS_OnIntermission()
{
	if (g_changing)
		return;
	if ((get_gametime() - g_mapStartTime) < 60.0)
		return;
	if (get_cvar_float("mp_timelimit") <= 0.0)
		return;

	g_changing = true;
	new nextMap[64], currentMap[64];
	get_mapname(currentMap, charsmax(currentMap));
	get_pcvar_string(g_cvarNextMap, nextMap, charsmax(nextMap));
	trim(nextMap);

	if (!BrowserCS_IsValidMap(nextMap) && cvar_exists("amx_nextmap"))
	{
		get_cvar_string("amx_nextmap", nextMap, charsmax(nextMap));
		trim(nextMap);
	}
	if (!BrowserCS_IsValidMap(nextMap))
		BrowserCS_GetNextInRotation(currentMap, nextMap, charsmax(nextMap));

	if (equali(nextMap, currentMap))
	{
		g_changing = false;
		return;
	}

	client_print(0, print_chat, "[BrowserCS] Harita degisiyor: %s", nextMap);
	new Float:delay = get_cvar_float("mp_chattime");
	if (delay < 4.0)
		delay = 4.0;
	set_task(delay, "BrowserCS_DoChangeLevel", 0, nextMap, strlen(nextMap) + 1);
}

public BrowserCS_DoChangeLevel(nextMap[])
{
	new following[64];
	BrowserCS_GetNextInRotation(nextMap, following, charsmax(following));
	set_pcvar_string(g_cvarNextMap, following);
	server_cmd("changelevel %s", nextMap);
}
