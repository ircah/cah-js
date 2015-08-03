var _ = require('underscore');
var util = require('util');

var cards = require('./cards.js');
var games = {};

// should this be in the config?
var INITIAL_WAIT_SECS = 60;
var NOT_ENOUGH_PLAYERS_WAIT_MINS = 2;
var ROUND_MAX_TIME_MINS = 4;
var ROUND_TIMEOUT_CZAR_TIME_MINS = 2; // how many minutes the czar gets after "Time's up." happens and the round is forced into the "czar select winner" stage
var SWAP_MIN_PLAYERS = 5;

/* "external" game functions */

function start_game(gameid, settings) {
	games[gameid] = {};
	games[gameid].settings = settings;
	games[gameid].players = [];
	games[gameid].czar = null;
	games[gameid].cards = {};
	games[gameid].picks = {};
	games[gameid].pickIds = {};
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
	games[gameid].last_round = -1; // if game reaches this round no, it will end

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
	if(games[gameid].points[user] === undefined)
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
		prettyList(tmp)
	));
}

function game_pick(gameid, user, cards)
{
	if(!games[gameid].roundRunning)
		return;
	if(_.indexOf(games[gameid].players, user) == -1)
		return;
	if(user == games[gameid].czar) {
		if(games[gameid].round_stage === 0)
			return global.client.send(games[gameid].settings.channel, util.format("%s: The czar does not play yet.", user));
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
	} else {
		if(games[gameid].round_stage == 1)
			return;
		else if(games[gameid].hasPlayed[user] > 1) {
			var err;
			if(games[gameid].hasPlayed[user] == 2)
				err = "swapped cards";
			else if(games[gameid].hasPlayed[user] == 3)
				err = "just joined";
			else if(games[gameid].hasPlayed[user] == 4)  // fpassed
				err = "can't play";
			return global.client.send(games[gameid].settings.channel, util.format("%s: You %s this round.", user, err));
		}
		if(cards.length != games[gameid].q_card.pick)
			return global.client.send(games[gameid].settings.channel, util.format("You need to pick %d cards.", games[gameid].q_card.pick));
		if(cards.length != _.uniq(cards).length)
			return global.client.send(games[gameid].settings.channel, "You can't pick a card more than once.");
		if(_.min(cards) < 1 || _.max(cards) > games[gameid].cards[user].length)
			return global.client.send(games[gameid].settings.channel, "Invalid cards selected.");
		cards = _.map(cards, function(n) { return n - 1; });
		var pick = [];
		_.each(cards, function(card_idx) {
			pick.push(games[gameid].cards[user][card_idx]);
		});
		games[gameid].hasPlayed[user] = 1;
		games[gameid].pickIds[user] = cards;
		games[gameid].picks[user] = pick;
		global.client.notice(user, util.format("You played: %s", _format_card(games[gameid].q_card, pick)));
		_check_all_played(gameid);
	}
}

function game_retract(gameid, user) {
	if (!games[gameid].roundRunning)
		return;
	if(_.indexOf(games[gameid].players, user) == -1)
		return;
	if(user == games[gameid].czar)
		return;
	if(games[gameid].round_stage == 1)
		return;
	if(!games[gameid].hasPlayed[user])
		return;

	if(games[gameid].hasPlayed[user] > 1) {
		var err;
		if(games[gameid].hasPlayed[user] == 2)
			err = "swapped cards";
		else if(games[gameid].hasPlayed[user] == 3)
			err = "just joined";
		else if(games[gameid].hasPlayed[user] == 4)
			err = "can't play";
		return global.client.send(games[gameid].settings.channel, util.format("%s: You %s this round.", user, err));
	}

	delete games[gameid].hasPlayed[user];

	global.client.notice(user, "You have retracted your pick.");
}

function game_show_points(gameid, show_all)
{
	var tmp, tmp2 = [];
	var out = "";
	var prev_pts = -1;

	if(show_all) {
		tmp = games[gameid].points;
	} else {
		tmp = {};
		_.each(games[gameid].points, function(_trash, player) {
			if(_.indexOf(games[gameid].players, player) != -1)
				tmp[player] = games[gameid].points[player];
		});
	}
	tmp = _.map(tmp, function(pts, pl) {
		return {name: pl, points: pts};
	});
	tmp = _.sortBy(tmp, function(a) {
		return -a.points;
	});

	_.each(tmp, function(o) {
		if(prev_pts != o.points) {
			if(prev_pts != -1) {
				out += util.format("%s (%d awesome points); ", prettyList(tmp2), prev_pts);
				tmp2 = [];
			}
			prev_pts = o.points;
		}
		tmp2.push(o.name);
	});
	out += util.format("%s (%d awesome points)", prettyList(tmp2), prev_pts);

	global.client.send(games[gameid].settings.channel, util.format(
		"Point limit is %s%d%s. The most horrible people: %s",
		global.client.format.bold,
		games[gameid].settings.plimit,
		global.client.format.bold,
		out
	));
}

