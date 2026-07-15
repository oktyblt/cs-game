#include <amxmodx>

#define PLUGIN_NAME "BrowserCS Chat Commands"
#define PLUGIN_VERSION "1.0.0"
#define PLUGIN_AUTHOR "BrowserCS"
#define SERVER_CONFIG_PATH "server.cfg"

new g_browsercsNextMap;

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);

	g_browsercsNextMap = register_cvar(
		"browsercs_nextmap",
		"",
		FCVAR_SERVER
	);

	register_clcmd("say", "BrowserCS_HandleSay");
	register_clcmd("say_team", "BrowserCS_HandleSay");
}

public plugin_cfg()
{
	BrowserCS_LoadNextMapConfig();
}

stock BrowserCS_LoadNextMapConfig()
{
	new line[192];
	new lineNumber;
	new textLength;

	while (
		read_file(
			SERVER_CONFIG_PATH,
			lineNumber,
			line,
			charsmax(line),
			textLength
		)
	)
	{
		lineNumber++;
		trim(line);

		if (
			!line[0] ||
			line[0] == ';' ||
			(line[0] == '/' && line[1] == '/')
		)
		{
			continue;
		}

		new cvarName[64];
		new cvarValue[64];

		parse(
			line,
			cvarName,
			charsmax(cvarName),
			cvarValue,
			charsmax(cvarValue)
		);

		if (!equali(cvarName, "browsercs_nextmap"))
			continue;

		remove_quotes(cvarValue);
		trim(cvarValue);
		set_pcvar_string(g_browsercsNextMap, cvarValue);
	}
}

public BrowserCS_HandleSay(id)
{
	if (!is_user_connected(id))
		return PLUGIN_CONTINUE;

	new command[128];
	read_args(command, charsmax(command));
	remove_quotes(command);
	trim(command);

	BrowserCS_NormalizeChatCommand(command, charsmax(command));

	if (!command[0])
		return PLUGIN_CONTINUE;

	if (
		equali(command, "timeleft") ||
		equali(command, "kalansure") ||
		equali(command, "kalan sure")
	)
	{
		BrowserCS_HandleTimeleft(id);
		return PLUGIN_HANDLED;
	}

	if (
		equali(command, "nextmap") ||
		equali(command, "sonrakiharita") ||
		equali(command, "sonraki harita")
	)
	{
		BrowserCS_HandleNextmap(id);
		return PLUGIN_HANDLED;
	}

	if (
		equali(command, "nexttime") ||
		equali(command, "thetime") ||
		equali(command, "saat") ||
		equali(command, "zaman")
	)
	{
		BrowserCS_HandleTheTime(id);
		return PLUGIN_HANDLED;
	}

	return PLUGIN_CONTINUE;
}

stock BrowserCS_NormalizeChatCommand(command[], length)
{
	trim(command);

	if (
		command[0] == '/' ||
		command[0] == '!' ||
		command[0] == '.'
	)
	{
		copy(command, length, command[1]);
		trim(command);
	}
}

stock BrowserCS_HandleTimeleft(id)
{
	new seconds = get_timeleft();

	if (get_cvar_float("mp_timelimit") <= 0.0)
	{
		BrowserCS_SendChatReply(
			id,
			"Bu haritada sure siniri bulunmuyor."
		);
		return;
	}

	if (seconds < 0)
		seconds = 0;

	BrowserCS_SendChatReply(
		id,
		"Haritanin bitmesine %02d:%02d kaldi.",
		seconds / 60,
		seconds % 60
	);
}

stock BrowserCS_HandleNextmap(id)
{
	new nextMap[64];
	get_pcvar_string(
		g_browsercsNextMap,
		nextMap,
		charsmax(nextMap)
	);
	trim(nextMap);

	if (!nextMap[0])
	{
		BrowserCS_SendChatReply(
			id,
			"Sonraki harita henuz belirlenmedi."
		);
		return;
	}

	BrowserCS_SendChatReply(
		id,
		"Sonraki harita: %s",
		nextMap
	);
}

stock BrowserCS_HandleTheTime(id)
{
	new nextMap[64];
	get_pcvar_string(
		g_browsercsNextMap,
		nextMap,
		charsmax(nextMap)
	);
	trim(nextMap);

	if (get_cvar_float("mp_timelimit") <= 0.0)
	{
		if (nextMap[0])
		{
			BrowserCS_SendChatReply(
				id,
				"Sure siniri yok | Sonraki harita: %s",
				nextMap
			);
		}
		else
		{
			BrowserCS_SendChatReply(
				id,
				"Sure siniri yok | Sonraki harita belirlenmedi."
			);
		}

		return;
	}

	new seconds = get_timeleft();

	if (seconds < 0)
		seconds = 0;

	if (nextMap[0])
	{
		BrowserCS_SendChatReply(
			id,
			"Kalan sure: %02d:%02d | Sonraki harita: %s",
			seconds / 60,
			seconds % 60,
			nextMap
		);
	}
	else
	{
		BrowserCS_SendChatReply(
			id,
			"Kalan sure: %02d:%02d | Sonraki harita belirlenmedi.",
			seconds / 60,
			seconds % 60
		);
	}
}

stock BrowserCS_SendChatReply(
	id,
	const message[],
	any:...
)
{
	new output[192];
	vformat(output, charsmax(output), message, 3);

	client_print(
		id,
		print_chat,
		"[BrowserCS] %s",
		output
	);
}
