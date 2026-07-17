#include <amxmodx>
#include <fun>

#define PLUGIN_NAME "BrowserCS Map Rotate"
#define PLUGIN_VERSION "1.1.0"
#define PLUGIN_AUTHOR "BrowserCS"
#define SERVER_CONFIG_PATH "server.cfg"

new const g_OfficialMaps[][] = {
	"de_dust2",
	"de_inferno",
	"de_aztec",
	"de_dust",
	"fy_iceworld"
};

new g_cvarNextMap;
new bool:g_changing;
new g_msgScoreInfo;

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);

	g_cvarNextMap = register_cvar(
		"browsercs_nextmap",
		"",
		FCVAR_SERVER
	);

	g_msgScoreInfo = get_user_msgid("ScoreInfo");
	register_event("30", "BrowserCS_OnIntermission", "a");
}

public plugin_cfg()
{
	BrowserCS_LoadNextMapConfig();
	g_changing = false;
	// Her map yüklenişinde skorları temizle (admin changelevel / mapcycle)
	set_task(0.8, "BrowserCS_DelayedScoreReset");
	set_task(2.5, "BrowserCS_DelayedScoreReset");
}

public BrowserCS_DelayedScoreReset()
{
	BrowserCS_ResetScores();
}

stock BrowserCS_LoadNextMapConfig()
{
	new line[192];
	new lineNumber;
	new textLength;

	while (
		read_file(
			SERVER_CONFIG_PATH,
			lineNumber,
			line,
			charsmax(line),
			textLength
		)
	)
	{
		lineNumber++;
		trim(line);

		if (
			!line[0] ||
			line[0] == ';' ||
			(line[0] == '/' && line[1] == '/')
		)
		{
			continue;
		}

		new cvarName[64];
		new cvarValue[64];

		parse(
			line,
			cvarName,
			charsmax(cvarName),
			cvarValue,
			charsmax(cvarValue)
		);

		if (!equali(cvarName, "browsercs_nextmap"))
			continue;

		remove_quotes(cvarValue);
		trim(cvarValue);
		set_pcvar_string(g_cvarNextMap, cvarValue);
	}
}

stock BrowserCS_GetNextInRotation(const currentMap[], dest[], len)
{
	new idx = -1;

	for (new i = 0; i < sizeof(g_OfficialMaps); i++)
	{
		if (equali(currentMap, g_OfficialMaps[i]))
		{
			idx = i;
			break;
		}
	}

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

	if (is_map_valid(mapName))
		return true;

	new copyMap[64];
	copy(copyMap, charsmax(copyMap), mapName);

	new mapLen = strlen(copyMap);
	if (mapLen > 4 && equali(copyMap[mapLen - 4], ".bsp"))
	{
		copyMap[mapLen - 4] = 0;
		if (is_map_valid(copyMap))
			return true;
	}

	return false;
}

stock BrowserCS_SyncScoreInfo(id)
{
	if (!g_msgScoreInfo || !is_user_connected(id))
		return;

	message_begin(MSG_ALL, g_msgScoreInfo);
	write_byte(id);
	write_short(get_user_frags(id));
	write_short(0); // deaths
	write_short(0);
	write_short(get_user_team(id));
	message_end();
}

stock BrowserCS_ResetScores()
{
	new players[32], num;
	get_players(players, num, "ch");

	for (new i = 0; i < num; i++)
	{
		new id = players[i];
		set_user_frags(id, 0);
		BrowserCS_SyncScoreInfo(id);
	}
}

public BrowserCS_OnIntermission()
{
	if (g_changing)
		return;

	// Sabit harita (mp_timelimit 0): otomatik rotate yok, ama skor yine sıfırlansın
	BrowserCS_ResetScores();

	if (get_cvar_float("mp_timelimit") <= 0.0)
		return;

	g_changing = true;

	new nextMap[64];
	new currentMap[64];

	get_mapname(currentMap, charsmax(currentMap));
	get_pcvar_string(g_cvarNextMap, nextMap, charsmax(nextMap));
	trim(nextMap);

	if (!BrowserCS_IsValidMap(nextMap))
	{
		BrowserCS_GetNextInRotation(currentMap, nextMap, charsmax(nextMap));
	}

	// Aynı haritaya kilitliyse changelevel yapma
	if (equali(nextMap, currentMap))
	{
		g_changing = false;
		return;
	}

	client_print(
		0,
		print_chat,
		"[BrowserCS] Harita degisiyor: %s",
		nextMap
	);

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

	BrowserCS_ResetScores();
	server_cmd("changelevel %s", nextMap);
}
