#include <amxmodx>

/**
 * BrowserCS Rank Takip (account-based)
 * Ticket setinfo _bcs_rank → shared rank_sessions.txt → user_id
 * Kill queue: unix|port|killerUserId|victimUserId|killerName|victimName
 * Missing side uses "-" (guest / unbound). Guests never earn rank.
 * Logged-in killer vs guest → killer kills +1.
 * Logged-in victim vs guest killer → victim deaths +1.
 */

#define PLUGIN_NAME    "BrowserCS Rank"
#define PLUGIN_VERSION "2.0.1"
#define PLUGIN_AUTHOR  "BrowserCS"

#define QUEUE_FILE     "addons/amxmodx/data/rank_kills.log"
#define SESSION_FILE   "addons/amxmodx/data/rank_sessions.txt"
#define PORT_FILE      "addons/amxmodx/configs/browsercs_rank_port.txt"
#define SNAPSHOT_PATTERN "addons/amxmodx/data/rank_snapshot_%d.txt"

#define MAX_PLAYERS 32
#define USER_ID_LEN 40
#define NAME_LEN 32
#define TICKET_LEN 32

new g_cvarEnabled;
new g_cvarPort;
new g_port;

new g_userId[MAX_PLAYERS + 1][USER_ID_LEN];
new g_displayName[MAX_PLAYERS + 1][NAME_LEN];
new bool:g_registered[MAX_PLAYERS + 1];

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);

	g_cvarEnabled = register_cvar("bcs_rank", "1");
	g_cvarPort = register_cvar("bcs_rank_port", "0");
	g_port = 0;

	register_event("DeathMsg", "OnDeathMsg", "a");
	register_clcmd("say", "OnRankSay");
	register_clcmd("say_team", "OnRankSay");
}

public plugin_cfg()
{
	g_port = ResolveRankPort();
	if (g_port > 0)
		set_pcvar_num(g_cvarPort, g_port);

	log_amx("[BrowserCS Rank] v%s enabled=%d port=%d (account)", PLUGIN_VERSION, get_pcvar_num(g_cvarEnabled), g_port);
}

public client_putinserver(id)
{
	ClearSlot(id);
	if (!get_pcvar_num(g_cvarEnabled))
		return;

	new port = g_port;
	if (port <= 0)
		port = ResolveRankPort();
	if (port <= 0)
		return;
	g_port = port;

	/* setinfo may arrive slightly after putinserver */
	set_task(0.35, "TaskBindRank", id);
}

public TaskBindRank(id)
{
	if (!is_user_connected(id) || !get_pcvar_num(g_cvarEnabled))
		return;

	new port = g_port;
	if (port <= 0)
		port = ResolveRankPort();
	if (port <= 0)
		return;
	g_port = port;

	BindRankIdentity(id, port);
}

public client_disconnect(id)
{
	ClearSlot(id);
}

public client_infochanged(id)
{
	/* Nick değişimi kimliği etkilemez — sadece görünen adı güncelle (kayıtlıysa profil adı korunur) */
	if (!is_user_connected(id) || !g_registered[id])
		return;
}

ClearSlot(id)
{
	g_userId[id][0] = 0;
	g_displayName[id][0] = 0;
	g_registered[id] = false;
}

BindRankIdentity(id, port)
{
	new ticket[TICKET_LEN];
	get_user_info(id, "_bcs_rank", ticket, charsmax(ticket));
	SanitizeTicket(ticket, charsmax(ticket));

	if (!ticket[0])
	{
		ClearSlot(id);
		return;
	}

	new userId[USER_ID_LEN], displayName[NAME_LEN], sessionPort;
	if (!LookupSession(ticket, port, userId, charsmax(userId), displayName, charsmax(displayName), sessionPort))
	{
		ClearSlot(id);
		log_amx("[BrowserCS Rank] invalid/expired ticket for #%d", id);
		return;
	}

	copy(g_userId[id], charsmax(g_userId[]), userId);
	copy(g_displayName[id], charsmax(g_displayName[]), displayName);
	g_registered[id] = true;

	/* Client UUID setinfo ile spoof edemesin — temizle */
	client_cmd(id, "setinfo _bcs_uid ^"^"");
}

bool:LookupSession(const ticket[], port, userId[], userIdLen, displayName[], displayNameLen, &outPort)
{
	userId[0] = 0;
	displayName[0] = 0;
	outPort = 0;

	if (!file_exists(SESSION_FILE))
		return false;

	new line[256], lineNumber, textLength;
	new tokTicket[TICKET_LEN], rest[220], tokUser[USER_ID_LEN], tokName[NAME_LEN], tokPort[12], tokExp[16];
	new now = get_systime();

	while (read_file(SESSION_FILE, lineNumber, line, charsmax(line), textLength))
	{
		lineNumber++;
		trim(line);
		if (!line[0] || line[0] == '#')
			continue;

		/* ticket|userId|displayName|port|expiresUnix */
		strtok(line, tokTicket, charsmax(tokTicket), rest, charsmax(rest), '|');
		strtok(rest, tokUser, charsmax(tokUser), rest, charsmax(rest), '|');
		strtok(rest, tokName, charsmax(tokName), rest, charsmax(rest), '|');
		strtok(rest, tokPort, charsmax(tokPort), tokExp, charsmax(tokExp), '|');
		trim(tokTicket);
		trim(tokUser);
		trim(tokName);
		trim(tokExp);

		if (!equali(tokTicket, ticket))
			continue;

		new sessPort = str_to_num(tokPort);
		new expires = str_to_num(tokExp);
		if (sessPort != port)
			return false;
		if (expires > 0 && expires < now)
			return false;
		if (!IsUuid(tokUser))
			return false;

		copy(userId, userIdLen, tokUser);
		copy(displayName, displayNameLen, tokName[0] ? tokName : "Oyuncu");
		Sanitize(displayName, displayNameLen);
		outPort = sessPort;
		return true;
	}

	return false;
}

