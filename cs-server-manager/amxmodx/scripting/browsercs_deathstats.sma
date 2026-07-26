#include <amxmodx>
#include <fakemeta>
#include <hamsandwich>

/**
 * Ölünce klasik statsx benzeri liste (csx olmadan):
 * - Kime kac isabet / hasar verdin
 * - Kim sana kac isabet / hasar verdi
 */

#define PLUGIN_NAME "BrowserCS DeathStats"
#define PLUGIN_VERSION "1.0.0"
#define PLUGIN_AUTHOR "BrowserCS"

#define MAX_PLAYERS 32

new g_damageDealt[MAX_PLAYERS + 1][MAX_PLAYERS + 1];
new g_hitsDealt[MAX_PLAYERS + 1][MAX_PLAYERS + 1];
new g_damageTaken[MAX_PLAYERS + 1][MAX_PLAYERS + 1];
new g_hitsTaken[MAX_PLAYERS + 1][MAX_PLAYERS + 1];

new g_traceAttacker[MAX_PLAYERS + 1];
new g_pendingAttacker[MAX_PLAYERS + 1];
new Float:g_healthBefore[MAX_PLAYERS + 1];

new g_cvarEnabled;
new g_cvarHold;

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);

	g_cvarEnabled = register_cvar("bcs_deathstats", "1");
	g_cvarHold = register_cvar("bcs_deathstats_hold", "8.0");

	RegisterHam(Ham_TraceAttack, "player", "OnTraceAttack", 0);
	RegisterHam(Ham_TakeDamage, "player", "OnTakeDamagePre", 0);
	RegisterHam(Ham_TakeDamage, "player", "OnTakeDamagePost", 1);
	RegisterHam(Ham_Spawn, "player", "OnPlayerSpawnPost", 1);

	register_event("DeathMsg", "OnDeathMsg", "a");
	register_event("HLTV", "OnRoundStart", "a", "1=0", "2=0");
	register_logevent("OnRoundStart", 2, "1=Round_Start");
}

#if AMXX_VERSION_NUM >= 183
public client_disconnected(id)
#else
public client_disconnect(id)
#endif
{
	ClearPlayer(id);
}

public OnRoundStart()
{
	for (new i = 1; i <= MAX_PLAYERS; i++)
		ClearPlayer(i);
}

public OnPlayerSpawnPost(id)
{
	if (is_user_alive(id))
		ClearPlayerStats(id);
}

public OnTraceAttack(victim, attacker, Float:damage, Float:direction[3], tracehandle, damagebits)
{
	if (!IsPlayer(victim) || !IsPlayer(attacker) || attacker == victim || damage <= 0.0)
		return HAM_IGNORED;

	g_traceAttacker[victim] = attacker;
	return HAM_IGNORED;
}

public OnTakeDamagePre(victim, inflictor, attacker, Float:damage, damagebits)
{
	g_pendingAttacker[victim] = 0;
	g_healthBefore[victim] = 0.0;

	if (!IsPlayer(victim) || !IsPlayer(attacker) || attacker == victim || damage <= 0.0)
	{
		g_traceAttacker[victim] = 0;
		return HAM_IGNORED;
	}

	g_pendingAttacker[victim] = attacker;
	pev(victim, pev_health, g_healthBefore[victim]);
	g_traceAttacker[victim] = 0;
	return HAM_IGNORED;
}

public OnTakeDamagePost(victim, inflictor, attacker, Float:damage, damagebits)
{
	if (g_pendingAttacker[victim] != attacker || !IsPlayer(attacker) || attacker == victim)
	{
		g_pendingAttacker[victim] = 0;
		return HAM_IGNORED;
	}

	new Float:hp;
	pev(victim, pev_health, hp);

	new Float:applied = g_healthBefore[victim] - hp;
	g_pendingAttacker[victim] = 0;

	if (applied <= 0.0)
		return HAM_IGNORED;

	new dmg = floatround(applied, floatround_floor);
	if (dmg < 1)
		return HAM_IGNORED;

	g_damageDealt[attacker][victim] += dmg;
	g_hitsDealt[attacker][victim] += 1;
	g_damageTaken[victim][attacker] += dmg;
	g_hitsTaken[victim][attacker] += 1;

	return HAM_IGNORED;
}

