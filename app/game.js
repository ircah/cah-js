'use strict';
var _ = require('underscore');
var util = require('util');

var cards = require('./cards.js');
var CardPool = require('./cardpool.js').CardPool;
var Timer = require('./timer.js').Timer;
var games = {};

// should this be in the config?
var INITIAL_WAIT_SECS = 60;
var NOT_ENOUGH_PLAYERS_WAIT_MINS = 2;
var ROUND_MAX_PLAY_TIME_MINS = 2; // how many minutes the players get to pick
var ROUND_MAX_CZAR_TIME_MINS = 2; // how many minutes the czar gets to pick
var SWAP_MIN_PLAYERS = 5;


class Game {
	/* public methods */

	constructor(settings, on_stop) { // creating a game starts it
		this.settings = settings;
		this.players = [];
		this.czar = null;
		this.cardpool = new CardPool(settings.coll);
		this.cards = {};
		this.picks = {};
		this.pickIds = {};
		this.hasPlayed = {}; // 1 -> player played, 2 -> player swapped, 3 -> player just joined and can't play, 4 -> didn't play cause other reason
		this.pick_order = []; // order in which answers were displayed to the czar
		this.timer_start = new Timer(INITIAL_WAIT_SECS);
		this.timer_stop = new Timer(NOT_ENOUGH_PLAYERS_WAIT_MINS * 60);
		this.timer_round = // multi-purpose, must be started with .resumeFrom() instead of .start()
			new Timer(_.max([ROUND_MAX_PLAY_TIME_MINS, ROUND_MAX_CZAR_TIME_MINS]) * 60);
		this.roundRunning = false;
		this.round_no = 0; // incremented to 1 in _round()
		this.q_card = null;
		this.round_stage = 0; // 0 -> waiting for players to play, 1 -> waiting for czar to pick winner
		this.points = {};
		this.last_round = -1; // if game reaches this round no, it will end
		this.on_stop = on_stop; // called when game is stopped, can be used to manage global state

		this.timer_start.onElapsed(this._timer_start.bind(this));
		this.timer_stop.onElapsed(this._timer_stop.bind(this));
		this.timer_round.on(-60, this._timer_round_1min.bind(this));
		this.timer_round.on(-30, this._timer_round_30sec.bind(this));
		this.timer_round.on(-10, this._timer_round_10sec.bind(this));
		this.timer_round.onElapsed(this._timer_round_elapsed.bind(this));

		this.timer_start.start();
		global.client.send(settings.channel, util.format(
			"Starting a new game of %sCards Against Humanity%s. The game will start in %d seconds, type !join to join.",
			global.client.format.bold,
			global.client.format.bold,
			INITIAL_WAIT_SECS
		));
	}

	stop(user) {
		if(user && this.settings.starter != user)
			return false;
		global.client.send(this.settings.channel, "Game stopped.");
		if(global.config.voice_players)
			ircDevoice(global.client, this.settings.channel, this.players);

		this.timer_start.stop();
		this.timer_stop.stop();
		this.timer_round.stop();
		if(this.on_stop !== undefined)
			this.on_stop();
		return true;
	}

	join(user) {
		if(_.indexOf(this.players, user) != -1)
			return;
		this.players.push(user);
		if(this.points[user] === undefined)
			this.points[user] = 0;
		this.hasPlayed[user] = 3;
		global.client.send(this.settings.channel, user + " joined the game.");
		if(global.config.voice_players)
			ircVoice(global.client, this.settings.channel, [user]);
		if(this.players.length >= 3 && !this.roundRunning)
			this._start_game();
	}

	leave(user) {
		if(_.indexOf(this.players, user) == -1)
			return;
		global.client.send(this.settings.channel, user + " left the game.");
		if(global.config.voice_players)
			ircDevoice(global.client, this.settings.channel, [user]);
		this.players = _.without(this.players, user);
		if(this.players.length == 0)
			return this.stop();
		if(!this._check_players(user))
			return;
		if(this.roundRunning) {
			// Abort the round if the czar left, otherwise check whether everyone has played
			//  (now that a person has left)
			if(user == this.czar) {
				this.timer_round.stop();
				global.client.send(this.settings.channel, "Looks like the czar left, nobody wins this round.");
				this._round();
			} else {
				if(this.round_stage == 0)
					this._check_all_played();
			}
		}
	}

	get_players() {
		return this.players;
	}

	notice_cards(user) {
		if(!this.roundRunning)
			return;
		if(_.indexOf(this.players, user) == -1)
			return;
		if(user == this.czar)
			return;
		this._notice_cards(user);
	}