function game_swap_cards(gameid, user) {
	if(!games[gameid].roundRunning)
		return;
	if(_.indexOf(games[gameid].players, user) == -1)
		return;
	if(games[gameid].round_stage == 1)
		return;
	if(user == games[gameid].czar) {
		return global.client.send(games[gameid].settings.channel, util.format("%s: The card czar can't swap cards.", user));
	} else if(games[gameid].players.length < SWAP_MIN_PLAYERS) {
		return global.client.send(games[gameid].settings.channel, util.format("%s: There must be at least %d players to use !swap.", user, SWAP_MIN_PLAYERS));
	} else if(games[gameid].hasPlayed[user] > 1) {
		var tmp;
		if(games[gameid].hasPlayed[user] == 2)
			tmp = "already swapped cards";
		else if(games[gameid].hasPlayed[user] == 3)
			tmp = "just joined";
		else if(games[gameid].hasPlayed[user] == 4)
			tmp = "can't play";
		return global.client.send(games[gameid].settings.channel, util.format("%s: You %s this round.", user, tmp));
	} else if(games[gameid].points[user] === 0) {
		return global.client.send(games[gameid].settings.channel, util.format("%s: You need at least one awesome point to use !swap.", user));
	}
	// Remove cards from the player and give them new ones
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

function game_force_limit(gameid, limit)
{
	var high_pts, low_limit;

	high_pts = _.max(games[gameid].points);
	low_limit = high_pts + 1; // Lowest possible point limit

	if(limit === 0) {
		games[gameid].settings.plimit = limit;
		return global.client.send(games[gameid].settings.channel, "The point limit is now infinite.");
	} else if(limit < low_limit) {
		return global.client.send(
			games[gameid].settings.channel,
			util.format("The lowest point limit you can set this game to is %d. If you want to make the game infinite, set it to 0.", low_limit)
		);
	} else {
		games[gameid].settings.plimit = limit;
		return global.client.send(games[gameid].settings.channel, util.format("The point limit is now %d.", limit));
	}
}

function game_last_round(gameid, round_no)
{
	if(round_no !== null && round_no !== undefined)
		games[gameid].last_round = round_no;
	else
		games[gameid].last_round = games[gameid].round_no;

	global.client.send(games[gameid].settings.channel, util.format("The game will stop at the end of round %d.", games[gameid].last_round));
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
			return card.text + " " + prettyList(vals);
		else
			return util.format.apply(this, _.flatten([card.text, vals]));
	}
}

function _format_card_opts(card, values)
{
	if(card.pick === 2) {
		return util.format(
			"%s[PICK %d]%s",
			global.client.format.bold,
			card.pick,
			global.client.format.bold
		);
	} else if(card.pick > 2) {
		return util.format(
			"%s[PICK %d] [DRAW %d]%s",
			global.client.format.bold,
			card.pick,
			card.pick - 1,
			global.client.format.bold
		);
	} else {
		return "";
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
		games[gameid].settings.plimit > 0 ? util.format("a game till %d points", games[gameid].settings.plimit) : "an infinite game",
		games[gameid].settings.coll,
		cards.collectionInfo(games[gameid].settings.coll)
	));
	_round(gameid);
}

