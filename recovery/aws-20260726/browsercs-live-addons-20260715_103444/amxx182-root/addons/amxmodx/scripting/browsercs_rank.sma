#include <amxmodx>

/**
 * BrowserCS Rank Takip
 * DeathMsg → append kill line to shared queue file (host manager ingests).
 * Format: unix|port|killer|victim
 *
 * Port MUST come from browsercs_rank_port.txt / localinfo — Xash resets
 * register_cvar defaults and ignores server.cfg values for late-registered cvars.
 */

#define PLUGIN_NAME    "BrowserCS Rank"
#define PLUGIN_VERSION "1.1.0"
#define PLUGIN_AUTHOR  "BrowserCS"

#define QUEUE_FILE "addons/amxmodx/data/rank_kills.log"
#define PORT_FILE  "addons/amxmodx/configs/browsercs_rank_port.txt"

new g_cvarEnabled;
new g_cvarPort;
new g_port;

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);

	g_cvarEnabled = register_cvar("bcs_rank", "1");
	g_cvarPort = register_cvar("bcs_rank_port", "0");
	g_port = 0;

	register_event("DeathMsg", "OnDeathMsg", "a");
}

public plugin_cfg()
{
	g_port = ResolveRankPort();
	if (g_port > 0)
		set_pcvar_num(g_cvarPort, g_port);

	log_amx("[BrowserCS Rank] v%s enabled=%d port=%d", PLUGIN_VERSION, get_pcvar_num(g_cvarEnabled), g_port);
}

ResolveRankPort()
{
	new buf[32], port;

	/* 1) Per-server mounted file (most reliable) */
	if (file_exists(PORT_FILE))
	{
		new f = fopen(PORT_FILE, "rt");
		if (f)
		{
				fgets(f, buf, charsmax(buf));
			fclose(f);
			for (new i = 0; buf[i]; i++)
			{
				if (buf[i] == '^n' || buf[i] == '^r' || buf[i] == ' ')
					buf[i] = 0;
			}
			port = str_to_num(buf);
			if (port > 0)
				return port;
		}
	}

	/* 2) localinfo from server.cfg */
	get_localinfo("bcs_rank_port", buf, charsmax(buf));
	port = str_to_num(buf);
	if (port > 0)
		return port;

	/* 3) live cvar (rcon / prior set) */
	port = get_pcvar_num(g_cvarPort);
	if (port > 0)
		return port;

	return 0;
}

public OnDeathMsg()
{
	if (!get_pcvar_num(g_cvarEnabled))
		return;

	new port = g_port;
	if (port <= 0)
		port = ResolveRankPort();
	if (port <= 0)
		return;

	g_port = port;

	new killer = read_data(1);
	new victim = read_data(2);

	if (victim < 1 || victim > 32)
		return;
	if (killer < 1 || killer > 32)
		return;
	if (killer == victim)
		return;
	if (!is_user_connected(killer) || !is_user_connected(victim))
		return;
	if (is_user_bot(killer))
		return;

	new kName[32], vName[32];
	get_user_name(killer, kName, charsmax(kName));
	get_user_name(victim, vName, charsmax(vName));

	if (!kName[0])
		return;

	Sanitize(kName, charsmax(kName));
	Sanitize(vName, charsmax(vName));

	new line[192];
	formatex(line, charsmax(line), "%d|%d|%s|%s^n", get_systime(), port, kName, vName);

	new file = fopen(QUEUE_FILE, "at");
	if (!file)
	{
		log_amx("[BrowserCS Rank] queue open failed: %s", QUEUE_FILE);
		return;
	}
	fputs(file, line);
	fclose(file);
}

Sanitize(str[], len)
{
	for (new i = 0; i < len; i++)
	{
		if (!str[i])
			break;
		if (str[i] == '|' || str[i] == '^n' || str[i] == '^r')
			str[i] = '_';
	}
}
