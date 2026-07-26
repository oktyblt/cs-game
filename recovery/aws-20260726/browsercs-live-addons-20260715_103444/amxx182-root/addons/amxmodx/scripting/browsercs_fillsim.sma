/**
 * BrowserCS fill simulation - CreateFakeClient (NOT YaPB bots).
 * Scoreboard looks like human players; no AI.
 *
 * Usage (rcon):
 *   amx_rcon bcs_sim_fill 31
 *   amx_rcon bcs_sim_clear
 */
#include <amxmodx>
#include <amxmisc>
#include <fakemeta>

#define PLUGIN  "BrowserCS FillSim"
#define VERSION "1.0.1"
#define AUTHOR  "BrowserCS"
#define MAX_SIM 31

new const g_names[][] = {
	"Cengaver", "EmreTR", "Kagan", "NightOwl", "DustKing",
	"Serhat", "MertCS", "Berkay", "Volkan", "AyseAim",
	"Caner", "Tolga", "Yigit", "Baran", "Ozan",
	"Kerem", "Deniz", "Umut", "Selim", "ArdaG",
	"EfeCS", "Alp", "Burak", "Onur", "Hakan",
	"Furkan", "Emir", "Sarp", "Ata", "Kaan",
	"Gokhan"
};

new bool:g_sim[33];
new g_simCount;
new g_joinTeam[33];

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR);
	register_srvcmd("bcs_sim_fill", "cmd_fill");
	register_srvcmd("bcs_sim_clear", "cmd_clear");
	register_srvcmd("bcs_sim_status", "cmd_status");
}

public client_disconnect(id)
{
	if (id < 1 || id > 32)
		return;
	if (g_sim[id])
	{
		g_sim[id] = false;
		if (g_simCount > 0)
			g_simCount--;
	}
}

public cmd_status()
{
	server_print("[FillSim] active=%d players=%d", g_simCount, get_playersnum(1));
	return PLUGIN_HANDLED;
}

public cmd_clear()
{
	new cleared;
	for (new i = 1; i <= 32; i++)
	{
		if (!g_sim[i])
			continue;
		if (is_user_connected(i))
		{
			server_cmd("kick #%d ^"sim end^"", get_user_userid(i));
			cleared++;
		}
		g_sim[i] = false;
	}
	g_simCount = 0;
	server_print("[FillSim] cleared=%d", cleared);
	return PLUGIN_HANDLED;
}

public cmd_fill()
{
	new arg[8];
	read_argv(1, arg, charsmax(arg));
	new want = str_to_num(arg);
	if (want < 1) want = 1;
	if (want > MAX_SIM) want = MAX_SIM;

	/* YaPB bots off - karismasin */
	server_cmd("yb_quota 0");

	new connected = get_playersnum(1);
	new room = 32 - connected;
	if (room < 1)
	{
		server_print("[FillSim] full players=%d", connected);
		return PLUGIN_HANDLED;
	}
	if (want > room)
		want = room;

	new added;
	for (new n = 0; n < want; n++)
	{
		new name[32];
		formatex(name, charsmax(name), "%s%d", g_names[n % sizeof(g_names)], 10 + (n % 89));

		new pid = make_sim(name);
		if (!pid)
			continue;

		g_sim[pid] = true;
		g_simCount++;
		added++;
		g_joinTeam[pid] = (n % 2) + 1;
		set_task(0.25 + float(n) * 0.08, "task_join", pid);
	}

	server_print("[FillSim] added=%d sim=%d players=%d", added, g_simCount, get_playersnum(1));
	return PLUGIN_HANDLED;
}

public task_join(id)
{
	if (id < 1 || id > 32 || !is_user_connected(id))
		return;
	if (g_joinTeam[id] == 1)
		engclient_cmd(id, "jointeam", "1");
	else
		engclient_cmd(id, "jointeam", "2");
	engclient_cmd(id, "joinclass", "5");
}

make_sim(const name[])
{
	new id = engfunc(EngFunc_CreateFakeClient, name);
	if (!id)
		return 0;

	new reject[128];
	dllfunc(DLLFunc_ClientConnect, id, name, "127.0.0.1", reject);
	dllfunc(DLLFunc_ClientPutInServer, id);

	if (!is_user_connected(id))
		return 0;

	set_user_info(id, "name", name);
	set_user_info(id, "model", "urban");
	set_user_info(id, "*bot", "");
	return id;
}
