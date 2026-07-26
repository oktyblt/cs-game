#include <amxmodx>
#include <fakemeta>
#include <fakemeta_util>
#include <hamsandwich>

#define PLUGIN_NAME "BrowserCS Deathmatch"
#define PLUGIN_VERSION "1.6.0"
#define MENU_LOADOUT "BrowserCS DMLoadout"

#define LOADOUT_COLT 1
#define LOADOUT_AWP 2
#define LOADOUT_AK47 3
#define LOADOUT_42 4
#define LOADOUT_44 5
#define PLUGIN_AUTHOR "BrowserCS"

#define MAX_SPAWNS 128
#define MIN_SPAWN_DIST 220.0
#define SPAWN_PICK_TRIES 24

new g_cvar_dm;
new g_cvar_delay;
new g_cvar_protect;

new Float:g_spawns[MAX_SPAWNS][3];
new Float:g_spawnAngles[MAX_SPAWNS][3];
new Float:g_spawnVAngles[MAX_SPAWNS][3];
new g_spawnCount;

new bool:g_spawnProtected[33];
new g_playerLoadout[33];
new g_lastSpawnSlot[33];
new Float:g_lastSpawnOrigin[33][3];

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);

	g_cvar_dm = register_cvar("browsercs_dm", "0");
	g_cvar_delay = register_cvar("browsercs_dm_delay", "1.5");
	g_cvar_protect = register_cvar("browsercs_dm_protect", "1.5");

	RegisterHam(Ham_Spawn, "player", "fw_Spawn_Post", 1);
	RegisterHam(Ham_TakeDamage, "player", "fw_TakeDamage_Pre", 0);
	RegisterHam(Ham_Killed, "player", "fw_Killed_Pre", 0);

	register_event("DeathMsg", "event_death", "a");
	register_logevent("event_round_end", 2, "1=Round_End");

	register_clcmd("buy", "cmd_dm_buy");
	register_clcmd("autobuy", "cmd_dm_buy_block");
	register_clcmd("rebuy", "cmd_dm_buy_block");
	register_clcmd("dm_loadout", "cmd_dm_buy");
	register_menucmd(
		register_menuid(MENU_LOADOUT),
		(MENU_KEY_1|MENU_KEY_2|MENU_KEY_3|MENU_KEY_4|MENU_KEY_5|MENU_KEY_0),
		"h_menu_loadout"
	);
}

public plugin_cfg()
{
	dm_try_enable_from_mode_file();
	dm_try_enable_from_hostname();

	if (get_pcvar_num(g_cvar_dm) != 1)
	{
		return;
	}

	server_cmd("mp_freezetime 0");
	server_cmd("mp_roundtime 999");
	server_cmd("mp_timelimit 0");
	server_cmd("mp_maxrounds 0");
	server_cmd("mp_winlimit 0");
	server_cmd("mp_fraglimit 0");
	server_cmd("mp_autoteambalance 0");
	server_cmd("mp_limitteams 0");
	server_cmd("mp_friendlyfire 0");
	server_cmd("mp_forcecamera 0");
	server_cmd("mp_forcechasecam 0");
	server_cmd("mp_buytime 999");
	server_cmd("mp_startmoney 16000");
	server_cmd("sv_alltalk 1");
	server_cmd("mp_forcerespawn 1");
	server_cmd("mp_c4timer 999");
	server_cmd("mp_autokick 0");
	server_cmd("mp_tkpunish 0");
	server_cmd("mp_chattime 0");
	server_cmd("mp_round_infinite 1");
	server_cmd("mp_round_restart_delay 0");
	server_exec();

	set_task(1.0, "task_collect_spawns");
	set_task(2.0, "task_purge_fake_clients");
	log_amx("[BrowserCS DM] Deathmatch mode active (no fake round blockers)");
}

public task_purge_fake_clients()
{
	if (get_pcvar_num(g_cvar_dm) != 1)
	{
		return;
	}

	new players[32], count;
	get_players(players, count, "ch");

	for (new i = 0; i < count; i++)
	{
		new id = players[i];

		if (!(pev(id, pev_flags) & FL_FAKECLIENT))
		{
			continue;
		}

		new name[32];
		get_user_name(id, name, charsmax(name));
		trim(name);

		if (!name[0] || equali(name, "Unnamed"))
		{
			server_cmd("kick #%d", get_user_userid(id));
			log_amx("[BrowserCS DM] Removed stray fake client #%d", get_user_userid(id));
		}
	}
}

