var _ = require('underscore');
var util = require('util');

var cards = require('./cards.js');
var games = {};

// should this be in the config?
var INITIAL_WAIT_SECS = 30;
var NOT_ENOUGH_PLAYERS_WAIT_MINS = 2;
var ROUND_MAX_TIME_MINS = 4;
var SWAP_MIN_PLAYERS = 5;

/* "external" game functions */

function start_game(gameid, settings) {
	games[gameid] = {};
	games[gameid].settings = settings;
	games[gameid].players = [];
	games[gameid].czar = null;
	games[gameid].cards = {};
	games[gameid].picks = {};
	games[gameid].hasPlayed = {}; // 1 -> player played, 2 -> player swapped, 3 -> player just joined and can't play, 4 -> didn't play cause other reason
	games[gameid].pick_order = []; // order in which answers were displayed to the czar
	games[gameid].timer_start = setTimeout(function() { timer_start(gameid); }, INITIAL_WAIT_SECS * 1000);
	games[gameid].timer_stop = null;
	games[gameid].timer_round = null;
	games[gameid].roundRunning = false;
	games[gameid].round_no = 0; // incremented to 1 in _round()
	games[gameid].q_card = null;
	games[gameid].round_stage = 0; // 0 -> waiting for players to play, 1 -> waiting for czar to pick winner
	games[gameid].points = {};

	global.client.send(settings.channel, util.format(
		"Starting a new game of %sCards Against Humanity%s. The game will start in %d seconds, type !join to join.",
		global.client.format.bold,
		global.client.format.bold,
		INITIAL_WAIT_SECS
	));
}

function stop_game(gameid, user) {
	if(user && games[gameid].settings.starter != user)
		return false;
	global.client.send(games[gameid].settings.channel, "Game stopped.");
	if(global.config.voice_players)
		ircDevoice(global.client, games[gameid].settings.channel, games[gameid].players);

	if(games[gameid].timer_start)
		clearTimeout(games[gameid].timer_start);
	if(games[gameid].timer_stop)
		clearTimeout(games[gameid].timer_stop);
	if(games[gameid].timer_round)
		clearTimeout(games[gameid].timer_round);
	games[gameid] = undefined;
	return true;
}

function join_game(gameid, user)
{
	if(_.indexOf(games[gameid].players, user) != -1)
		return;
	games[gameid].players.push(user);
	if(!games[gameid].points[user])
		games[gameid].points[user] = 0;
	games[gameid].hasPlayed[user] = 3;
	global.client.send(games[gameid].settings.channel, user + " joined the game.");
	if(global.config.voice_players)
		ircVoice(global.client, games[gameid].settings.channel, [user]);
	if(games[gameid].players.length >= 3 && !games[gameid].roundRunning) {
		_start_game(gameid);
	}
}

function leave_game(gameid, user)
{
	if(_.indexOf(games[gameid].players, user) == -1)
		return;
	global.client.send(games[gameid].settings.channel, user + " left the game.");
	if(global.config.voice_players)
		ircDevoice(global.client, games[gameid].settings.channel, [user]);
	games[gameid].players = _.without(games[gameid].players, user);
	if(!_check_players(gameid, user))
		return;
	if(games[gameid].roundRunning) {
		// Abort the round if the czar left, otherwise check whether everyone has played
		//  (now that a person has left)
		if(user == games[gameid].czar) {
			clearTimeout(games[gameid].timer_round);
			global.client.send(games[gameid].settings.channel, "Looks like the czar left, nobody wins this round.");
			_round(gameid);
		} else {
			_check_all_played(gameid);
		}
	}
}

function game_get_players(gameid)
{
	return games[gameid].players;
}

function game_notice_cards(gameid, user)
{
	if(!games[gameid].roundRunning)
		return;
	if(_.indexOf(games[gameid].players, user) == -1)
		return;
	if(user == games[gameid].czar)
		return;
	_notice_cards(gameid, user);
}