bool:IsUuid(const s[])
{
	/* 8-4-4-4-12 hex + dashes = 36 chars */
	if (strlen(s) != 36)
		return false;
	if (s[8] != '-' || s[13] != '-' || s[18] != '-' || s[23] != '-')
		return false;
	return true;
}

ResolveRankPort()
{
	new buf[32], port;

	if (file_exists(PORT_FILE))
	{
		new f = fopen(PORT_FILE, "rt");
		if (f)
		{
			fgets(f, buf, charsmax(buf));
			fclose(f);
			for (new i = 0; buf[i]; i++)
			{
				if (buf[i] == '^n' || buf[i] == '^r' || buf[i] == ' ')
					buf[i] = 0;
			}
			port = str_to_num(buf);
			if (port > 0)
				return port;
		}
	}

	get_localinfo("bcs_rank_port", buf, charsmax(buf));
	port = str_to_num(buf);
	if (port > 0)
		return port;

	port = get_pcvar_num(g_cvarPort);
	if (port > 0)
		return port;

	return 0;
}

public OnDeathMsg()
{
	if (!get_pcvar_num(g_cvarEnabled))
		return;

	new port = g_port;
	if (port <= 0)
		port = ResolveRankPort();
	if (port <= 0)
		return;
	g_port = port;

	new killer = read_data(1);
	new victim = read_data(2);

	if (victim < 1 || victim > MAX_PLAYERS)
		return;
	if (killer < 1 || killer > MAX_PLAYERS)
		return;
	if (killer == victim)
		return;
	if (!is_user_connected(killer) || !is_user_connected(victim))
		return;
	if (is_user_bot(killer) || is_user_bot(victim))
		return;

	/* At least one side must be a bound account; guests never get a user_id */
	new bool:killerOk = false;
	new bool:victimOk = false;
	if (g_registered[killer] && g_userId[killer][0])
		killerOk = true;
	if (g_registered[victim] && g_userId[victim][0])
		victimOk = true;
	if (!killerOk && !victimOk)
		return;
	if (killerOk && victimOk && equali(g_userId[killer], g_userId[victim]))
		return;

	new kName[NAME_LEN], vName[NAME_LEN];
	new kId[USER_ID_LEN], vId[USER_ID_LEN];

	if (killerOk)
	{
		copy(kId, charsmax(kId), g_userId[killer]);
		copy(kName, charsmax(kName), g_displayName[killer][0] ? g_displayName[killer] : "Oyuncu");
	}
	else
	{
		copy(kId, charsmax(kId), "-");
		get_user_name(killer, kName, charsmax(kName));
	}

	if (victimOk)
	{
		copy(vId, charsmax(vId), g_userId[victim]);
		copy(vName, charsmax(vName), g_displayName[victim][0] ? g_displayName[victim] : "Oyuncu");
	}
	else
	{
		copy(vId, charsmax(vId), "-");
		get_user_name(victim, vName, charsmax(vName));
	}

	Sanitize(kName, charsmax(kName));
	Sanitize(vName, charsmax(vName));

	new line[256];
	formatex(
		line,
		charsmax(line),
		"%d|%d|%s|%s|%s|%s^n",
		get_systime(),
		port,
		kId,
		vId,
		kName,
		vName
	);

	new file = fopen(QUEUE_FILE, "at");
	if (!file)
	{
		log_amx("[BrowserCS Rank] queue open failed: %s", QUEUE_FILE);
		return;
	}
	fputs(file, line);
	fclose(file);
}

public OnRankSay(id)
{
	if (!is_user_connected(id) || !get_pcvar_num(g_cvarEnabled))
		return PLUGIN_CONTINUE;

	new command[64];
	read_args(command, charsmax(command));
	remove_quotes(command);
	trim(command);

	if (command[0] == '/' || command[0] == '!' || command[0] == '.')
	{
		copy(command, charsmax(command), command[1]);
		trim(command);
	}

	if (equali(command, "rank") || equali(command, "siralamam") || equali(command, "sira"))
	{
		ShowPlayerRank(id);
		return PLUGIN_HANDLED;
	}

	if (equali(command, "top20") || equali(command, "top 20") || equali(command, "top"))
	{
		ShowTop20(id);
		return PLUGIN_HANDLED;
	}

	return PLUGIN_CONTINUE;
}