	show_status() {
		if(!this.roundRunning) {
			global.client.send(this.settings.channel, util.format(
				"%sStatus:%s No round running.",
				global.client.format.bold,
				global.client.format.bold
			));
			return;
		} else if(this.round_stage == 1) {
			global.client.send(this.settings.channel, util.format(
				"%sStatus:%s Waiting for %s to pick a winner.",
				global.client.format.bold,
				global.client.format.bold,
				this.czar
			));
			return;
		}
		var tmp = this.players;

		_.each(this.hasPlayed, function(_trash, player) {
			tmp = _.without(tmp, player);
		});
		tmp = _.without(tmp, this.czar);

		global.client.send(this.settings.channel, util.format(
			"%sStatus:%s %s is the card czar. Waiting for players to play: %s",
			global.client.format.bold,
			global.client.format.bold,
			this.czar,
			prettyList(tmp)
		));
	}

	show_question_card() {
		if(!this.roundRunning)
			return;
		this._display_black_card();
	}

	pick(user, cards) {
		if(!this.roundRunning)
			return;
		if(_.indexOf(this.players, user) == -1)
			return;
		if(user == this.czar) {
			if(this.round_stage === 0)
				return global.client.send(this.settings.channel, util.format("%s: The czar does not play yet.", user));
			var winner;

			if(cards.length != 1) {
				global.client.send(this.settings.channel, "You need to select a winner.");
				return;
			}
			if(cards[0] < 1 || cards[0] > this.pick_order.length) {
				global.client.send(this.settings.channel, "Invalid winner.");
				return;
			}
			winner = this.pick_order[cards[0] - 1];
			global.client.send(this.settings.channel, util.format(
				"%sWinner is:%s %s with \"%s\", gets one awesome point and has %d awesome points!",
				global.client.format.bold,
				global.client.format.bold,
				winner,
				_format_card(this.q_card, this.picks[winner]),
				++this.points[winner]
			));

			this.roundRunning = false;
			this.timer_round.stop();
			if(this._check_plimit())
				return; // Game ended
			this._round();
		} else {
			if(this.round_stage == 1)
				return;
			else if(this.hasPlayed[user] > 1) {
				var err;
				if(this.hasPlayed[user] == 2)
					err = "swapped cards";
				else if(this.hasPlayed[user] == 3)
					err = "just joined";
				else if(this.hasPlayed[user] == 4)  // fpassed
					err = "can't play";
				return global.client.send(this.settings.channel, util.format("%s: You %s this round.", user, err));
			}
			if(cards.length != this.q_card.pick)
				return global.client.send(this.settings.channel, util.format("You need to pick %d cards.", this.q_card.pick));
			if(cards.length != _.uniq(cards).length)
				return global.client.send(this.settings.channel, "You can't pick a card more than once.");
			if(_.min(cards) < 1 || _.max(cards) > this.cards[user].length)
				return global.client.send(this.settings.channel, "Invalid cards selected.");
			cards = _.map(cards, function(n) { return n - 1; });
			var pick = [];
			_.each(cards, function(card_idx) {
				pick.push(this.cards[user][card_idx]);
			}, this);
			this.hasPlayed[user] = 1;
			this.pickIds[user] = cards;
			this.picks[user] = pick;
			global.client.notice(user, util.format("You played: %s", _format_card(this.q_card, pick)));
			this._check_all_played();
		}
	}

	retract(user) {
		if (!this.roundRunning)
			return;
		if(_.indexOf(this.players, user) == -1)
			return;
		if(user == this.czar)
			return;
		if(this.round_stage == 1)
			return;
		if(!this.hasPlayed[user])
			return;

		if(this.hasPlayed[user] != 1) {
			var err;
			if(this.hasPlayed[user] == 2)
				err = "swapped cards";
			else if(this.hasPlayed[user] == 3)
				err = "just joined";
			else if(this.hasPlayed[user] == 4)
				err = "can't play";
			return global.client.send(this.settings.channel, util.format("%s: You %s this round.", user, err));
		}

		delete this.hasPlayed[user];

		global.client.notice(user, "You have retracted your pick.");
	}