stock dm_try_enable_from_mode_file()
{
	new mode[32];
	if (!dm_read_mode_file(mode, charsmax(mode)))
	{
		return;
	}

	if (equali(mode, "deathmatch"))
	{
		set_pcvar_num(g_cvar_dm, 1);
	}
}

stock dm_try_enable_from_hostname()
{
	if (get_pcvar_num(g_cvar_dm) == 1)
	{
		return;
	}

	new hostname[64];
	get_cvar_string("hostname", hostname, charsmax(hostname));

	if (containi(hostname, "DEATHMATCH") != -1)
	{
		set_pcvar_num(g_cvar_dm, 1);
	}
}

stock bool:dm_read_mode_file(mode[], len)
{
	new path[128];
	get_localinfo("amxx_configsdir", path, charsmax(path));
	format(path, charsmax(path), "%s/browsercs_mode.txt", path);

	if (!file_exists(path))
	{
		copy(path, charsmax(path), "browsercs_mode.txt");
	}

	if (!file_exists(path))
	{
		return false;
	}

	new file = fopen(path, "rt");
	if (!file)
	{
		return false;
	}

	mode[0] = 0;
	fgets(file, mode, len);
	trim(mode);
	fclose(file);

	return mode[0] != 0;
}

public client_putinserver(id)
{
	if (get_pcvar_num(g_cvar_dm) != 1)
	{
		return;
	}

	if (is_user_bot(id))
	{
		return;
	}

	if (g_playerLoadout[id] < 1)
	{
		g_playerLoadout[id] = LOADOUT_AK47;
	}

	set_task(1.2, "task_auto_join", id);
}

public task_auto_join(id)
{
	if (get_pcvar_num(g_cvar_dm) != 1 || !is_user_connected(id) || is_user_bot(id))
	{
		return;
	}

	if (is_user_alive(id))
	{
		set_task(0.15, "task_finalize_spawn", id + 1000);
		return;
	}

	/* CS 1.5/1.6: 1=T, 2=CT — server-side auto team */
	new team = (id % 2) ? 1 : 2;
	dm_force_team(id, team);
	set_task(0.8, "task_try_spawn", id);
}

public task_try_spawn(id)
{
	if (get_pcvar_num(g_cvar_dm) != 1 || !is_user_connected(id) || is_user_bot(id))
	{
		return;
	}

	if (!is_user_alive(id))
	{
		dm_respawn_player(id);
	}

	set_task(0.15, "task_finalize_spawn", id + 1000);
}

public client_disconnect(id)
{
	g_spawnProtected[id] = false;
	g_playerLoadout[id] = 0;
	remove_task(id);
	remove_task(id + 1000);
	remove_task(id + 2000);
	remove_task(id + 3000);
}

public fw_Spawn_Post(id)
{
	if (get_pcvar_num(g_cvar_dm) != 1 || !is_user_alive(id))
	{
		return;
	}

	set_task(0.1, "task_finalize_spawn", id + 1000);
}

public event_death()
{
	if (get_pcvar_num(g_cvar_dm) != 1)
	{
		return;
	}

	new victim = read_data(2);
	if (victim < 1 || victim > 32)
	{
		return;
	}

	g_spawnProtected[victim] = false;
	remove_task(victim);
	remove_task(victim + 1000);
	remove_task(victim + 2000);
	remove_task(victim + 3000);

	set_task(get_pcvar_float(g_cvar_delay), "task_respawn", victim);
}

public task_respawn(id)
{
	if (!is_user_connected(id) || is_user_alive(id))
	{
		return;
	}

	dm_respawn_player(id);
	set_task(0.15, "task_finalize_spawn", id + 1000);
}