function game_show_status(gameid)
{
	if(!games[gameid].roundRunning)
	{
		global.client.send(games[gameid].settings.channel, util.format(
			"%sStatus:%s No round running.",
			global.client.format.bold,
			global.client.format.bold
		));
		return;
	} else if(games[gameid].round_stage == 1) {
		global.client.send(games[gameid].settings.channel, util.format(
			"%sStatus:%s Waiting for %s to pick a winner.",
			global.client.format.bold,
			global.client.format.bold,
			games[gameid].czar
		));
		return;
	}
	var tmp = games[gameid].players;

	_.each(games[gameid].hasPlayed, function(_trash, player) {
		tmp = _.without(tmp, player);
	});
	tmp = _.without(tmp, games[gameid].czar);

	global.client.send(games[gameid].settings.channel, util.format(
		"%sStatus:%s %s is the card czar. Waiting for players to play: %s",
		global.client.format.bold,
		global.client.format.bold,
		games[gameid].czar,
		tmp.join(", ")
	));
}

function game_pick(gameid, user, cards)
{
	if(!games[gameid].roundRunning)
		return;
	if(_.indexOf(games[gameid].players, user) == -1)
		return;
	if(user == games[gameid].czar) {
		if(games[gameid].round_stage == 0) {
			global.client.send(games[gameid].settings.channel, util.format("%s: The czar does not play (yet).", user));
		} else {
			var winner;

			if(cards.length != 1) {
				global.client.send(games[gameid].settings.channel, "You need to select a winner.");
				return;
			}
			if(cards[0] < 1 || cards[0] > games[gameid].pick_order.length) {
				global.client.send(games[gameid].settings.channel, "Invalid winner.");
				return;
			}
			winner = games[gameid].pick_order[cards[0] - 1];
			global.client.send(games[gameid].settings.channel, util.format(
				"%sWinner is:%s %s with \"%s\", gets one awesome point and has %d awesome points!",
				global.client.format.bold,
				global.client.format.bold,
				winner,
				_format_card(games[gameid].q_card, games[gameid].picks[winner]),
				++games[gameid].points[winner]
			));
			games[gameid].roundRunning = false;
			clearTimeout(games[gameid].timer_round);
			if(_check_plimit(gameid))
				return; // Game ended
			_round(gameid);
		}
	} else {
		if(games[gameid].round_stage == 1)
			return;
		if(games[gameid].hasPlayed[user] == 1)
			return global.client.send(games[gameid].settings.channel, "You already picked this round.");
		else if(games[gameid].hasPlayed[user] == 2)
			return global.client.send(games[gameid].settings.channel, "You swapped this round and can't play.");
		else if(games[gameid].hasPlayed[user] == 3)
			return global.client.send(games[gameid].settings.channel, "You joined this round, you'll get to play next round.");
		else if(games[gameid].hasPlayed[user] == 4)
			return global.client.send(games[gameid].settings.channel, "You can't play this round.");
		if(cards.length != games[gameid].q_card.pick)
			return global.client.send(games[gameid].settings.channel, util.format("You need to pick %d cards.", games[gameid].q_card.pick));
		if(cards.length != _.uniq(cards).length)
			return global.client.send(games[gameid].settings.channel, "You can't pick a card more than once.");
		if(_.min(cards) < 1 || _.max(cards) > 10)
			return global.client.send(games[gameid].settings.channel, "Invalid cards selected.");
		cards = _.map(cards, function(n) { return n - 1; });
		var pick = [];
		_.each(cards, function(card_idx) {
			pick.push(games[gameid].cards[user][card_idx]);
		});
		games[gameid].hasPlayed[user] = 1;
		games[gameid].picks[user] = pick;
		games[gameid].cards[user] = removeByIndex(games[gameid].cards[user], cards);
		global.client.notice(user, util.format("You played: %s", _format_card(games[gameid].q_card, pick)));
		_check_all_played(gameid);
	}
}

