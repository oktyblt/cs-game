#include <amxmodx>
#include <fakemeta>
#include <hamsandwich>

/**
 * Remembers CS appearance choice for logging / future use.
 *
 * v1.2.3: NEVER write model userinfo from this plugin on BrowserCS.
 * Iceworld repro: crash on team+model select even after deferring apply -
 * any SetClientKeyValue/set_user_info("model") near spawn OOB-crashes WASM.
 * Engine menuselect already applies the skin; we only remember the slot.
 */

#define PLUGIN_NAME    "BrowserCS Model Persist"
#define PLUGIN_VERSION "1.2.3"
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
	register_clcmd("menuselect", "BrowserCS_OnMenuSelect");
	register_clcmd("joinclass", "BrowserCS_OnJoinClass");
	log_amx("[BrowserCS] Model Persist %s (save-only, no apply)", PLUGIN_VERSION);
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

stock BrowserCS_SaveModelFromSlot(id, slot)
{
	if (slot < 1 || slot > 4)
		return;

	new team = pev(id, pev_team);
	if (team != TEAM_T && team != TEAM_CT)
		team = get_user_team(id);

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
	log_amx("[BrowserCS] model choice saved id=%d team=%d model=%s (no apply)", id, team, model);
}