public task_collect_spawns()
{
	g_spawnCount = 0;

	if (dm_load_preset_spawns())
	{
		log_amx("[BrowserCS DM] Loaded %d preset spawn points", g_spawnCount);
		return;
	}

	/* Yedek: harita entity'leri (genelde sadece base'ler) */
	dm_collect_class("info_player_deathmatch");
	dm_collect_class("info_player_start");
	dm_collect_class("info_player_terrorist");
	dm_collect_class("info_player_counterterrorist");

	log_amx("[BrowserCS DM] Loaded %d map entity spawn points (fallback)", g_spawnCount);
}

stock bool:dm_load_preset_spawns()
{
	new map[32];
	get_mapname(map, charsmax(map));

	new paths[4][160];
	new cfgdir[96];
	get_localinfo("amxx_configsdir", cfgdir, charsmax(cfgdir));

	format(paths[0], charsmax(paths[]), "%s/browsercs_dm/%s.spawns.cfg", cfgdir, map);
	format(paths[1], charsmax(paths[]), "addons/amxmodx/configs/browsercs_dm/%s.spawns.cfg", map);
	format(paths[2], charsmax(paths[]), "browsercs_dm/%s.spawns.cfg", map);
	format(paths[3], charsmax(paths[]), "configs/browsercs_dm/%s.spawns.cfg", map);

	for (new i = 0; i < 4; i++)
	{
		if (paths[i][0] == 0)
		{
			continue;
		}

		if (dm_load_spawn_file(paths[i]))
		{
			log_amx("[BrowserCS DM] Preset spawns: %s", paths[i]);
			return true;
		}
	}

	return false;
}

stock bool:dm_load_spawn_file(const path[])
{
	new file = fopen(path, "rt");
	if (!file)
	{
		return false;
	}

	new line[128];
	while (!feof(file) && g_spawnCount < MAX_SPAWNS)
	{
		fgets(file, line, charsmax(line));
		trim(line);

		if (!line[0] || line[0] == ';' || line[0] == '#')
		{
			continue;
		}

		if (!dm_parse_spawn_line(line))
		{
			continue;
		}

		g_spawnCount++;
	}

	fclose(file);
	return g_spawnCount > 0;
}

stock bool:dm_parse_spawn_line(const line[])
{
	new work[128];
	copy(work, charsmax(work), line);

	new idx = 0;
	new tok[16];
	new Float:vals[10];
	new count = 0;

	while (idx < strlen(work) && count < 10)
	{
		new start = idx;

		while (work[idx] != 0 && work[idx] != 32)
		{
			idx++;
		}

		if (idx == start)
		{
			idx++;
			continue;
		}

		new len = idx - start;
		if (len >= charsmax(tok))
		{
			len = charsmax(tok) - 1;
		}

		copy(tok, len + 1, work[start]);
		vals[count] = str_to_float(tok);
		count++;

		if (work[idx] == 32)
		{
			idx++;
		}
	}

	if (count < 7)
	{
		return false;
	}

	/* CSDM: x y z | pitch yaw roll | team | v_pitch v_yaw v_roll */
	g_spawns[g_spawnCount][0] = vals[0];
	g_spawns[g_spawnCount][1] = vals[1];
	g_spawns[g_spawnCount][2] = vals[2];
	g_spawnAngles[g_spawnCount][0] = vals[3];
	g_spawnAngles[g_spawnCount][1] = vals[4];
	g_spawnAngles[g_spawnCount][2] = vals[5];
	if (count >= 10)
	{
		g_spawnVAngles[g_spawnCount][0] = vals[7];
		g_spawnVAngles[g_spawnCount][1] = vals[8];
		g_spawnVAngles[g_spawnCount][2] = vals[9];
	}
	else
	{
		g_spawnVAngles[g_spawnCount][0] = vals[3];
		g_spawnVAngles[g_spawnCount][1] = vals[4];
		g_spawnVAngles[g_spawnCount][2] = vals[5];
	}
	return true;
}

public task_finalize_spawn(taskId)
{
	new id = taskId - 1000;

	if (get_pcvar_num(g_cvar_dm) != 1 || !is_user_alive(id))
	{
		return;
	}

	if (g_spawnCount < 1)
	{
		task_collect_spawns();
	}

	dm_teleport_random(id);
	dm_give_loadout(id);
	dm_apply_spawn_protection(id);
	dm_sync_client(id);

	/* Motor bazen info_player_start'a çeker — AYNI slota geri koy (yeni random DEĞİL) */
	set_task(0.25, "task_reinforce_spawn", id + 3000);
	set_task(0.55, "task_reinforce_spawn", id + 3000);
}

