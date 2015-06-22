var _ = require('underscore');
var util = require('util');

var cards = require('./cards.js');
var games = {};

// should this be in the config?
var INITIAL_WAIT_SECS = 30;
var NOT_ENOUGH_PLAYERS_WAIT_MINS = 3;

/* "external" game functions */

function start_game(gameid, settings) {
	games[gameid] = {};
	games[gameid].settings = settings;
	games[gameid].players = [];
	games[gameid].timer_start = setTimeout(function() { timer_start(gameid); }, INITIAL_WAIT_SECS * 1000);
	games[gameid].timer_stop = null;
	games[gameid].round_no = 1;
	games[gameid].czar_idx = 0;
	games[gameid].q_card = null;

	global.client.send(settings.channel, util.format("Starting a new game of Cards Against Humanity. The game will start in %d seconds, type !join to join.", INITIAL_WAIT_SECS));
}

function stop_game(gameid, user) {
	if(user && games[gameid].settings.starter != user)
		return false;
	global.client.send(games[gameid].settings.channel, "Game stopped.");

	if(games[gameid].timer_start)
		clearTimeout(games[gameid].timer_start);
	if(games[gameid].timer_stop)
		clearTimeout(games[gameid].timer_stop);
	games[gameid] = undefined;
}

function join_game(gameid, user)
{
	if(_.indexOf(games[gameid].players, user) != -1)
		return false;
	games[gameid].players.push(user);
	global.client.send(games[gameid].settings.channel, user + " joined the game.");
	if(games[gameid].players.length >= 3)
		_start_game(gameid);
}

function leave_game(gameid, user)
{
	if(_.indexOf(games[gameid].players, user) == -1)
		return false;
	games[gameid].players = _.without(games[gameid].players, user);
	global.client.send(games[gameid].settings.channel, user + " left the game.");
}

function game_get_players(gameid)
{
	return games[gameid].players;
}

/* "internal" game functions */

function _format_card(card, values)
{
	if(!values)
		return card.text.replace(/%s/g, client.format.bold + "____" + client.format.reset);
	else
		return util.format(card.text, values)
}

function _start_game(gameid)
{
	global.client.send(games[gameid].settings.channel, util.format(
		"Starting %s with '%s' cards: %s",
		games[gameid].settings.plimit > 0 ? util.format("game until %d points", games[gameid].settings.plimit) : "infinite game",
		games[gameid].settings.coll,
		cards.collectionInfo(games[gameid].settings.coll)
	));
	_round(gameid);
}

function _round(gameid)
{
	global.client.send(games[gameid].settings.channel, util.format(
		"Round %d! %s is the card czar.",
		games[gameid].round_no,
		games[gameid].players[games[gameid].czar_idx]
	));
	games[gameid].q_card = cards.randomQuestionCard(games[gameid].settings.coll);
	global.client.send(games[gameid].settings.channel, client.format.bold + "CARD: " + client.format.reset + _format_card(games[gameid].q_card));
}

/* timers */

function timer_start(gameid) {
	games[gameid].timer_start = null;
	if(games[gameid].players.length < 3) {
		global.client.send(games[gameid].settings.channel, "Not enough players to play (need at least 3). Stopping in 3 minutes if not enough players.");
		games[gameid].timer_stop = setTimeout(function() { timer_stop(gameid); }, NOT_ENOUGH_PLAYERS_WAIT_MINS * 60 * 1000);
	} else {
		_start_game(gameid);
	}
}

function timer_stop(gameid) {
	games[gameid].timer_stop = null;
	if(games[gameid].players.length < 3) {
		stop_game(gameid);
	} else {
		_start_game(gameid);
	}
}

/* commands */

function cmd_start(evt, args) {
	if(games[evt.channel]) {
		evt.reply("A game is already running.");
		return;
	}
	var settings = {};
	settings.plimit = global.config.default_point_limit;
	settings.coll = global.config.default_collection;
	settings.channel = evt.channel;
	settings.starter = evt.user;

	args = args ? args.split(" "): [];
	_.each(args, function(arg) {
		if(arg.match(/^\d+$/)) { // numeric arg -> point limit
			try {
				settings.plimit = parseInt(arg);
			} catch(e) {
				// *shrug*
			};
		} else { // string arg -> collection
			if(cards.collectionExists(arg))
				settings.coll = arg;
		}
	});

	start_game(evt.channel, settings);
	join_game(evt.channel, evt.user);
}

function cmd_stop(evt, args) {
	if(!games[evt.channel]) {
		evt.reply("No game running, start one with !start.");
		return;
	}
	stop_game(evt.channel);
}

function cmd_join(evt, args) {
	if(!games[evt.channel]) {
		evt.reply("No game running, start one with !start.");
		return;
	}
	join_game(evt.channel, evt.user);
}

function cmd_leave(evt, args) {
	if(!games[evt.channel])
		return;
	leave_game(evt.channel, evt.user);
}

function cmd_players(evt, args) {
	if(!games[evt.channel])
		return;
	evt.reply("Currently playing: " + game_get_players(evt.channel).join(", "));
}

exports.setup = function() {
	global.commands["start"] = cmd_start;
	global.commands["stop"] = cmd_stop;
	global.commands["join"] = cmd_join;
	global.commands["leave"] = cmd_leave;
	global.commands["players"] = cmd_players;

	cards.setup();
};