BuildSnapshotPath(path[], len)
{
	new port = g_port;
	if (port <= 0)
		port = ResolveRankPort();

	if (port <= 0)
	{
		path[0] = 0;
		return 0;
	}

	g_port = port;
	formatex(path, len, SNAPSHOT_PATTERN, port);
	return 1;
}

public ShowPlayerRank(id)
{
	if (!g_registered[id] || !g_userId[id][0])
	{
		client_print(id, print_chat, "[BrowserCS] Rank icin uye girisi gerekli. Misafir hesaplar siralamaya yazilmaz.");
		return;
	}

	new path[128];
	if (!BuildSnapshotPath(path, charsmax(path)) || !file_exists(path))
	{
		client_print(id, print_chat, "[BrowserCS] Rank verisi henuz hazir degil.");
		return;
	}

	new line[256], lineNumber, textLength;
	new posText[12], userId[USER_ID_LEN], rest[200], name[NAME_LEN], killsText[12], deathsText[12];
	while (read_file(path, lineNumber, line, charsmax(line), textLength))
	{
		lineNumber++;
		trim(line);
		if (!line[0])
			continue;

		/* rank|userId|displayName|kills|deaths */
		strtok(line, posText, charsmax(posText), rest, charsmax(rest), '|');
		strtok(rest, userId, charsmax(userId), rest, charsmax(rest), '|');
		strtok(rest, name, charsmax(name), rest, charsmax(rest), '|');
		strtok(rest, killsText, charsmax(killsText), deathsText, charsmax(deathsText), '|');
		trim(userId);
		trim(deathsText);

		if (!equali(userId, g_userId[id]))
			continue;

		new kills = str_to_num(killsText);
		new deaths = str_to_num(deathsText);
		new Float:kd = deaths > 0 ? float(kills) / float(deaths) : float(kills);
		client_print(
			id,
			print_chat,
			"[BrowserCS] Siralaman: #%d | Kill: %d | Olum: %d | K/D: %.2f",
			str_to_num(posText),
			kills,
			deaths,
			kd
		);
		return;
	}

	client_print(id, print_chat, "[BrowserCS] Bu ay henuz rank kaydin bulunmuyor.");
}

public ShowTop20(id)
{
	new path[128];
	if (!BuildSnapshotPath(path, charsmax(path)) || !file_exists(path))
	{
		client_print(id, print_chat, "[BrowserCS] Top 20 verisi henuz hazir degil.");
		return;
	}

	new motd[1536], used;
	used = formatex(
		motd,
		charsmax(motd),
		"<html><body bgcolor=#111318 text=#f4f4f4><font face=Verdana size=2><h2>BrowserCS Aylik Top 20</h2><p>Sadece kayitli hesaplar</p><table width=100%% cellpadding=3><tr><td><b>#</b></td><td><b>Oyuncu</b></td><td><b>Kill</b></td><td><b>Olum</b></td></tr>"
	);

	new line[256], lineNumber, textLength, shown;
	new posText[12], userId[USER_ID_LEN], rest[200], name[NAME_LEN], killsText[12], deathsText[12];
	while (shown < 20 && read_file(path, lineNumber, line, charsmax(line), textLength))
	{
		lineNumber++;
		trim(line);
		if (!line[0])
			continue;

		strtok(line, posText, charsmax(posText), rest, charsmax(rest), '|');
		strtok(rest, userId, charsmax(userId), rest, charsmax(rest), '|');
		strtok(rest, name, charsmax(name), rest, charsmax(rest), '|');
		strtok(rest, killsText, charsmax(killsText), deathsText, charsmax(deathsText), '|');
		trim(name);
		trim(deathsText);
		Sanitize(name, charsmax(name));

		if (used >= charsmax(motd) - 96)
			break;

		used += formatex(
			motd[used],
			charsmax(motd) - used,
			"<tr><td>#%d</td><td>%s</td><td>%d</td><td>%d</td></tr>",
			str_to_num(posText),
			name[0] ? name : "Oyuncu",
			str_to_num(killsText),
			str_to_num(deathsText)
		);
		shown++;
	}

	if (!shown)
	{
		client_print(id, print_chat, "[BrowserCS] Bu ay henuz rank kaydi yok.");
		return;
	}

	formatex(motd[used], charsmax(motd) - used, "</table><p>Her ay siralama yenilenir. Nick degisikligi siralamayi etkilemez.</p></font></body></html>");
	show_motd(id, motd, "BrowserCS Top 20");
}

Sanitize(str[], len)
{
	for (new i = 0; i < len; i++)
	{
		if (!str[i])
			break;
		if (
			str[i] == '|' ||
			str[i] == '<' ||
			str[i] == '>' ||
			str[i] == '&' ||
			str[i] == '"' ||
			str[i] == '^n' ||
			str[i] == '^r'
		)
			str[i] = '_';
	}
}

SanitizeTicket(str[], len)
{
	for (new i = 0; i < len; i++)
	{
		if (!str[i])
			break;
		new c = str[i];
		if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')))
		{
			str[i] = 0;
			break;
		}
	}
}
