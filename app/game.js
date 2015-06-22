var _ = require('underscore');
var util = require('util');

var cards = require('./cards.js');
var games = {};

// should this be in the config?
var INITIAL_WAIT_SECS = 30;
var NOT_ENOUGH_PLAYERS_WAIT_MINS = 2;
var ROUND_MAX_TIME_MINS = 4;

/* "external" game functions */

function start_game(gameid, settings) {
	games[gameid] = {};
	games[gameid].settings = settings;
	games[gameid].players = [];
	games[gameid].cards = {};
	games[gameid].picks = {};
	games[gameid].pick_order = [];
	games[gameid].timer_start = setTimeout(function() { timer_start(gameid); }, INITIAL_WAIT_SECS * 1000);
	games[gameid].timer_stop = null;
	games[gameid].timer_round = null;
	games[gameid].round_no = 0; // incremented to 1 in _round()
	games[gameid].czar_idx = -1;
	games[gameid].q_card = null;
	games[gameid].round_stage = 0; // 0 -> waiting for players to play, 1 -> waiting for czar to pick winner

	global.client.send(settings.channel, util.format("Starting a new game of Cards Against Humanity. The game will start in %d seconds, type !join to join.", INITIAL_WAIT_SECS));
}

function stop_game(gameid, user) {
	if(user && games[gameid].settings.starter != user)
		return;
	global.client.send(games[gameid].settings.channel, "Game stopped.");

	if(games[gameid].timer_start)
		clearTimeout(games[gameid].timer_start);
	if(games[gameid].timer_stop)
		clearTimeout(games[gameid].timer_stop);
	if(games[gameid].timer_round)
		clearTimeout(games[gameid].timer_round);
	games[gameid] = undefined;
}

function join_game(gameid, user)
{
	if(_.indexOf(games[gameid].players, user) != -1)
		return;
	games[gameid].players.push(user);
	global.client.send(games[gameid].settings.channel, user + " joined the game.");
	if(games[gameid].players.length >= 3 && !games[gameid].timer_round) {
		_start_game(gameid);
	}
}

function leave_game(gameid, user)
{
	if(_.indexOf(games[gameid].players, user) == -1)
		return;
	global.client.send(games[gameid].settings.channel, user + " left the game.");
	if(games[gameid].timer_round && _.indexOf(games[gameid].players, user) == games[gameid].czar_idx) {
		clearTimeout(games[gameid].timer_round);
		global.client.send(games[gameid].settings.channel, "Looks like the czar left, nobody wins this round.");
		_round(gameid);
	}
	games[gameid].players = _.without(games[gameid].players, user);
	_check_players(gameid, user);
}

function game_get_players(gameid)
{
	return games[gameid].players;
}

function game_notice_cards(gameid, user)
{
	if(_.indexOf(games[gameid].players, user) == -1)
		return;
	if(_.indexOf(games[gameid].players, user) == games[gameid].czar_idx)
		return;
	_notice_cards(gameid, user);
}

function game_show_status(gameid)
{
	if(games[gameid].round_stage == 1) {
		global.client.send(games[gameid].settings.channel, util.format(
			"%sStatus:%s Waiting for %s to pick a winner.",
			global.client.format.bold,
			global.client.format.reset,
			games[gameid].players[games[gameid].czar_idx]
		));
		return;
	}
	var tmp = games[gameid].players;

	_.each(games[gameid].picks, function(_trash, player) {
		tmp = _.without(tmp, player);
	});
	tmp = _.without(tmp, games[gameid].players[games[gameid].czar_idx]);

	global.client.send(games[gameid].settings.channel, util.format(
		"%sStatus:%s %s is the card czar. Waiting for players to play: %s",
		global.client.format.bold,
		global.client.format.reset,
		games[gameid].players[games[gameid].czar_idx],
		tmp.join(", ")
	));
}