function game_show_points(gameid)
{
	var tmp;
	var out = "";
	var prev_pts = -1;

	tmp = _.map(games[gameid].points, function(pts, pl) {
		return {name: pl, points: pts};
	});
	tmp = _.sortBy(tmp, function(a) {
		return -a.points;
	});
	_.each(tmp, function(o) {
		if(prev_pts != o.points) {
			if(prev_pts != -1) {
				out = out.slice(0, -2);
				out += " (" + prev_pts + " awesome points); ";
			}
			prev_pts = o.points;
		}
		out += o.name + ", ";
	});
	out = out.slice(0, -2) + " (" + prev_pts + " awesome points)";
	global.client.send(games[gameid].settings.channel, utils.format("The point limit is %s%d%sThe most horrible people: %s", client.format.bold, games[gameid].settings.plimit, client.format.bold, out));
}

function game_swap_cards(gameid, user) {
	if(!games[gameid].roundRunning)
		return;
	if(_.indexOf(games[gameid].players, user) == -1)
		return;
	if(user == games[gameid].czar) {
		return global.client.send(games[gameid].settings.channel, util.format("%s: You can't swap your cards because you're the card czar.", user));
	} else if(games[gameid].players.length < SWAP_MIN_PLAYERS) {
		return global.client.send(games[gameid].settings.channel, util.format("%s: There must be at least %d players to use !swap.", user, SWAP_MIN_PLAYERS));
	} else if(games[gameid].hasPlayed[user]) {
		var tmp;
		if(games[gameid].hasPlayed[user] == 1)
			tmp = "already picked";
		else if(games[gameid].hasPlayed[user] == 2)
			tmp = "already swapped";
		else if(games[gameid].hasPlayed[user] == 3)
			tmp = "just joined";
		else if(games[gameid].hasPlayed[user] == 4)
			tmp = "can't play";
		return global.client.send(games[gameid].settings.channel, util.format("%s: You %s this round.", user, tmp));
	} else if(games[gameid].points[user] == 0) {
		return global.client.send(games[gameid].settings.channel, util.format("%s: You need at least one awesome point to use !swap.", user));
	}
	// Remove cards from the player and give them new ones.
	games[gameid].hasPlayed[user] = 2;
	games[gameid].cards[user] = [];
	_refill_cards(gameid, user);
	_notice_cards(gameid, user);
	global.client.send(games[gameid].settings.channel, util.format(
		"%s swapped all of their cards. They don't play this round and lose a point. %s now has %d awesome points.",
		user,
		user,
		--games[gameid].points[user]
	));
	_check_all_played(gameid);
}

function game_force_pass(gameid, user)
{
	if(!games[gameid].roundRunning)
		return;
	if(_.indexOf(games[gameid].players, user) == -1)
		return;
	if(user == games[gameid].czar)
		return;

	games[gameid].hasPlayed[user] = 4;
	_check_all_played(gameid);
}

function game_force_leave(gameid, user)
{
	leave_game(gameid, user);
}

/* "internal" game functions */

function _format_card(card, values)
{
	if(!values) {
		return card.text.replace(/%s/g, client.format.bold + "____" + client.format.bold);
	} else {
		var vals = _.map(values, function(text) {
			return global.client.format.bold + text + global.client.format.bold;
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
	if(games[gameid].timer_start)
		return true; // Don't complain about lack of users if initial period not elapsed yet
	if(games[gameid].timer_stop)
		return false; // Don't complain twice
	games[gameid].roundRunning = false;
	if(games[gameid].timer_round)
		clearTimeout(games[gameid].timer_round);
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
			if(pl == games[gameid].czar)
				return;
			_notice_cards(gameid, pl);
		});
	} else {
		if(_.indexOf(games[gameid].players, pl) == -1)
			return;
		var cards = [];
		_.each(games[gameid].cards[pl], function(card, i) {
			cards.push(util.format("%s[%d]%s %s", client.format.bold, i+1, client.format.bold, card));
		});
		if (cards.length > 0)
			global.client.notice(pl, "Your cards: " + cards.join(" "));
		else
			global.client.notice(pl, "You don't have any cards.");
	}
}


