#include <amxmodx>
#include <amxmisc>

#define PLUGIN_NAME    "BrowserCS Admin UI"
#define PLUGIN_VERSION "1.0.0"
#define PLUGIN_AUTHOR  "BrowserCS"

new bool:g_Announced[33];
new bool:g_WasAdmin[33];

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);
	set_task(8.0, "BroadcastAdminList", _, _, _, "b");
}

public client_putinserver(id)
{
	g_Announced[id] = false;
	g_WasAdmin[id] = false;

	if (is_user_bot(id))
		return;

	set_task(2.0, "CheckAdminStatus", id);
	set_task(5.0, "CheckAdminStatus", id);
	set_task(10.0, "CheckAdminStatus", id);
}

public client_disconnected(id)
{
	g_Announced[id] = false;
	g_WasAdmin[id] = false;
	set_task(0.5, "BroadcastAdminList");
}

public client_infochanged(id)
{
	if (!is_user_connected(id) || is_user_bot(id))
		return;

	set_task(1.0, "CheckAdminStatus", id);
}

public CheckAdminStatus(id)
{
	if (!is_user_connected(id) || is_user_bot(id))
		return;

	new bool:nowAdmin = bool:is_user_admin(id);

	if (nowAdmin && !g_WasAdmin[id])
	{
		g_WasAdmin[id] = true;

		if (!g_Announced[id])
		{
			g_Announced[id] = true;
			AnnounceAdminJoin(id);
		}
	}
	else if (!nowAdmin)
	{
		g_WasAdmin[id] = false;
		g_Announced[id] = false;
	}

	BroadcastAdminList();
}

stock AnnounceAdminJoin(id)
{
	new name[32];
	get_user_name(id, name, charsmax(name));
	sanitize_name(name, charsmax(name));

	// Native HUD (tum oyuncular)
	set_hudmessage(57, 255, 80, -1.0, 0.30, 2, 0.05, 6.5, 0.2, 0.5, -1);
	show_hudmessage(0, "%s admin giris yapti^nHerkes sakin olsun :)", name);

	client_print(0, print_chat, "* %s admin giris yapti — herkes sakin olsun :)", name);

	// Web client JS marker (console echo)
	broadcast_console_marker("BROWSERCS_ADMIN_JOIN", name);
}

public BroadcastAdminList()
{
	new list[256];
	list[0] = EOS;

	new players[32], num, i;
	new name[32];
	get_players(players, num, "ch");

	new first = true;
	for (i = 0; i < num; i++)
	{
		if (!is_user_admin(players[i]))
			continue;

		get_user_name(players[i], name, charsmax(name));
		sanitize_name(name, charsmax(name));

		if (!first)
			add(list, charsmax(list), ",");

		add(list, charsmax(list), name);
		first = false;
	}

	broadcast_console_marker("BROWSERCS_ADMINS", list);
}

stock broadcast_console_marker(const tag[], const payload[])
{
	new cmd[320];
	formatex(cmd, charsmax(cmd), "echo [%s]%s", tag, payload);

	new players[32], num, i;
	get_players(players, num, "ch");

	for (i = 0; i < num; i++)
	{
		client_cmd(players[i], "%s", cmd);
		client_print(players[i], print_console, "[%s]%s", tag, payload);
	}
}

stock sanitize_name(name[], len)
{
	replace_all(name, len, ";", "");
	replace_all(name, len, "^"", "");
	replace_all(name, len, "'", "");
	replace_all(name, len, "[", "");
	replace_all(name, len, "]", "");
	trim(name);
}