public task_reinforce_spawn(taskId)
{
	new id = taskId - 3000;

	if (get_pcvar_num(g_cvar_dm) != 1 || !is_user_alive(id))
	{
		return;
	}

	/* Sadece spawn noktasından kaydıysa aynı slota geri çek — hitreg bozan random TP yok */
	new Float:cur[3];
	pev(id, pev_origin, cur);
	new Float:dx = cur[0] - g_lastSpawnOrigin[id][0];
	new Float:dy = cur[1] - g_lastSpawnOrigin[id][1];
	new Float:dz = cur[2] - g_lastSpawnOrigin[id][2];
	if ((dx * dx + dy * dy + dz * dz) < (120.0 * 120.0))
	{
		return;
	}

	dm_teleport_slot(id, g_lastSpawnSlot[id]);
	dm_sync_client(id);
}

public fw_TakeDamage_Pre(victim, inflictor, attacker, Float:damage, damagebits)
{
	if (g_spawnProtected[victim])
	{
		if (attacker >= 1 && attacker <= 32 && attacker != victim && is_user_connected(attacker))
		{
			client_print(attacker, print_center, "Spawn korumasi — isabet yok");
		}
		return HAM_SUPERCEDE;
	}

	return HAM_IGNORED;
}

public fw_Killed_Pre(victim)
{
	return HAM_IGNORED;
}

public event_round_end()
{
	if (get_pcvar_num(g_cvar_dm) != 1)
	{
		return;
	}

	/* Yedek: round yine de biterse intermission'ı atla, herkesi respawn et */
	server_cmd("mp_chattime 0");
	set_task(0.15, "task_resume_after_round_end");
}

public task_resume_after_round_end()
{
	if (get_pcvar_num(g_cvar_dm) != 1)
	{
		return;
	}

	dm_respawn_all_dead();
}

stock dm_respawn_all_dead()
{
	new players[32], count;
	get_players(players, count, "c");

	for (new i = 0; i < count; i++)
	{
		new id = players[i];

		if (is_user_bot(id))
		{
			continue;
		}

		if (!is_user_alive(id))
		{
			dm_respawn_player(id);
			set_task(0.2, "task_finalize_spawn", id + 1000);
		}
	}
}

public task_remove_protection(taskId)
{
	new id = taskId - 2000;

	if (!is_user_connected(id))
	{
		return;
	}

	g_spawnProtected[id] = false;

	if (is_user_alive(id))
	{
		set_pev(id, pev_takedamage, 1.0);
		set_pev(id, pev_effects, pev(id, pev_effects) & ~EF_BRIGHTLIGHT);
	}
}

stock dm_force_team(id, team)
{
	if (!is_user_connected(id))
	{
		return;
	}

	if (team != 1 && team != 2)
	{
		team = 1;
	}

	engfunc(EngFunc_SetClientKeyValue, id, engfunc(EngFunc_GetInfoKeyBuffer, id), "team", team == 1 ? "TERRORIST" : "CT");
	client_cmd(id, "jointeam %d", team);
}

stock dm_respawn_player(id)
{
	if (!is_user_connected(id) || is_user_alive(id))
	{
		return;
	}

	fm_cs_user_spawn(id);
}

stock dm_sync_client(id)
{
	if (!is_user_connected(id))
	{
		return;
	}

	client_cmd(id, "fullupdate");
	set_pev(id, pev_fixangle, 1);
}

stock dm_collect_class(const classname[])
{
	new ent = -1;

	while ((ent = fm_find_ent_by_class(ent, classname)) > 0)
	{
		if (g_spawnCount >= MAX_SPAWNS)
		{
			break;
		}

		new Float:origin[3];
		new Float:angles[3];
		pev(ent, pev_origin, origin);
		pev(ent, pev_angles, angles);

		g_spawns[g_spawnCount][0] = origin[0];
		g_spawns[g_spawnCount][1] = origin[1];
		g_spawns[g_spawnCount][2] = origin[2];
		g_spawnAngles[g_spawnCount][0] = angles[0];
		g_spawnAngles[g_spawnCount][1] = angles[1];
		g_spawnAngles[g_spawnCount][2] = angles[2];
		g_spawnVAngles[g_spawnCount][0] = angles[0];
		g_spawnVAngles[g_spawnCount][1] = angles[1];
		g_spawnVAngles[g_spawnCount][2] = angles[2];
		g_spawnCount++;
	}
}