function game_pick(gameid, user, cards)
{
	if(_.indexOf(games[gameid].players, user) == -1)
		return;
	if(_.indexOf(games[gameid].players, user) == games[gameid].czar_idx) {
		if(games[gameid].round_stage == 0) {
			global.client.send(games[gameid].settings.channel, util.format("%s: The czar does not play (yet).", user));
		} else {
			var winner;

			if(cards.length != 1) {
				global.client.send(games[gameid].settings.channel, "You need to select a winner.");
				return;
			}
			if(cards[0] - 1 < 0 || cards[0] - 1 > _.size(games[gameid].picks)) {
				global.client.send(games[gameid].settings.channel, "Invalid winner.");
				return;
			}
			winner = games[gameid].pick_order[cards[0] - 1];
			global.client.send(games[gameid].settings.channel, util.format(
				"%sWinner is:%s %s with \"%s\" and gets one awesome point... oh wait, points are not implemented yet :(",
				global.client.format.bold,
				global.client.format.reset,
				winner,
				_format_card(games[gameid].q_card, games[gameid].picks[winner])
			));
			_round(gameid);
		}
	} else {
		if(games[gameid].round_stage == 1)
			return;
		if(games[gameid].picks[user]) {
			global.client.send(games[gameid].settings.channel, "You already picked this round.");
			return;
		}
		if(cards.length != games[gameid].q_card.pick) {
			global.client.send(games[gameid].settings.channel, util.format("You need to pick %d cards.", games[gameid].q_card.pick));
			return;
		}
		if(cards.length != _.uniq(cards).length) {
			global.client.send(games[gameid].settings.channel, "You can't use a card more than once.");
			return;
		}
		var pick = [];
		_.each(cards, function(card_idx) {
			try {
				pick.push(games[gameid].cards[user][card_idx - 1]);
			} catch(e) {
				global.client.send(games[gameid].settings.channel, "Invalid cards.");
				return;
			};
		});
		games[gameid].picks[user] = pick;
		_.each(cards, function(card_idx) {
			games[gameid].cards[user] = _.without(games[gameid].cards[user], games[gameid].cards[user][card_idx - 1]);
		});
		global.client.notice(user, util.format("You played: %s", _format_card(games[gameid].q_card, pick)));
		_check_all_played(gameid);
	}
}

/* "internal" game functions */

function _format_card(card, values)
{
	if(!values) {
		return card.text.replace(/%s/g, client.format.bold + "____" + client.format.reset);
	} else {
		var vals = _.map(values, function(text) {
			return global.client.format.bold + text + global.client.format.reset;
		});
		if(card.text.indexOf("%s") == -1)
			return card.text + " " + vals.join(" ");
		else
			return util.format.apply(this, _.flatten([card.text, vals]));
	}
}

function _check_players(gameid)
{
	if(games[gameid].players.length >= 3)
		return true;
	global.client.send(games[gameid].settings.channel, util.format("Not enough players to play (need at least 3). Stopping in %d minutes if not enough players.", NOT_ENOUGH_PLAYERS_WAIT_MINS));
	games[gameid].timer_stop = setTimeout(function() { timer_stop(gameid); }, NOT_ENOUGH_PLAYERS_WAIT_MINS * 60 * 1000);
	return false;
}

function _start_game(gameid)
{
	if(games[gameid].timer_start) {
		clearTimeout(games[gameid].timer_start);
		games[gameid].timer_start = null;
	}
	if(games[gameid].timer_stop) {
		clearTimeout(games[gameid].timer_stop);
		games[gameid].timer_stop = null;
	}
	global.client.send(games[gameid].settings.channel, util.format(
		"Starting %s with '%s' cards: %s",
		games[gameid].settings.plimit > 0 ? util.format("game till %d points", games[gameid].settings.plimit) : "infinite game",
		games[gameid].settings.coll,
		cards.collectionInfo(games[gameid].settings.coll)
	));
	_round(gameid);
}

function _notice_cards(gameid, pl)
{
	if(!pl) {
		_.each(games[gameid].players, function(pl) {
			if(_.indexOf(games[gameid].players, pl) == games[gameid].czar_idx)
				return;
			_notice_cards(gameid, pl);
		});
	} else {
		if(_.indexOf(games[gameid].players, pl) == -1)
			return;
		var cards = [];
		_.each(games[gameid].cards[pl], function(card, i) {
			cards.push(util.format("%s[%d]%s %s", client.format.bold, i+1, client.format.reset, card));
		});
		global.client.notice(pl, "Your cards: " + cards.join(" "));
	}
}


