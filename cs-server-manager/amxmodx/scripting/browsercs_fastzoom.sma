#include <amxmodx>
#include <fakemeta>
#include <hamsandwich>

#define PLUGIN_NAME "BrowserCS Fast Zoom"
#define PLUGIN_VERSION "1.1.0"
#define PLUGIN_AUTHOR "BrowserCS"

// Linux CS 1.6 / ReGameDLL pdata (CLIENT_WEAPONS countdown times)
#define XO_WEAPON 4
#define XO_PLAYER 5
#define m_pPlayer 41
#define m_flNextPrimaryAttack 46
#define m_flNextSecondaryAttack 47
#define m_flNextAttack 83

#define ZOOM_UNLOCK 0.05
#define FIRE_LOCK_AWP 0.10
#define FIRE_LOCK_SCOUT 0.10

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);

	RegisterHam(Ham_Item_Deploy, "weapon_awp", "OnSniperDeploy_Post", 1);
	RegisterHam(Ham_Item_Deploy, "weapon_scout", "OnSniperDeploy_Post", 1);
}

public OnSniperDeploy_Post(weapon)
{
	if (weapon <= 0)
		return HAM_IGNORED;

	new player = get_pdata_cbase(weapon, m_pPlayer, XO_WEAPON);
	if (player < 1 || player > get_maxplayers() || !is_user_alive(player))
		return HAM_IGNORED;

	new classname[32];
	pev(weapon, pev_classname, classname, charsmax(classname));

	new Float:fireLock = FIRE_LOCK_AWP;
	if (equal(classname, "weapon_scout"))
		fireLock = FIRE_LOCK_SCOUT;

	// Scope görünürken ateşin 1.45 sn kilitli kalması kısa tıklamaları yutuyordu.
	// Primary'yi scope'tan yalnızca bir motor karesi sonra aç; JS input buffer
	// aynı-kare zoom + fire tıklamasını 90 ms'de güvenli biçimde tekrarlar.
	set_pdata_float(player, m_flNextAttack, ZOOM_UNLOCK, XO_PLAYER);
	set_pdata_float(weapon, m_flNextPrimaryAttack, fireLock, XO_WEAPON);
	set_pdata_float(weapon, m_flNextSecondaryAttack, ZOOM_UNLOCK, XO_WEAPON);

	return HAM_IGNORED;
}
