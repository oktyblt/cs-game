#include <amxmodx>
#include <fakemeta>
#include <hamsandwich>

#define PLUGIN_NAME "BrowserCS DamageInfo"
#define PLUGIN_VERSION "1.0.0"
#define PLUGIN_AUTHOR "BrowserCS"

#define DAMAGEINFO_SIZE 4
#define MAX_DAMAGE_VALUE 65535

new gmsgDamageInfo;

new g_traceAttacker[33];
new g_traceHitgroup[33];

new g_pendingAttacker[33];
new g_pendingHitgroup[33];
new Float:g_healthBeforeDamage[33];

public plugin_precache()
{
	gmsgDamageInfo = engfunc(
		EngFunc_RegUserMsg,
		"DamageInfo",
		DAMAGEINFO_SIZE
	);
}

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);

	RegisterHam(
		Ham_TraceAttack,
		"player",
		"BrowserCS_OnTraceAttack",
		false
	);

	RegisterHam(
		Ham_TakeDamage,
		"player",
		"BrowserCS_OnTakeDamagePre",
		false
	);

	RegisterHam(
		Ham_TakeDamage,
		"player",
		"BrowserCS_OnTakeDamagePost",
		true
	);
}

public client_disconnected(id)
{
	BrowserCS_ClearDamageState(id);
}

public BrowserCS_OnTraceAttack(
	victim,
	attacker,
	Float:damage,
	Float:direction[3],
	trace,
	damageBits
)
{
	if (
		!BrowserCS_IsValidPlayer(victim) ||
		!BrowserCS_IsValidPlayer(attacker) ||
		attacker == victim ||
		damage <= 0.0
	)
	{
		return HAM_IGNORED;
	}

	g_traceAttacker[victim] = attacker;
	g_traceHitgroup[victim] =
		get_tr2(trace, TR_iHitgroup);

	return HAM_IGNORED;
}

public BrowserCS_OnTakeDamagePre(
	victim,
	inflictor,
	attacker,
	Float:damage,
	damageBits
)
{
	g_pendingAttacker[victim] = 0;
	g_pendingHitgroup[victim] = 0;
	g_healthBeforeDamage[victim] = 0.0;

	if (
		!BrowserCS_IsValidPlayer(victim) ||
		!BrowserCS_IsValidPlayer(attacker) ||
		attacker == victim ||
		damage <= 0.0
	)
	{
		BrowserCS_ClearTrace(victim);
		return HAM_IGNORED;
	}

	g_pendingAttacker[victim] = attacker;
	pev(
		victim,
		pev_health,
		g_healthBeforeDamage[victim]
	);

	if (g_traceAttacker[victim] == attacker)
	{
		g_pendingHitgroup[victim] =
			g_traceHitgroup[victim];
	}

	/*
	 * TraceAttack bilgisi yalnızca hemen izleyen tek TakeDamage
	 * çağrısına aittir. Burada tüketmek HE/world gibi sonraki
	 * hasarların eski hitgroup'u kullanmasını önler.
	 */
	BrowserCS_ClearTrace(victim);

	return HAM_IGNORED;
}

public BrowserCS_OnTakeDamagePost(
	victim,
	inflictor,
	attacker,
	Float:damage,
	damageBits
)
{
	if (
		g_pendingAttacker[victim] != attacker ||
		!BrowserCS_IsValidPlayer(attacker) ||
		attacker == victim
	)
	{
		BrowserCS_ClearPending(victim);
		return HAM_IGNORED;
	}

	new Float:healthAfterDamage;
	pev(
		victim,
		pev_health,
		healthAfterDamage
	);

	new Float:appliedDamage =
		g_healthBeforeDamage[victim] -
		healthAfterDamage;

	/*
	 * Takım hasarı kapalı, godmode veya tamamen emilen hasar
	 * sağlık düşürmez; bu durumlarda mesaj gönderilmez.
	 */
	if (appliedDamage <= 0.0)
	{
		BrowserCS_ClearPending(victim);
		return HAM_IGNORED;
	}

	new damageValue = floatround(
		appliedDamage,
		floatround_floor
	);

	if (damageValue < 0)
		damageValue = 0;

	if (damageValue > MAX_DAMAGE_VALUE)
		damageValue = MAX_DAMAGE_VALUE;

	if (damageValue > 0 && gmsgDamageInfo > 0)
	{
		message_begin(
			MSG_ONE,
			gmsgDamageInfo,
			_,
			attacker
		);

		write_short(damageValue);
		write_byte(g_pendingHitgroup[victim]);
		write_byte(0);

		message_end();
	}

	BrowserCS_ClearPending(victim);
	return HAM_IGNORED;
}

stock bool:BrowserCS_IsValidPlayer(id)
{
	return id >= 1 && id <= 32 && is_user_connected(id);
}

stock BrowserCS_ClearTrace(id)
{
	if (id >= 1 && id <= 32)
	{
		g_traceAttacker[id] = 0;
		g_traceHitgroup[id] = 0;
	}
}

stock BrowserCS_ClearPending(id)
{
	if (id >= 1 && id <= 32)
	{
		g_pendingAttacker[id] = 0;
		g_pendingHitgroup[id] = 0;
		g_healthBeforeDamage[id] = 0.0;
	}
}

stock BrowserCS_ClearDamageState(id)
{
	BrowserCS_ClearTrace(id);
	BrowserCS_ClearPending(id);
}
