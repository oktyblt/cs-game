#include <amxmodx>
#include <fakemeta>
#include <hamsandwich>

#define PLUGIN_NAME "BrowserCS AntiCheat"
#define PLUGIN_VERSION "1.0.0"
#define PLUGIN_AUTHOR "BrowserCS"

// Soft server-side detections. Browser clients cannot be sealed like sXe;
// this flags obvious speed / teleport / fire-rate abuse for admins.

#define CHECK_INTERVAL 0.25
#define SPEED_GRACE 80.0
#define TELEPORT_DIST 420.0
#define WARN_COOLDOWN 8.0
#define KICK_STRIKES 6

#define CSW_AWP 18
#define CSW_SCOUT 3
#define CSW_G3SG1 24
#define CSW_SG550 13

new Float:g_LastOrigin[33][3];
new bool:g_HasOrigin[33];
new Float:g_LastWarn[33];
new g_Strikes[33];
new Float:g_LastShot[33];
new g_ShotBurst[33];
new Float:g_BurstWindowStart[33];

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);

	register_forward(FM_CmdStart, "OnCmdStart", 1);
	RegisterHam(Ham_Weapon_PrimaryAttack, "weapon_awp", "OnAnyPrimary_Post", 1);
	RegisterHam(Ham_Weapon_PrimaryAttack, "weapon_scout", "OnAnyPrimary_Post", 1);
	RegisterHam(Ham_Weapon_PrimaryAttack, "weapon_ak47", "OnAnyPrimary_Post", 1);
	RegisterHam(Ham_Weapon_PrimaryAttack, "weapon_m4a1", "OnAnyPrimary_Post", 1);
	RegisterHam(Ham_Weapon_PrimaryAttack, "weapon_deagle", "OnAnyPrimary_Post", 1);

	set_task(CHECK_INTERVAL, "CheckPlayers", _, _, _, "b");
}

public client_disconnect(id)
{
	ClearPlayer(id);
}

public client_putinserver(id)
{
	ClearPlayer(id);
}

stock ClearPlayer(id)
{
	g_HasOrigin[id] = false;
	g_LastWarn[id] = 0.0;
	g_Strikes[id] = 0;
	g_LastShot[id] = 0.0;
	g_ShotBurst[id] = 0;
	g_BurstWindowStart[id] = 0.0;
}

public CheckPlayers()
{
	new players[32], num, i, id;
	get_players(players, num, "ah");

	for (i = 0; i < num; i++)
	{
		id = players[i];
		if (is_user_bot(id) || !is_user_alive(id))
			continue;

		CheckSpeed(id);
		CheckTeleport(id);
	}
}

stock CheckSpeed(id)
{
	new Float:vel[3];
	pev(id, pev_velocity, vel);

	new Float:speed = floatsqroot(vel[0] * vel[0] + vel[1] * vel[1]);
	new Float:maxspeed;
	pev(id, pev_maxspeed, maxspeed);

	if (maxspeed < 1.0)
		return;

	// Ignore ladder / noclip / observer edge cases.
	new movetype = pev(id, pev_movetype);
	if (movetype == MOVETYPE_NOCLIP || movetype == MOVETYPE_FLY)
		return;

	if (speed > maxspeed + SPEED_GRACE)
	{
		FlagPlayer(id, "speedhack", floatround(speed));
	}
}

stock CheckTeleport(id)
{
	new Float:origin[3];
	pev(id, pev_origin, origin);

	if (!g_HasOrigin[id])
	{
		g_LastOrigin[id][0] = origin[0];
		g_LastOrigin[id][1] = origin[1];
		g_LastOrigin[id][2] = origin[2];
		g_HasOrigin[id] = true;
		return;
	}

	new Float:dx = origin[0] - g_LastOrigin[id][0];
	new Float:dy = origin[1] - g_LastOrigin[id][1];
	new Float:dz = origin[2] - g_LastOrigin[id][2];
	new Float:dist = floatsqroot(dx * dx + dy * dy + dz * dz);

	g_LastOrigin[id][0] = origin[0];
	g_LastOrigin[id][1] = origin[1];
	g_LastOrigin[id][2] = origin[2];

	// Large horizontal jump without falling far vertically → suspicious teleport.
	if (dist > TELEPORT_DIST && floatabs(dz) < 200.0)
	{
		new movetype = pev(id, pev_movetype);
		if (movetype != MOVETYPE_NOCLIP)
			FlagPlayer(id, "teleport", floatround(dist));
	}
}

public OnCmdStart(id, uc, seed)
{
	// Reserved for future usercmd rate checks.
	return FMRES_IGNORED;
}

public OnAnyPrimary_Post(weapon)
{
	if (weapon <= 0)
		return HAM_IGNORED;

	new id = pev(weapon, pev_owner);
	if (id < 1 || id > get_maxplayers() || !is_user_alive(id) || is_user_bot(id))
		return HAM_IGNORED;

	new Float:now = get_gametime();
	if (g_BurstWindowStart[id] <= 0.0 || (now - g_BurstWindowStart[id]) > 1.0)
	{
		g_BurstWindowStart[id] = now;
		g_ShotBurst[id] = 1;
	}
	else
	{
		g_ShotBurst[id]++;
	}

	g_LastShot[id] = now;

	// AWP/Scout cannot legally fire this fast; flag obvious fire-rate abuse.
	new wpn = get_user_weapon(id);
	if ((wpn == CSW_AWP || wpn == CSW_SCOUT) && g_ShotBurst[id] >= 3)
	{
		FlagPlayer(id, "firerate", g_ShotBurst[id]);
		g_ShotBurst[id] = 0;
	}
	else if (g_ShotBurst[id] >= 28)
	{
		FlagPlayer(id, "firerate", g_ShotBurst[id]);
		g_ShotBurst[id] = 0;
	}

	return HAM_IGNORED;
}

stock FlagPlayer(id, const reason[], value)
{
	new Float:now = get_gametime();
	if ((now - g_LastWarn[id]) < WARN_COOLDOWN)
		return;

	g_LastWarn[id] = now;
	g_Strikes[id]++;

	new name[32], auth[36];
	get_user_name(id, name, charsmax(name));
	get_user_authid(id, auth, charsmax(auth));

	log_amx("[BrowserCS-AC] %s (%s) %s=%d strikes=%d", name, auth, reason, value, g_Strikes[id]);

	new msg[160];
	formatex(msg, charsmax(msg), "[AC] %s: %s (%d) [%d/%d]", name, reason, value, g_Strikes[id], KICK_STRIKES);
	NotifyAdmins(msg);

	if (g_Strikes[id] >= KICK_STRIKES)
	{
		g_Strikes[id] = 0;
		server_cmd("kick #%d ^"BrowserCS anti-cheat^"", get_user_userid(id));
		client_print(0, print_chat, "* %s kicked (anti-cheat: %s)", name, reason);
	}
}

stock NotifyAdmins(const msg[])
{
	new players[32], num, i, id;
	get_players(players, num, "ch");
	for (i = 0; i < num; i++)
	{
		id = players[i];
		if (!(get_user_flags(id) & (ADMIN_KICK | ADMIN_BAN | ADMIN_RCON | ADMIN_IMMUNITY)))
			continue;

		client_print(id, print_chat, "%s", msg);
		client_print(id, print_console, "%s", msg);
	}
}