public OnDeathMsg()
{
	if (!get_pcvar_num(g_cvarEnabled))
		return;

	new victim = read_data(2);
	if (!IsPlayer(victim) || !is_user_connected(victim))
		return;

	/* HUD bir frame sonra — olum ekrani otursun */
	set_task(0.35, "TaskShowDeathStats", victim);
}

public TaskShowDeathStats(id)
{
	if (!IsPlayer(id) || !is_user_connected(id))
		return;

	if (is_user_alive(id))
		return;

	ShowDeathStats(id);
}

stock ShowDeathStats(id)
{
	static victims[512];
	static attackers[512];
	static line[96];
	static name[32];
	static full[1100];

	new vLen = 0;
	new aLen = 0;
	new vCount = 0;
	new aCount = 0;
	new totalDmg = 0;
	new totalHits = 0;

	vLen = formatex(victims, charsmax(victims), "ISABETLERIN:^n");
	aLen = formatex(attackers, charsmax(attackers), "SANA VURANLAR:^n");

	for (new other = 1; other <= MAX_PLAYERS; other++)
	{
		if (other == id)
			continue;

		if (g_hitsDealt[id][other] > 0 || g_damageDealt[id][other] > 0)
		{
			if (!is_user_connected(other) && g_damageDealt[id][other] <= 0)
				continue;

			get_user_name(other, name, charsmax(name));
			new hits = g_hitsDealt[id][other];
			new dmg = g_damageDealt[id][other];
			totalHits += hits;
			totalDmg += dmg;
			vCount++;

			formatex(line, charsmax(line), " %s — %d isabet, %d hasar^n", name, hits, dmg);
			if (vLen + strlen(line) < charsmax(victims))
				vLen += copy(victims[vLen], charsmax(victims) - vLen, line);
		}

		if (g_hitsTaken[id][other] > 0 || g_damageTaken[id][other] > 0)
		{
			get_user_name(other, name, charsmax(name));
			new hits = g_hitsTaken[id][other];
			new dmg = g_damageTaken[id][other];
			aCount++;

			formatex(line, charsmax(line), " %s — %d isabet, %d hasar^n", name, hits, dmg);
			if (aLen + strlen(line) < charsmax(attackers))
				aLen += copy(attackers[aLen], charsmax(attackers) - aLen, line);
		}
	}

	if (vCount == 0)
		vLen += formatex(victims[vLen], charsmax(victims) - vLen, " (kimseye isabet yok)^n");
	else
		vLen += formatex(victims[vLen], charsmax(victims) - vLen, "TOPLAM: %d isabet, %d hasar^n", totalHits, totalDmg);

	if (aCount == 0)
		aLen += formatex(attackers[aLen], charsmax(attackers) - aLen, " (hasar almadin)^n");

	formatex(full, charsmax(full), "%s^n%s", victims, attackers);

	new Float:hold = get_pcvar_float(g_cvarHold);
	if (hold < 3.0) hold = 3.0;
	if (hold > 20.0) hold = 20.0;

	/* Sol orta — klasik statsx konumu */
	set_hudmessage(255, 255, 255, 0.02, 0.35, 0, 0.0, hold, 0.05, 0.5, -1);
	show_hudmessage(id, "%s", full);

	client_print(id, print_console, "--- Death Stats ---");
	client_print(id, print_console, "%s", victims);
	client_print(id, print_console, "%s", attackers);
}

stock bool:IsPlayer(id)
{
	return id >= 1 && id <= MAX_PLAYERS && is_user_connected(id);
}

stock ClearPlayerStats(id)
{
	if (id < 1 || id > MAX_PLAYERS)
		return;

	/* Sadece bu oyuncunun can istatistikleri — baskalarinin listesini silme */
	for (new i = 1; i <= MAX_PLAYERS; i++)
	{
		g_damageDealt[id][i] = 0;
		g_hitsDealt[id][i] = 0;
		g_damageTaken[id][i] = 0;
		g_hitsTaken[id][i] = 0;
	}
}

stock ClearPlayer(id)
{
	ClearPlayerStats(id);
	if (id >= 1 && id <= MAX_PLAYERS)
	{
		g_traceAttacker[id] = 0;
		g_pendingAttacker[id] = 0;
		g_healthBefore[id] = 0.0;
	}
}