function _round(gameid)
{
	var tmp;

	games[gameid].round_no++;
	if(_.indexOf(games[gameid].players, games[gameid].czar) == -1)
		tmp = 0;
	else
		tmp = (_.indexOf(games[gameid].players, games[gameid].czar) + 1) % games[gameid].players.length;
	games[gameid].czar = games[gameid].players[tmp];
	games[gameid].round_stage = 0;
	games[gameid].hasPlayed = {};
	games[gameid].picks = {};

	global.client.send(games[gameid].settings.channel, util.format(
		"Round %d! %s is the card czar.",
		games[gameid].round_no,
		games[gameid].czar
	));
	games[gameid].q_card = cards.randomQuestionCard(games[gameid].settings.coll);
	global.client.send(games[gameid].settings.channel, client.format.bold + "CARD: " + client.format.bold + _format_card(games[gameid].q_card));
	_refill_cards(gameid);
	_notice_cards(gameid);
	games[gameid].roundRunning = true;
	games[gameid].timer_round = setTimeout(function() { timer_round(gameid, 0); }, (ROUND_MAX_TIME_MINS - 1) * 60 * 1000);
}

function _check_all_played(gameid)
{
	var tmp = games[gameid].players;

	_.each(games[gameid].hasPlayed, function(_trash, player) {
		tmp = _.without(tmp, player);
	});
	tmp = _.without(tmp, games[gameid].czar);

	if(tmp.length == 0) {
		var tmp = games[gameid].players;
		tmp = _.without(tmp, games[gameid].czar);
		_.each(games[gameid].hasPlayed, function(a, pl) {
			if(a == 2 || a == 3 || a == 4) { // player swapped or joined new
				tmp = _.without(tmp, pl);
			}
		});
		games[gameid].pick_order = _.shuffle(tmp);
		global.client.send(games[gameid].settings.channel, "Everyone has played. Here are the entries:");
		_.each(games[gameid].pick_order, function(player, i) {
			global.client.send(games[gameid].settings.channel, util.format(
				"%d: %s", i+1, _format_card(games[gameid].q_card, games[gameid].picks[player])
			));
		});
		games[gameid].round_stage = 1;
		global.client.send(games[gameid].settings.channel, util.format("%s: Select the winner using !pick", games[gameid].czar));
	}
}

function _check_plimit(gameid)
{
	if(games[gameid].settings.plimit <= 0)
		return false;
	var r = false;
	_.each(games[gameid].points, function(pts, pl) {
		if(!games[gameid])
			return; // if someone already won and the game was deleted, don't do anything
		if(pts == games[gameid].settings.plimit) {
			global.client.send(games[gameid].settings.channel, util.format(
				"%s reached the limit of %d awesome points and is the most horrible person around! Congratulations!",
				pl,
				games[gameid].settings.plimit
			));
			game_show_points(gameid);
			stop_game(gameid);
			r = true;
		}
	});
	return r;
}

function _refill_cards(gameid, pl)
{
	if(!pl) {
		_.each(games[gameid].players, function(pl) { _refill_cards(gameid, pl); });
		return;
	}
	if(!games[gameid].cards[pl])
		games[gameid].cards[pl] = [];
	while(games[gameid].cards[pl].length < 10)
		games[gameid].cards[pl].push(cards.randomAnswerCard(games[gameid].settings.coll));
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
			// Directly start a new round unless enough people have picked
			if(_.size(games[gameid].picks) >= 2) {
				_.each(games[gameid].players, function(pl) {
					if(games[gameid].picks[pl])
						return;
					games[gameid].hasPlayed[pl] = 4;
				});
				_check_all_played(gameid);
			} else {
				_round(gameid);
			}
			break;
	}
}

/* helper functions */

function parseIntEx(str) { // A better parseInt
	var n;

	if(!str.match(/^\d+$/))
		throw "not an int";
	n = parseInt(str);
	if(isNaN(n))
		throw "parseInt() failed.";
	return n;
}

function _ircModeStr(mode, nicks) {
	var modestr = mode.slice(0, 1);
	_.each(nicks, function() { modestr += mode.slice(1); });
	return modestr + " " + nicks.join(" ");
}

