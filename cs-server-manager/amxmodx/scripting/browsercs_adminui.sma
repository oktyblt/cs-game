#include <amxmodx>

new bool:g_Announced[33];

public plugin_init()
{
	register_plugin("BrowserCS Admin UI", "1.2.3", "BrowserCS");
	set_task(45.0, "BroadcastPromo");
	set_task(180.0, "BroadcastPromo", _, _, _, "b");
}

stock bool:bcs_is_admin(id)
{
	return bool:(get_user_flags(id) & ADMIN_IMMUNITY)
		|| bool:(get_user_flags(id) & ADMIN_KICK)
		|| bool:(get_user_flags(id) & ADMIN_BAN)
		|| bool:(get_user_flags(id) & ADMIN_RCON);
}

public BroadcastPromo()
{
	new players[32], num, i;
	get_players(players, num, "ch");
	for (i = 0; i < num; i++)
	{
		client_print(players[i], print_console, "[BROWSERCS_PROMO]BROWSERCS 1.5");
		client_cmd(players[i], "echo BROWSERCS_PROMO|BROWSERCS 1.5");
	}
}

public client_putinserver(id)
{
	g_Announced[id] = false;
	if (is_user_bot(id))
		return;
	set_task(3.0, "CheckAdminStatus", id);
	set_task(8.0, "CheckAdminStatus", id);
	set_task(15.0, "CheckAdminStatus", id);
}

public client_disconnected(id)
{
	g_Announced[id] = false;
}

public CheckAdminStatus(id)
{
	if (!is_user_connected(id) || is_user_bot(id))
		return;
	if (!bcs_is_admin(id))
		return;
	if (g_Announced[id])
		return;
	g_Announced[id] = true;

	new name[32];
	get_user_name(id, name, charsmax(name));

	set_hudmessage(57, 255, 80, -1.0, 0.30, 2, 0.05, 6.5, 0.2, 0.5, -1);
	show_hudmessage(0, "%s admin giris yapti", name);
	client_print(0, print_chat, "* %s admin giris yapti", name);
	client_print(0, print_chat, "[BROWSERCS_ADMIN_JOIN]%s", name);

	new players[32], num, i, cmd[192];
	formatex(cmd, charsmax(cmd), "echo BROWSERCS_ADMIN_JOIN|%s", name);
	get_players(players, num, "ch");
	for (i = 0; i < num; i++)
	{
		client_cmd(players[i], "%s", cmd);
		client_print(players[i], print_console, "[BROWSERCS_ADMIN_JOIN]%s", name);
	}
}
