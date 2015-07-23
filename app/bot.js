var _ = require('underscore');
var coffea = require('coffea');
var util = require('util');

var commands = require('./commands.js');
var game = require('./game.js');

exports.setup = function() {
	var client = coffea(config.irc);
	global.client = client;
	commands.setup();
	game.setup();

	client.on("motd", function(motd) {
		console.log("[bot.js] MOTD arrived");
		client.join(global.config.channels);
	});

	client.on("message", function(evt) {
		console.log("[bot.js] %s <%s> %s", evt.channel.getName(), evt.user.getNick(), evt.message);
		var evt2 = {};
		evt2.user = evt.user.getNick();
		evt2.channel = evt.channel.getName();
		evt2.reply = function(a) { return evt.reply(a); }
		evt2.has_op = (evt.channel.names[evt.user.getNick()] == "@");
		evt2.has_voice = (evt.channel.names[evt.user.getNick()] == "+");
		commands.handle(evt2, evt.message);
	});

	client.on("join", function(evt) {
		console.log("[bot.js] %s joins %s", evt.user.getNick(), evt.channel.getName());
	});

	client.on("part", function(evt) {
		console.log("[bot.js] %s leaves %s", evt.user.getNick(), evt.channel.getName());
	});
};