stock Float:dm_dist_sq(Float:a[3], Float:b[3])
{
	new Float:dx = a[0] - b[0];
	new Float:dy = a[1] - b[1];
	new Float:dz = a[2] - b[2];
	return dx * dx + dy * dy + dz * dz;
}

stock bool:dm_spawn_clear(id, Float:origin[3])
{
	new players[32], count;
	get_players(players, count, "a");

	new Float:minDistSq = MIN_SPAWN_DIST * MIN_SPAWN_DIST;
	new Float:loc[3];

	for (new i = 0; i < count; i++)
	{
		if (players[i] == id)
		{
			continue;
		}

		pev(players[i], pev_origin, loc);

		if (dm_dist_sq(origin, loc) < minDistSq)
		{
			return false;
		}
	}

	return true;
}

stock dm_teleport_slot(id, slot)
{
	if (g_spawnCount < 1)
	{
		return;
	}

	if (slot < 0 || slot >= g_spawnCount)
	{
		slot = 0;
	}

	new Float:origin[3];
	new Float:angles[3];
	new Float:vangles[3];

	origin[0] = g_spawns[slot][0];
	origin[1] = g_spawns[slot][1];
	origin[2] = g_spawns[slot][2];

	/* Body pitch must stay 0; view pitch comes from CSDM v_angles */
	angles[0] = 0.0;
	angles[1] = g_spawnAngles[slot][1];
	angles[2] = 0.0;
	vangles[0] = g_spawnVAngles[slot][0];
	vangles[1] = g_spawnVAngles[slot][1];
	vangles[2] = 0.0;

	g_lastSpawnSlot[id] = slot;
	g_lastSpawnOrigin[id][0] = origin[0];
	g_lastSpawnOrigin[id][1] = origin[1];
	g_lastSpawnOrigin[id][2] = origin[2];

	fm_entity_set_origin(id, origin);
	set_pev(id, pev_angles, angles);
	set_pev(id, pev_v_angle, vangles);
	set_pev(id, pev_fixangle, 1);
	set_pev(id, pev_velocity, Float:{0.0, 0.0, 0.0});
	set_pev(id, pev_punchangle, Float:{0.0, 0.0, 0.0});
	fm_drop_to_floor(id);
}

stock dm_teleport_random(id)
{
	if (g_spawnCount < 1)
	{
		return;
	}

	new slot = -1;
	new tries = 0;
	new Float:origin[3];

	while (tries < SPAWN_PICK_TRIES)
	{
		new candidate = random_num(0, g_spawnCount - 1);

		origin[0] = g_spawns[candidate][0];
		origin[1] = g_spawns[candidate][1];
		origin[2] = g_spawns[candidate][2];

		if (g_spawnCount < 3 || dm_spawn_clear(id, origin))
		{
			slot = candidate;
			break;
		}

		tries++;
	}

	if (slot == -1)
	{
		slot = random_num(0, g_spawnCount - 1);
	}

	dm_teleport_slot(id, slot);
}

stock dm_give_loadout(id)
{
	if (!is_user_alive(id))
	{
		return;
	}

	new loadout = g_playerLoadout[id];
	if (loadout < LOADOUT_COLT || loadout > LOADOUT_44)
	{
		loadout = LOADOUT_AK47;
	}

	switch (loadout)
	{
		case LOADOUT_COLT:
		{
			dm_give_pack(id, "weapon_m4a1", true, false);
		}
		case LOADOUT_AWP:
		{
			dm_give_pack(id, "weapon_awp", false, true);
		}
		case LOADOUT_AK47:
		{
			dm_give_pack(id, "weapon_ak47", true, false);
		}
		case LOADOUT_42:
		{
			dm_give_pack(id, "weapon_galil", true, false);
		}
		case LOADOUT_44:
		{
			dm_give_pack(id, "weapon_sg552", true, false);
		}
	}
}

