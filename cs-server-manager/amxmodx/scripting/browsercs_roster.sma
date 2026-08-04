#include <amxmodx>

#define PLUGIN "BrowserCS Roster"
#define VERSION "1.0.0"
#define AUTHOR "BrowserCS"

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR);
	register_srvcmd("bcs_roster", "CmdBcsRoster");
	register_concmd("bcs_roster", "CmdBcsRoster", ADMIN_RCON, "Print player roster with teams");
}

public CmdBcsRoster(id)
{
	new players[32], num, i, pid;
	new name[32];
	new team;
	new score;
	new deaths;
	new bot;

	get_players(players, num, "h");

	server_print("BCS_ROSTER_BEGIN");
	for (i = 0; i < num; i++)
	{
		pid = players[i];
		if (!is_user_connected(pid))
			continue;

		get_user_name(pid, name, charsmax(name));
		team = get_user_team(pid);
		score = get_user_frags(pid);
		deaths = get_user_deaths(pid);
		bot = is_user_bot(pid) ? 1 : 0;

		/* team: 0=unassigned, 1=T, 2=CT, 3=SPEC */
		server_print("BCS_PLAYER|%d|%s|%d|%d|%d|%d", pid, name, team, score, deaths, bot);
	}
	server_print("BCS_ROSTER_END");
	return PLUGIN_HANDLED;
}
