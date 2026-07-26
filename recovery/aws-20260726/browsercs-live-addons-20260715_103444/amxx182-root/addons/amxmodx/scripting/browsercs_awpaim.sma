#include <amxmodx>
#include <fakemeta>
#include <hamsandwich>

/**
 * BrowserCS AWP Aim
 * WebRTC gecikmesinde client scoped iken sunucu FOV hâlâ 90 kalabiliyor → +0.08
 * unscoped spread. Zoom grace + duck branch ile scoped-on-ground isabetini korur.
 */

#define PLUGIN_NAME "BrowserCS AWP Aim"
#define PLUGIN_VERSION "1.1.0"
#define PLUGIN_AUTHOR "BrowserCS"

#define XO_WEAPON 4
#define m_pPlayer 41

#define FL_ONGROUND (1<<9)
#define FL_DUCKING (1<<14)

#define ZOOM_GRACE 0.20

new bool:g_NeedRestore[33];
new g_RestoreFlags[33];
new Float:g_RestoreVel[33][3];
new Float:g_LastZoomAt[33];

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);

	RegisterHam(Ham_Weapon_PrimaryAttack, "weapon_awp", "OnAWPPrimary_Pre", 0);
	RegisterHam(Ham_Weapon_PrimaryAttack, "weapon_awp", "OnAWPPrimary_Post", 1);
	RegisterHam(Ham_Weapon_SecondaryAttack, "weapon_awp", "OnAWPSecondary_Post", 1);
}

public client_putinserver(id)
{
	g_NeedRestore[id] = false;
	g_LastZoomAt[id] = 0.0;
}

public client_disconnect(id)
{
	g_NeedRestore[id] = false;
	g_LastZoomAt[id] = 0.0;
}

public OnAWPSecondary_Post(weapon)
{
	if (weapon <= 0)
		return HAM_IGNORED;

	new id = get_pdata_cbase(weapon, m_pPlayer, XO_WEAPON);
	if (id < 1 || id > get_maxplayers())
		return HAM_IGNORED;

	g_LastZoomAt[id] = get_gametime();
	return HAM_IGNORED;
}

bool:IsEffectivelyScoped(id)
{
	new Float:fov;
	pev(id, pev_fov, fov);
	if (fov < 89.0)
		return true;

	/* Client zoom prediction sunucudan önce gelir — kısa grace */
	if (g_LastZoomAt[id] > 0.0 && (get_gametime() - g_LastZoomAt[id]) <= ZOOM_GRACE)
		return true;

	return false;
}

public OnAWPPrimary_Pre(weapon)
{
	if (weapon <= 0)
		return HAM_IGNORED;

	new id = get_pdata_cbase(weapon, m_pPlayer, XO_WEAPON);
	if (id < 1 || id > get_maxplayers() || !is_user_alive(id))
		return HAM_IGNORED;

	if (!IsEffectivelyScoped(id))
		return HAM_IGNORED;

	new flags = pev(id, pev_flags);
	if (!(flags & FL_ONGROUND))
		return HAM_IGNORED;

	g_RestoreFlags[id] = flags;
	pev(id, pev_velocity, g_RestoreVel[id]);
	g_NeedRestore[id] = true;

	/* Standing stock 0.001 / moving 0.1; ducking branch = 0.0 */
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
