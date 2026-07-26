#include <amxmodx>

#define PLUGIN_NAME "BrowserCS Match Mode"
#define PLUGIN_VERSION "1.0.0"
#define PLUGIN_AUTHOR "BrowserCS"

#define MATCH_MAX_PLAYERS 10

new g_cvar_match;
new g_cvar_maxplayers;

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);

	g_cvar_match = register_cvar("browsercs_match", "0");
	g_cvar_maxplayers = register_cvar("browsercs_match_maxplayers", "10");
}

public plugin_cfg()
{
	match_try_enable_from_mode_file();

	if (get_pcvar_num(g_cvar_match) != 1)
	{
		return;
	}

	log_amx("[BrowserCS Match] Match mode active — max %d players", get_pcvar_num(g_cvar_maxplayers));
}

public client_connect(id)
{
	if (get_pcvar_num(g_cvar_match) != 1)
	{
		return PLUGIN_CONTINUE;
	}

	new players[32], count;
	get_players(players, count, "ch");

	new maxPlayers = get_pcvar_num(g_cvar_maxplayers);
	if (maxPlayers < 1)
	{
		maxPlayers = MATCH_MAX_PLAYERS;
	}

	if (count >= maxPlayers)
	{
		console_print(id, "[BrowserCS] Mac modu: sunucu dolu (max %d oyuncu).", maxPlayers);
		return PLUGIN_HANDLED;
	}

	return PLUGIN_CONTINUE;
}

stock match_try_enable_from_mode_file()
{
	new mode[32];
	if (!match_read_mode_file(mode, charsmax(mode)))
	{
		return;
	}

	if (equali(mode, "match"))
	{
		set_pcvar_num(g_cvar_match, 1);
	}
}

stock bool:match_read_mode_file(mode[], len)
{
	new path[128];
	get_localinfo("amxx_configsdir", path, charsmax(path));
	format(path, charsmax(path), "%s/browsercs_mode.txt", path);

	if (!file_exists(path))
	{
		copy(path, charsmax(path), "browsercs_mode.txt");
	}

	if (!file_exists(path))
	{
		return false;
	}

	new file = fopen(path, "rt");
	if (!file)
	{
		return false;
	}

	mode[0] = 0;
	fgets(file, mode, len);
	fclose(file);

	trim(mode);
	return mode[0] != 0;
}