	show_points(show_all) {
		var tmp, tmp2 = [];
		var out = "";
		var prev_pts = -1;

		if(show_all) {
			tmp = this.points;
		} else {
			tmp = {};
			_.each(this.points, function(_trash, player) {
				if(_.indexOf(this.players, player) != -1)
					tmp[player] = this.points[player];
			}, this);
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

		global.client.send(this.settings.channel, util.format(
			"Point limit is %s%d%s. The most horrible people: %s",
			global.client.format.bold,
			this.settings.plimit,
			global.client.format.bold,
			out
		));
	}

	swap_cards(user) {
		if(!this.roundRunning)
			return;
		if(_.indexOf(this.players, user) == -1)
			return;
		if(this.round_stage == 1)
			return;
		if(user == this.czar) {
			return global.client.send(this.settings.channel, util.format("%s: The card czar can't swap cards.", user));
		} else if(this.players.length < SWAP_MIN_PLAYERS) {
			return global.client.send(this.settings.channel, util.format("%s: There must be at least %d players to use !swap.", user, SWAP_MIN_PLAYERS));
		} else if(this.hasPlayed[user] > 1) {
			var tmp;
			if(this.hasPlayed[user] == 2)
				tmp = "already swapped cards";
			else if(this.hasPlayed[user] == 3)
				tmp = "just joined";
			else if(this.hasPlayed[user] == 4)
				tmp = "can't play";
			return global.client.send(this.settings.channel, util.format("%s: You %s this round.", user, tmp));
		} else if(this.points[user] === 0) {
			return global.client.send(this.settings.channel, util.format("%s: You need at least one awesome point to use !swap.", user));
		}
		// Remove cards from the player and give them new ones
		this.hasPlayed[user] = 2;
		this.cards[user] = [];
		this._refill_cards(user);
		this._notice_cards(user);
		global.client.send(this.settings.channel, util.format(
			"%s swapped all of their cards. They don't play this round and lose a point. %s now has %d awesome points.",
			user,
			user,
			--this.points[user]
		));
		this._check_all_played();
	}

	force_pass(user) {
		if(!this.roundRunning)
			return;
		if(_.indexOf(this.players, user) == -1)
			return;
		if(user == this.czar)
			return this._round();

		this.hasPlayed[user] = 4;
		this._check_all_played();
	}

	force_limit(limit) {
		var high_pts, low_limit;

		high_pts = _.max(this.points);
		low_limit = high_pts + 1; // Lowest possible point limit

		if(limit === 0) {
			this.settings.plimit = limit;
			return global.client.send(this.settings.channel, "The point limit is now infinite.");
		} else if(limit < low_limit) {
			return global.client.send(
				this.settings.channel,
				util.format("The lowest point limit you can set this game to is %d. If you want to make the game infinite, set it to 0.", low_limit)
			);
		} else {
			this.settings.plimit = limit;
			return global.client.send(this.settings.channel, util.format("The point limit is now %d.", limit));
		}
	}

	force_last_round(round_no) {
		if(round_no !== undefined)
			this.last_round = round_no;
		else
			this.last_round = this.round_no;

		global.client.send(this.settings.channel, util.format("The game will stop at the end of round %d.", this.last_round));
	}

	force_leave(user) {
		this.leave(user);
	}

	/* private methods */

	_check_players() {
		if(this.players.length >= 3)
			return true;
		if(this.timer_start.isRunning())
			return true; // Don't complain about lack of users if initial period not elapsed yet
		if(this.timer_stop.isRunning())
			return false; // Don't complain twice
		this.roundRunning = false;
		this.timer_round.stop()
		global.client.send(this.settings.channel, util.format("Not enough players to play (need at least 3). Stopping in %d minutes if not enough players.", NOT_ENOUGH_PLAYERS_WAIT_MINS));
		this.timer_stop.start();
		return false;
	}

	_start_game() {
		this.timer_start.stop();
		this.timer_stop.stop()
		global.client.send(this.settings.channel, util.format(
			"Starting %s with '%s' cards: %s",
			this.settings.plimit > 0 ? util.format("a game till %d points", this.settings.plimit) : "an infinite game",
			this.settings.coll,
			cards.collectionInfo(this.settings.coll)
		));
		this._round();
	}

	_notice_cards(pl) {
		if(!pl) {
			_.each(this.players, function(pl) {
				if(pl == this.czar)
					return;
				this._notice_cards(pl);
			}, this);
		} else {
			if(_.indexOf(this.players, pl) == -1)
				return;
			var cards = [];
			_.each(this.cards[pl], function(card, i) {
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

	_display_black_card() {
		global.client.send(this.settings.channel, util.format(
			"%sCARD:%s %s %s",
			global.client.format.bold,
			global.client.format.bold,
			_format_card(this.q_card),
			_format_card_opts(this.q_card)
		));
	}

	_round() {
		var tmp;

		this.round_no++;
		if(_.indexOf(this.players, this.czar) == -1)
			tmp = 0;
		else
			tmp = (_.indexOf(this.players, this.czar) + 1) % this.players.length;
		this.czar = this.players[tmp];
		this.round_stage = 0;
		this.hasPlayed = {};
		this.picks = {};

		global.client.send(this.settings.channel, util.format(
			"Round %d! %s is the card czar.",
			this.round_no,
			this.czar
		));
		this.q_card = this.cardpool.randomQuestionCard();
		this._display_black_card();
		this._refill_cards();
		this._notice_cards();
		this.roundRunning = true;
		this.timer_round.resumeFrom(-1 * ROUND_MAX_PLAY_TIME_MINS * 60);
	}

	_check_all_played() {
		var tmp = this.players;

		_.each(this.hasPlayed, function(_trash, player) {
			tmp = _.without(tmp, player);
		});
		tmp = _.without(tmp, this.czar);

		if(tmp.length === 0) {
			tmp = this.players;
			tmp = _.without(tmp, this.czar);
			_.each(this.hasPlayed, function(a, pl) {
				if(a == 2 || a == 3 || a == 4) { // player swapped, joined new or can't play (other reason)
					tmp = _.without(tmp, pl);
				}
			});

			_.each(tmp, function(user) {
				this.cards[user] = removeByIndex(this.cards[user], this.pickIds[user]);
			}, this);

			this.pick_order = _.shuffle(tmp);
			global.client.send(this.settings.channel, "Everyone has played. Here are the entries:");
			_.each(this.pick_order, function(player, i) {
				global.client.send(this.settings.channel, util.format(
					"%d: %s", i+1, _format_card(this.q_card, this.picks[player])
				));
			}, this);

			this.round_stage = 1;
			this.timer_round.stop();
			this.timer_round.resumeFrom(-1 * ROUND_MAX_CZAR_TIME_MINS * 60);
			global.client.send(this.settings.channel, util.format("%s: Select the winner using !pick", this.czar));
		}
	}

	_check_plimit() {
		if(this.last_round == this.round_no) {
			var won = [], tmp;

			// Find out highest score and collect all players with that score
			tmp = _.max(this.points);
			_.each(this.points, function(pts, pl) {
				if(pts == tmp)
					won.push(pl);
			});

			if(won.length == 1)
				tmp = util.format("%s was the winner with %d points", won[0], tmp);
			else
				tmp = util.format("%s were the winners with %d points each", prettyList(tmp), tmp);
			global.client.send(this.settings.channel, util.format(
				"Sorry to ruin the fun, but that was the last round of the game! %s!",
				tmp
			));

			this.show_points(true);
			return this.stop();
		}
		if(this.settings.plimit <= 0)
			return false;
		var r = false;
		_.each(this.points, function(pts, pl) {
			if(r)
				return; // if someone already won and the game was deleted, don't do anything
			if(pts == this.settings.plimit) {
				global.client.send(this.settings.channel, util.format(
					"%s reached the limit of %d awesome points and is the most horrible person around! Congratulations!",
					pl,
					this.settings.plimit
				));
				this.show_points(true);
				this.stop();
				r = true;
			}
		}, this);
		return r;
	}

	_refill_cards(pl) {
		if(!pl)
			return _.each(this.players, function(pl) { this._refill_cards(pl); }, this);
		var draw = 10;

		if(this.q_card.pick > 2 && pl != this.czar) {
			draw = draw + (this.q_card.pick - 1);
		}

		if(!this.cards[pl])
			this.cards[pl] = [];
		while(this.cards[pl].length < draw)
			this.cards[pl].push(this.cardpool.randomAnswerCard());
	}

	/* timers */

	_timer_start() {
		if(this._check_players())
			this._start_game();
	}

	_timer_stop() {
		if(this.players.length < 3)
			this.stop();
		else
			this._start_game();
	}

	_timer_round_1min() {
		global.client.send(this.settings.channel, "Hurry up! 1 minute left.");
		this.show_status();
	}

	_timer_round_30sec() {
		global.client.send(this.settings.channel, "30 seconds left.");
	}

	_timer_round_10sec() {
		global.client.send(this.settings.channel, "10 seconds left.");
	}

	_timer_round_elapsed() {
		global.client.send(this.settings.channel, "Time's up.");
		// Directly start a new round unless enough people have picked
		if(_.size(this.picks) >= 2 && this.round_stage == 0) {
			_.each(this.players, function(pl) {
				if(this.hasPlayed[pl])
					return;
				this.hasPlayed[pl] = 4;
			}, this);
			this._check_all_played();
		} else {
			this._round();
		}
	}

}

/* game-related helper functions */

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

/* generic helper functions */

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

/* IRC commands */

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

	var game = games[evt.channel] = new Game(settings, function() { games[evt.channel] = undefined; });
	game.join(evt.user);
}

function cmd_stop(evt, args) {
	if(!games[evt.channel])
		return evt.reply("No game running, start one with !start.");
	var game = games[evt.channel];
	if(evt.has_op) {
		game.stop(); // stop game unconditionally
	} else {
		if(!game.stop(evt.user))
			evt.reply("You can't stop the game.");
	}
}

function cmd_join(evt, args) {
	if(!games[evt.channel]) {
		cmd_start(evt, args);
		if(!games[evt.channel]) // Abort if game was not started for some reason
			return;
	}
	games[evt.channel].join(evt.user);
}

function cmd_leave(evt, args) {
	if(!games[evt.channel])
		return;
	games[evt.channel].leave(evt.user);
}

function cmd_players(evt, args) {
	if(!games[evt.channel])
		return;
	evt.reply("Currently playing: " + prettyList(games[evt.channel].get_players()));
}

function cmd_cards(evt, args) {
	if(!games[evt.channel])
		return;
	games[evt.channel].notice_cards(evt.user);
}

function cmd_card(evt, args) {
	if(!games[evt.channel])
		return;
	games[evt.channel].show_question_card();
}

function cmd_status(evt, args) {
	if(!games[evt.channel])
		return;
	games[evt.channel].show_status();
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
	games[evt.channel].pick(evt.user, a);
}

function cmd_retract(evt, args) {
	if(!games[evt.channel])
		return;
	games[evt.channel].retract(evt.user);
}

function cmd_points(evt, args) {
	if(!games[evt.channel])
		return;
	games[evt.channel].show_points();
}

function cmd_swap(evt, args) {
	if(!games[evt.channel])
		return;
	games[evt.channel].swap_cards(evt.user);
}

function cmd_fpass(evt, args) {
	if(!games[evt.channel])
		return;
	if(!evt.has_op)
		return;
	games[evt.channel].force_pass(args.trim());
}

function cmd_flimit(evt, args) {
	if(!games[evt.channel])
		return;
	if(!evt.has_op)
		return;
	if(args === undefined)
		return evt.reply("No limit specified");

	var num = args.trim();

	try {
		num = parseIntEx(num);
	} catch(e) {
		return evt.reply("Invalid argument");
	}

	games[evt.channel].force_limit(num);
}

function cmd_flastround(evt, args) {
	if(!games[evt.channel])
		return;
	if(!evt.has_op)
		return;
	var game = games[evt.channel];
	if(args === undefined)
		return game.force_last_round();

	var num = args.trim();

	try {
		num = parseIntEx(num);
	} catch(e) {
		return evt.reply("Invalid argument");
	}

	game.force_last_round(num);
}

function cmd_fleave(evt, args) {
	if(!games[evt.channel])
		return;
	if(!evt.has_op)
		return;
	games[evt.channel].force_leave(args.trim());
}

/* IRC events */

function evt_part(evt) {
	if(!games[evt.channel])
		return;
	games[evt.channel].leave(evt.user);
}

function evt_quit(evt) {
	// quitting is not specific to any channel so we need to check each one
	_.each(global.config.channels, function(channel) {
		if(!games[channel])
			return;
		games[channel].leave(evt.user);
	});
}

function evt_kick(evt) {
	if(!games[evt.channel])
		return;
	games[evt.channel].leave(evt.kicked);
}


exports.setup = function(cmdreg) {
	var commands = {};
	// Normal commands
	commands.start = cmd_start;
	commands.stop = cmd_stop;
	commands.join = cmd_join;
	commands.leave = cmd_leave;
	commands.players = cmd_players;
	commands.cards = cmd_cards;
	commands.card = cmd_card;
	commands.status = cmd_status;
	commands.pick = cmd_pick;
	commands.retract = cmd_retract;
	commands.points = cmd_points;
	commands.swap = cmd_swap;
	// Aliases
	commands.s = cmd_start;
	commands.j = cmd_join;
	commands.l = cmd_leave;
	commands.q = cmd_leave;
	commands.quit = cmd_leave;
	commands.p = cmd_pick;
	commands.r = cmd_retract;
	commands.pts = cmd_points;
	// Admin commands
	commands.flimit = cmd_flimit;
	commands.fpass = cmd_fpass;
	commands.flastround = cmd_flastround;
	commands.fleave = cmd_fleave;

	cmdreg.register(commands);
	cmdreg.onPart(evt_part);
	cmdreg.onQuit(evt_quit);
	cmdreg.onKick(evt_kick);
	cards.setup();
};