function _round(gameid)
{
	games[gameid].round_no++;
	games[gameid].czar_idx = (games[gameid].czar_idx + 1) % games[gameid].players.length;
	games[gameid].round_stage = 0;
	games[gameid].picks = {};


	global.client.send(games[gameid].settings.channel, util.format(
		"Round %d! %s is the card czar.",
		games[gameid].round_no,
		games[gameid].players[games[gameid].czar_idx]
	));
	games[gameid].q_card = cards.randomQuestionCard(games[gameid].settings.coll);
	global.client.send(games[gameid].settings.channel, client.format.bold + "CARD: " + client.format.reset + _format_card(games[gameid].q_card));
	_.each(games[gameid].players, function(pl) {
		if(!games[gameid].cards[pl])
			games[gameid].cards[pl] = [];
		while(games[gameid].cards[pl].length < 10)
			games[gameid].cards[pl].push(cards.randomAnswerCard(games[gameid].settings.coll));
	});
	_notice_cards(gameid);
	games[gameid].timer_round = setTimeout(function() { timer_round(gameid, 0); }, (ROUND_MAX_TIME_MINS - 1) * 60 * 1000);
}

function _check_all_played(gameid)
{
	var tmp = games[gameid].players;

	_.each(games[gameid].picks, function(_trash, player) {
		tmp = _.without(tmp, player);
	});
	tmp = _.without(tmp, games[gameid].players[games[gameid].czar_idx]);

	if(tmp.length == 0) {
		games[gameid].pick_order = _.shuffle(_.without(games[gameid].players, games[gameid].players[games[gameid].czar_idx]));
		global.client.send(games[gameid].settings.channel, "Everyone has played. Here are the entries:");
		_.each(games[gameid].pick_order, function(player, i) {
			global.client.send(games[gameid].settings.channel, util.format(
				"%d: %s", i+1, _format_card(games[gameid].q_card, games[gameid].picks[player])
			));
		});
		games[gameid].round_stage = 1;
		global.client.send(games[gameid].settings.channel, util.format("%s, pick the winner using !pick", games[gameid].players[games[gameid].czar_idx]));
	}
}

/* timers */

function timer_start(gameid) {
	games[gameid].timer_start = null;
	if(_check_players(gameid))
		_start_game(gameid);
}

function timer_stop(gameid) {
	games[gameid].timer_stop = null;
	if(games[gameid].players.length < 3) {
		stop_game(gameid);
	} else {
		_start_game(gameid);
	}
}

function timer_round(gameid, n) {
	games[gameid].timer_round = null;
	switch(n) {
		case 0:
			global.client.send(games[gameid].settings.channel, "Hurry up! 1 minute left.");
			game_show_status(gameid);
			games[gameid].timer_round = setTimeout(function() { timer_round(gameid, 1); }, 30 * 1000);
			break;
		case 1:
			global.client.send(games[gameid].settings.channel, "30 seconds left.");
			games[gameid].timer_round = setTimeout(function() { timer_round(gameid, 2); }, 20 * 1000);
			break;
		case 2:
			global.client.send(games[gameid].settings.channel, "10 seconds left.");
			games[gameid].timer_round = setTimeout(function() { timer_round(gameid, 3); }, 10 * 1000);
			break;
		case 3:
			global.client.send(games[gameid].settings.channel, "Time's up.");
			_round(gameid); // idk
			break;
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

function cmd_cards(evt, args) {
	if(!games[evt.channel])
		return;
	game_notice_cards(evt.channel, evt.user);
}

function cmd_status(evt, args) {
	if(!games[evt.channel])
		return;
	game_show_status(evt.channel);
}

function cmd_pick(evt, args) {
	if(!games[evt.channel])
		return;
	var a = [];

	args = args ? args.split(" "): [];
	_.each(args, function(arg) {
		try {
			a.push(parseInt(arg));
		} catch(e) {};
	});
	game_pick(evt.channel, evt.user, a);
}

exports.setup = function() {
	global.commands["start"] = cmd_start;
	global.commands["stop"] = cmd_stop;
	global.commands["join"] = cmd_join;
	global.commands["leave"] = cmd_leave;
	global.commands["players"] = cmd_players;
	global.commands["cards"] = cmd_cards;
	global.commands["status"] = cmd_status;
	global.commands["pick"] = cmd_pick;

	cards.setup();
};
