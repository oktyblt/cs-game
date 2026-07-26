#include <amxmodx>
#include <fakemeta>
#include <hamsandwich>

#define PLUGIN_NAME "BrowserCS AWP Aim"
#define PLUGIN_VERSION "1.0.1"
#define PLUGIN_AUTHOR "BrowserCS"

#define XO_WEAPON 4
#define m_pPlayer 41

#define FL_ONGROUND (1<<9)
#define FL_DUCKING (1<<14)

new bool:g_NeedRestore[33];
new g_RestoreFlags[33];
new Float:g_RestoreVel[33][3];

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);

	// Force gold cs.so AWP PrimaryAttack into the 0.0 spread branch when scoped.
	RegisterHam(Ham_Weapon_PrimaryAttack, "weapon_awp", "OnAWPPrimary_Pre", 0);
	RegisterHam(Ham_Weapon_PrimaryAttack, "weapon_awp", "OnAWPPrimary_Post", 1);
}

public client_disconnect(id)
{
	g_NeedRestore[id] = false;
}

public OnAWPPrimary_Pre(weapon)
{
	if (weapon <= 0)
		return HAM_IGNORED;

	new id = get_pdata_cbase(weapon, m_pPlayer, XO_WEAPON);
	if (id < 1 || id > get_maxplayers() || !is_user_alive(id))
		return HAM_IGNORED;

	// Scoped when FOV is below default (40 / 10).
	new Float:fov;
	pev(id, pev_fov, fov);
	if (fov >= 89.0)
		return HAM_IGNORED;

	new flags = pev(id, pev_flags);
	if (!(flags & FL_ONGROUND))
		return HAM_IGNORED;

	g_RestoreFlags[id] = flags;
	pev(id, pev_velocity, g_RestoreVel[id]);
	g_NeedRestore[id] = true;

	// Standing stock spread is 0.001; ducking branch is 0.0 — force that for one fire.
	new Float:zeroVel[3];
	zeroVel[0] = 0.0;
	zeroVel[1] = 0.0;
	zeroVel[2] = 0.0;
	set_pev(id, pev_velocity, zeroVel);
	set_pev(id, pev_flags, flags | FL_DUCKING);

	return HAM_IGNORED;
}

public OnAWPPrimary_Post(weapon)
{
	if (weapon <= 0)
		return HAM_IGNORED;

	new id = get_pdata_cbase(weapon, m_pPlayer, XO_WEAPON);
	if (id < 1 || id > get_maxplayers())
		return HAM_IGNORED;

	if (!g_NeedRestore[id])
		return HAM_IGNORED;

	set_pev(id, pev_flags, g_RestoreFlags[id]);
	set_pev(id, pev_velocity, g_RestoreVel[id]);
	g_NeedRestore[id] = false;

	return HAM_IGNORED;
}
