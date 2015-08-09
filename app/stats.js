var _ = require('underscore');
var fs = require('fs');
var JSON5 = require('json5');

var stats;
var tmp_gametime = {};
var STATS_PATH = "config/statistics.json5";
var STATS_CURRENT_VER = 1;

// "blueprints", defined here because they are used in multiple places
var B_stats = {
	version: STATS_CURRENT_VER,
	leaderboard: {}, // games played, games won and awesome points acquired (per player)
	games: {
		total: 0, // games played
		collections: {}, // collection name -> times used
		durations: [], // game durations in seconds
		roundNos: [], // round numbers (on game end)
		pointLimits: [], // point limit (on game end)
		playerCounts: [], // player count (on game end)
	}
};
var B_leaderboard_entry = {
	wins: 0, // how many games were won
	total: 0, // how many games were played
	points: 0, // how many points the player has
	playedCards: 0, // number of card combinations played
	winningCards: 0, // number of winning card combinations played
};

function migrate_stats() {
	// to allow changing the stats file over time we have this migration function
	// it migrates the stats file from the current version to the next (and increases the version num)
	// the version should be increased when any change is introduced
	if(stats.version == 1) {
		return false;
	} else {
		console.log("Unsupported stats version");
		return false;
	}
}

function load_stats() {
	if(!fs.existsSync(STATS_PATH)) {
		stats = _.clone(B_stats);
	} else {
		stats = JSON5.parse(fs.readFileSync(STATS_PATH));
		var was_migrated = (stats.version < STATS_CURRENT_VER);
		while(stats.version < STATS_CURRENT_VER) {
			if(!migrate_stats()) {
				console.log("Stats file migration failed!");
				process.exit(1);
			}
		}
		if(was_migrated)
			save_stats();
	}
}

function save_stats() {
	fs.writeFileSync(STATS_PATH, JSON5.stringify(stats));
}

// cards -> [{text: ["The biggest, blackest dick", ...], playedBy: "playername", won: true}, ...]
exports.cardsPlayed = function(cards) {
	_.each(cards, function(card) {
		if(!stats.leaderboard[card.playedBy])
			stats.leaderboard[card.playedBy] = _.clone(B_leaderboard_entry);
		stats.leaderboard[card.playedBy].playedCards++;
		if(card.won)
			stats.leaderboard[card.playedBy].winningCards++;
	});
	save_stats();
};

// game -> {id: "#foobar"}
//   id needs to be unique among currently running games
exports.gameStarted = function(game) {
	var cur = Math.floor((new Date()).getTime() / 1000);
	tmp_gametime[game.id] = cur;
};

// game -> {collection: "extended", round_no: 32, point_limit: 7, num_players: 4, id: "##ircah"}
//   id needs to be unique among currently running games
// players -> [{name: "playername", points: 12, won: true}, ...]
exports.gameEnded = function(game, players) {
	var cur = Math.floor((new Date()).getTime() / 1000);
	stats.games.durations.push(cur - tmp_gametime[game.id]);
	stats.games.roundNos.push(game.round_no);
	stats.games.pointLimits.push(game.point_limit);
	stats.games.playerCounts.push(game.num_players);
	if(!stats.games.collections[game.collection])
		stats.games.collections[game.collection] = 0;
	stats.games.collections[game.collection]++;
	stats.games.total++;
	_.each(players, function(player) {
		if(!stats.leaderboard[player.name])
			stats.leaderboard[player.name] = _.clone(B_leaderboard_entry);
		stats.leaderboard[player.name].total++;
		if(player.won)
			stats.leaderboard[player.name].wins++;
		stats.leaderboard[player.name].points += player.points;
	});
	save_stats();
};

exports.setup = function() {
	load_stats();
};