function _split_card_list(cards) {
	var lines, curLine, len;

	lines = [];
	curLine = ["Your cards:"];

	while (cards.length > 0) {
		if ((curLine.concat(cards[0]).join(" ")).length <= 380) {
			curLine.push(cards.shift());
		} else {
			lines.push(curLine.join(" "));
			curLine = [];
		}
	}

	if (curLine) {
		lines.push(curLine.join(" "));
	}

	return lines;
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
		if(cards.length > 0)
			_.each(_split_card_list(cards), function (line) {
				global.client.notice(pl, line);
			});
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
	global.client.send(games[gameid].settings.channel, util.format(
		"%sCARD:%s %s %s",
		global.client.format.bold,
		global.client.format.bold,
		_format_card(games[gameid].q_card),
		_format_card_opts(games[gameid].q_card)
	));
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

	if(tmp.length === 0) {
		tmp = games[gameid].players;
		tmp = _.without(tmp, games[gameid].czar);
		_.each(games[gameid].hasPlayed, function(a, pl) {
			if(a == 2 || a == 3 || a == 4) { // player swapped, joined new or can't play (other reason)
				tmp = _.without(tmp, pl);
			}
		});

		_.each(tmp, function(user) {
			games[gameid].cards[user] = removeByIndex(games[gameid].cards[user], games[gameid].pickIds[user]);
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
	if(games[gameid].last_round == games[gameid].round_no) {
		var won = [], tmp;

		// Find out highest score and collect all players with that score
		tmp = _.max(games[gameid].points);
		_.each(games[gameid].points, function(pts, pl) {
			if(pts == tmp) {
				won.push(pl);
			}
		});

		if(won.length == 1)
			tmp = util.format("%s was the winner with %d points", won[0], tmp);
		else
			tmp = util.format("%s were the winners with %d points each", prettyList(tmp), tmp);
		global.client.send(games[gameid].settings.channel, util.format(
			"Sorry to ruin the fun, but that was the last round of the game! %s!",
			tmp
		));

		game_show_points(gameid, true);
		return stop_game(gameid);
	}
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
			game_show_points(gameid, true);
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

	var draw = 10;

	if(games[gameid].q_card.pick > 2) {
		draw = draw + (games[gameid].q_card.pick - 1);
	}

	if(!games[gameid].cards[pl])
		games[gameid].cards[pl] = [];
	while(games[gameid].cards[pl].length < draw)
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
			if(_.size(games[gameid].picks) >= 2 && games[gameid].round_stage == 0) {
				_.each(games[gameid].players, function(pl) {
					if(games[gameid].picks[pl])
						return;
					games[gameid].hasPlayed[pl] = 4;
				});
				_check_all_played(gameid);
				games[gameid].timer_round = setTimeout(function() { timer_round(gameid, 0); }, (ROUND_TIMEOUT_CZAR_TIME_MINS - 1) * 60 * 1000);
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

function prettyList(array) {
	var ret = "";

	if(array.length === 1) {
		return array[0];
	} else {
		for (var i = 0; i < array.length; i++) {
			ret = ret + array[i];

			if(i + 2 === array.length) { // second to last option in the array
				ret = ret + " and ";
			} else if(i < array.length && i + 1 !== array.length) { // anywhere in the array EXCEPT the end of the array
				ret = ret + ", ";
			} else { // end of the array
				continue;
			}
		}
	}

	return ret;
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
			} catch(e) {}
		} else { // string arg -> collection
			if(cards.collectionExists(arg))
				settings.coll = arg;
		}
	});

	if(!evt.has_op && settings.plimit > global.config.max_point_limit) {
		return evt.reply(util.format("Only admins can start games with a point limit over %d.", global.config.max_point_limit));
	} else if(!evt.has_op && settings.plimit <= 0) {
		return evt.reply("Only admins can start unlimited games.");
	}

	start_game(evt.channel, settings);
	join_game(evt.channel, evt.user);
}

function cmd_stop(evt, args) {
	if(!games[evt.channel])
		return evt.reply("No game running, start one with !start.");
	if(evt.has_op) {
		stop_game(evt.channel); // not passing user stops the game unconditionally
	} else {
		if(!stop_game(evt.channel, evt.user))
			evt.reply("You can't stop the game.");
	}
}

function cmd_join(evt, args) {
	if(!games[evt.channel]) {
		cmd_start(evt, args);
		if(!games[evt.channel]) // Abort if game was not started for some reason
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
	evt.reply("Currently playing: " + prettyList(game_get_players(evt.channel)));
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
	if(args === undefined)
		return;
	var a = [];

	args = args.split(" ");
	_.each(args, function(arg) {
		try {
			a.push(parseIntEx(arg));
		} catch(e) {}
	});
	game_pick(evt.channel, evt.user, a);
}

function cmd_retract(evt, args) {
	if(!games[evt.channel])
		return;
	game_retract(evt.channel, evt.user);
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

function cmd_flimit(evt, args) {
	if(!games[evt.channel])
		return;
	if(!evt.has_op)
		return;
	if(args === undefined)
		return evt.reply("No limit specified");

	var num = args.trim().split(" ")[0].trim();

	try {
		num = parseIntEx(num);
	} catch(e) {
		return evt.reply("Invalid argument");
	}

	game_force_limit(evt.channel, num);
}

function cmd_flastround(evt, args) {
	if(!games[evt.channel])
		return;
	if(!evt.has_op)
		return;
	if(args === undefined)
		return game_last_round(evt.channel, null);

	var num = args.trim().split(" ")[0].trim();

	try {
		num = parseIntEx(num);
	} catch(e) {
		return evt.reply("Invalid argument");
	}

	game_last_round(evt.channel, num);
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
	global.commands.start = cmd_start;
	global.commands.stop = cmd_stop;
	global.commands.join = cmd_join;
	global.commands.leave = cmd_leave;
	global.commands.players = cmd_players;
	global.commands.cards = cmd_cards;
	global.commands.status = cmd_status;
	global.commands.pick = cmd_pick;
	global.commands.retract = cmd_retract;
	global.commands.points = cmd_points;
	global.commands.swap = cmd_swap;
	// Aliases
	global.commands.s = cmd_start;
	global.commands.j = cmd_join;
	global.commands.l = cmd_leave;
	global.commands.q = cmd_leave;
	global.commands.quit = cmd_leave;
	global.commands.p = cmd_pick;
	global.commands.r = cmd_retract;
	global.commands.pts = cmd_points;
	// Admin commands
	global.commands.flimit = cmd_flimit;
	global.commands.fpass = cmd_fpass;
	global.commands.flastround = cmd_flastround;
	global.commands.fleave = cmd_fleave;

	cards.setup();
};