stock dm_give_pack(id, const primary[], bool:giveHe, bool:giveFlash)
{
	fm_strip_user_weapons(id);
	fm_give_item(id, "weapon_knife");

	if (primary[0])
	{
		fm_give_item(id, primary);
	}

	fm_give_item(id, "weapon_deagle");

	if (giveHe)
	{
		fm_give_item(id, "weapon_hegrenade");
	}

	if (giveFlash)
	{
		fm_give_item(id, "weapon_flashbang");
	}

	fm_give_item(id, "item_assaultsuit");

	new wname[32];
	copy(wname, charsmax(wname), primary);
	replace(wname, charsmax(wname), "weapon_", "");
	client_cmd(id, "weapon_%s", wname);
}

public cmd_dm_buy_block(id)
{
	if (get_pcvar_num(g_cvar_dm) == 1)
	{
		return PLUGIN_HANDLED;
	}

	return PLUGIN_CONTINUE;
}

public cmd_dm_buy(id)
{
	if (get_pcvar_num(g_cvar_dm) != 1)
	{
		return PLUGIN_CONTINUE;
	}

	if (!is_user_connected(id) || !is_user_alive(id))
	{
		return PLUGIN_HANDLED;
	}

	dm_show_loadout_menu(id);
	return PLUGIN_HANDLED;
}

stock dm_show_loadout_menu(id)
{
	new title[64];
	new current = g_playerLoadout[id];

	switch (current)
	{
		case LOADOUT_COLT: copy(title, charsmax(title), "Colt (M4A1)");
		case LOADOUT_AWP: copy(title, charsmax(title), "AWP");
		case LOADOUT_AK47: copy(title, charsmax(title), "AK47");
		case LOADOUT_42: copy(title, charsmax(title), "Galil (4-2)");
		case LOADOUT_44: copy(title, charsmax(title), "SG552 (4-4)");
		default: copy(title, charsmax(title), "AK47");
	}

	new menu[640];
	format(
		menu,
		charsmax(menu),
		"\rBrowserCS DM \ySilah Paketi^n^n\
\r1.\w Colt (M4A1) + Deagle + BOMBA + Yelek/Kask^n\
\r2.\w AWP + Deagle + Yelek/Kask^n\
\r3.\w AK47 + Deagle + BOMBA + Yelek/Kask^n\
\r4.\w Galil + Deagle + BOMBA + Yelek (4-2)^n\
\r5.\w SG552 + Deagle + BOMBA + Yelek (4-4)^n^n\
\ySecili: \w%s \d(B = menu)^n\
\dHer dogusta secili paket verilir.",
		title
	);

	show_menu(
		id,
		(MENU_KEY_1|MENU_KEY_2|MENU_KEY_3|MENU_KEY_4|MENU_KEY_5|MENU_KEY_0),
		menu,
		-1,
		MENU_LOADOUT
	);
}

public h_menu_loadout(id, key)
{
	if (get_pcvar_num(g_cvar_dm) != 1 || !is_user_connected(id))
	{
		return PLUGIN_HANDLED;
	}

	if (key == 9)
	{
		return PLUGIN_HANDLED;
	}

	new choice = key + 1;
	if (choice < LOADOUT_COLT || choice > LOADOUT_44)
	{
		return PLUGIN_HANDLED;
	}

	g_playerLoadout[id] = choice;
	client_print(id, print_center, "Silah paketi secildi! Sonraki dogusta uygulanir.");

	if (is_user_alive(id))
	{
		dm_give_loadout(id);
	}

	return PLUGIN_HANDLED;
}

stock dm_apply_spawn_protection(id)
{
	new Float:protectTime = get_pcvar_float(g_cvar_protect);

	if (protectTime <= 0.0)
	{
		return;
	}

	g_spawnProtected[id] = true;
	set_pev(id, pev_takedamage, 0.0);
	set_pev(id, pev_effects, pev(id, pev_effects) | EF_BRIGHTLIGHT);

	remove_task(id + 2000);
	set_task(protectTime, "task_remove_protection", id + 2000);
}
