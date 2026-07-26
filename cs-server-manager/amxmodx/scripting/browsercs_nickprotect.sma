#include <amxmodx>

#define PLUGIN_NAME    "BrowserCS Nick Protect"
#define PLUGIN_VERSION "1.0.0"
#define PLUGIN_AUTHOR  "BrowserCS"

#define RESERVED_NICK "BrowserCS"
#define KICK_REASON   "browsercs isimleri saklidir"

stock bool:NickHasBrowserCS(const name[])
{
	new buf[64], i, j
	for (i = 0; name[i] != 0 && j < charsmax(buf); i++)
	{
		new c = name[i]
		if (c >= 'A' && c <= 'Z')
			c += 32
		if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))
			buf[j++] = c
	}
	buf[j] = 0
	return containi(buf, "browsercs") != -1
}

stock bool:IsAuthedReservedAdmin(id, const name[])
{
	if (!equal(name, RESERVED_NICK))
		return false

	/* users.ini auth + flag "a" — admin.amxx sets flags after _pw */
	return bool:(get_user_flags(id) & (ADMIN_IMMUNITY | ADMIN_RCON | ADMIN_BAN | ADMIN_KICK | ADMIN_CFG))
}

stock EnforceNick(id)
{
	if (!is_user_connected(id) || is_user_bot(id) || is_user_hltv(id))
		return

	new name[32]
	get_user_name(id, name, charsmax(name))

	if (!NickHasBrowserCS(name))
		return

	if (IsAuthedReservedAdmin(id, name))
		return

	client_print(id, print_chat, "[BrowserCS] Bu nick saklidir. Baska bir isim kullanin.")
	server_cmd("kick #%d ^"%s^"", get_user_userid(id), KICK_REASON)
}

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR)
	log_amx("[BrowserCS] Nick Protect %s loaded", PLUGIN_VERSION)
}

public client_putinserver(id)
{
	if (is_user_bot(id) || is_user_hltv(id))
		return

	/* AMXX name-auth may land shortly after putinserver */
	set_task(1.0, "TaskEnforceNick", id)
	set_task(3.0, "TaskEnforceNick", id)
	set_task(6.0, "TaskEnforceNick", id)
}

public client_infochanged(id)
{
	if (!is_user_connected(id) || is_user_bot(id) || is_user_hltv(id))
		return

	new newname[32]
	get_user_info(id, "name", newname, charsmax(newname))

	if (!NickHasBrowserCS(newname))
		return

	/* Block rename immediately; allow only exact reserved + already authed */
	if (IsAuthedReservedAdmin(id, newname))
		return

	/* Revert + kick — prevent sitting with brand nick */
	new oldname[32]
	get_user_name(id, oldname, charsmax(oldname))
	if (oldname[0] && !NickHasBrowserCS(oldname))
		set_user_info(id, "name", oldname)

	set_task(0.1, "TaskEnforceNick", id)
}

public TaskEnforceNick(id)
{
	EnforceNick(id)
}