function ircVoice(client, channel, nicklist) {
	if(client.voice)
		return client.voice(channel, nicklist);
	var tmp = [];
	_.each(nicklist, function(nick) {
		tmp.push(nick);
		if(tmp.length == 4) {
			client.mode(channel, _ircModeStr("+v", tmp));
			tmp = [];
		}
	});
	if(tmp.length > 0)
		client.mode(channel, _ircModeStr("+v", tmp));
}

function ircDevoice(client, channel, nicklist) {
	if(client.devoice)
		return client.devoice(channel, nicklist);
	var tmp = [];
	_.each(nicklist, function(nick) {
		tmp.push(nick);
		if(tmp.length == 4) {
			client.mode(channel, _ircModeStr("-v", tmp));
			tmp = [];
		}
	});
	if(tmp.length > 0) {
		client.mode(channel, _ircModeStr("-v", tmp));
	}
}

function removeByIndex(array, idxlist)
{
	var out = [];
	_.each(array, function(elem, idx) {
		if(_.indexOf(idxlist, idx) == -1)
			out.push(elem);
	});
	return out;
}

/* commands */

function cmd_start(evt, args) {
	if(games[evt.channel])
		return evt.reply("A game is already running.");
	var settings = {};
	settings.plimit = global.config.default_point_limit;
	settings.coll = global.config.default_collection;
	settings.channel = evt.channel;
	settings.starter = evt.user;

	args = args ? args.split(" "): [];
	_.each(args, function(arg) {
		if(arg.match(/^\d+$/)) { // numeric arg -> point limit
			try {
				settings.plimit = parseIntEx(arg);
			} catch(e) {};
		} else { // string arg -> collection
			if(cards.collectionExists(arg))
				settings.coll = arg;
		}
	});

	start_game(evt.channel, settings);
	join_game(evt.channel, evt.user);
}

function cmd_stop(evt, args) {
	if(!games[evt.channel])
		return evt.reply("No game running, start one with !start.");
	if(evt.has_op) {
		stop_game(evt.channel); // not passing user stops the game unconditionally
	} else {
		if(!stop_game(evt.channel, evt.user)) {
			evt.reply("You can't stop the game.");
		}
	}
}

function cmd_join(evt, args) {
	if(!games[evt.channel])
		return evt.reply("No game running, start one with !start.");
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
			a.push(parseIntEx(arg));
		} catch(e) {};
	});
	game_pick(evt.channel, evt.user, a);
}

function cmd_points(evt, args) {
	if(!games[evt.channel])
		return;
	game_show_points(evt.channel);
}

function cmd_swap(evt, args) {
	if(!games[evt.channel])
		return;
	game_swap_cards(evt.channel, evt.user);
}

function cmd_fpass(evt, args) {
	if(!games[evt.channel])
		return;
	if(!evt.has_op)
		return;
	game_force_pass(evt.channel, args.trim());
}

function cmd_fleave(evt, args) {
	if(!games[evt.channel])
		return;
	if(!evt.has_op)
		return;
	game_force_leave(evt.channel, args.trim());
}


exports.setup = function() {
	// Normal commands
	global.commands["start"] = cmd_start;
	global.commands["stop"] = cmd_stop;
	global.commands["join"] = cmd_join;
	global.commands["leave"] = cmd_leave;
	global.commands["players"] = cmd_players;
	global.commands["cards"] = cmd_cards;
	global.commands["status"] = cmd_status;
	global.commands["pick"] = cmd_pick;
	global.commands["points"] = cmd_points;
	global.commands["swap"] = cmd_swap;
	// Aliase
	global.commands["s"] = cmd_start;
	global.commands["j"] = cmd_join;
	global.commands["l"] = cmd_leave;
	global.commands["p"] = cmd_pick;
	global.commands["pts"] = cmd_points;
	// Admin commands
	global.commands["fpass"] = cmd_fpass;
	global.commands["fleave"] = cmd_fleave;

	cards.setup();
};
