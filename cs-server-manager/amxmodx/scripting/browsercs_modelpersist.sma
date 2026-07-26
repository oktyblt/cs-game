#include <amxmodx>
#include <fakemeta>
#include <hamsandwich>

#define PLUGIN_NAME    "BrowserCS Model Persist"
#define PLUGIN_VERSION "1.2.1"
#define PLUGIN_AUTHOR  "BrowserCS"

#define CS_MENU_CHOOSE_APPEARANCE 3
#define OFFSET_CBASEPLAYER_LINUX 5
#define OFFSET_MIMENU 840
#define TEAM_T  1
#define TEAM_CT 2

new g_savedModel[33][32];

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);
	RegisterHam(Ham_Spawn, "player", "BrowserCS_OnSpawnPost", true);
	register_clcmd("menuselect", "BrowserCS_OnMenuSelect");
	register_clcmd("joinclass", "BrowserCS_OnJoinClass");
}

public client_disconnect(id)
{
	g_savedModel[id][0] = 0;
}

stock bool:BrowserCS_IsAppearanceMenu(id)
{
	if (!is_user_connected(id))
		return false;

	return get_pdata_int(id, OFFSET_MIMENU, OFFSET_CBASEPLAYER_LINUX) == CS_MENU_CHOOSE_APPEARANCE;
}

stock BrowserCS_GetTeam(id)
{
	new team = pev(id, pev_team);
	if (team == TEAM_T || team == TEAM_CT)
		return team;
	return get_user_team(id);
}

stock BrowserCS_ApplyModel(id, const model[])
{
	if (!is_user_connected(id) || !model[0])
		return;

	new buffer = engfunc(EngFunc_GetInfoKeyBuffer, id);
	engfunc(EngFunc_SetClientKeyValue, id, buffer, "model", model);
	set_user_info(id, "model", model);
}

public BrowserCS_OnMenuSelect(id)
{
	if (!is_user_connected(id) || !BrowserCS_IsAppearanceMenu(id))
		return PLUGIN_CONTINUE;

	new arg[8];
	read_argv(1, arg, charsmax(arg));
	BrowserCS_SaveModelFromSlot(id, str_to_num(arg));
	return PLUGIN_CONTINUE;
}

public BrowserCS_OnJoinClass(id)
{
	if (!is_user_connected(id) || !BrowserCS_IsAppearanceMenu(id))
		return PLUGIN_CONTINUE;

	new arg[8];
	read_argv(1, arg, charsmax(arg));
	BrowserCS_SaveModelFromSlot(id, str_to_num(arg));
	return PLUGIN_CONTINUE;
}

public BrowserCS_OnSpawnPost(id)
{
	if (!is_user_connected(id) || !is_user_alive(id) || !g_savedModel[id][0])
		return HAM_IGNORED;

	set_task(0.15, "BrowserCS_ReapplyModel", id);
	return HAM_HANDLED;
}

public BrowserCS_ReapplyModel(id)
{
	if (!is_user_connected(id) || !is_user_alive(id))
		return;
	if (!g_savedModel[id][0] || !BrowserCS_IsPlayerModel(g_savedModel[id]))
		return;

	BrowserCS_ApplyModel(id, g_savedModel[id]);
}

stock BrowserCS_SaveModelFromSlot(id, slot)
{
	if (slot < 1 || slot > 4)
		return;

	new team = BrowserCS_GetTeam(id);
	new model[32];
	model[0] = 0;

	if (team == TEAM_T)
	{
		switch (slot)
		{
			case 1: copy(model, charsmax(model), "terror");
			case 2: copy(model, charsmax(model), "leet");
			case 3: copy(model, charsmax(model), "arctic");
			case 4: copy(model, charsmax(model), "guerilla");
		}
	}
	else if (team == TEAM_CT)
	{
		switch (slot)
		{
			case 1: copy(model, charsmax(model), "urban");
			case 2: copy(model, charsmax(model), "gsg9");
			case 3: copy(model, charsmax(model), "sas");
			case 4: copy(model, charsmax(model), "gign");
		}
	}

	if (!model[0])
		return;

	copy(g_savedModel[id], charsmax(g_savedModel[]), model);
	BrowserCS_ApplyModel(id, model);
}

stock bool:BrowserCS_IsPlayerModel(const model[])
{
	return (
		equal(model, "terror") ||
		equal(model, "leet") ||
		equal(model, "arctic") ||
		equal(model, "guerilla") ||
		equal(model, "urban") ||
		equal(model, "gsg9") ||
		equal(model, "sas") ||
		equal(model, "gign")
	);
}
