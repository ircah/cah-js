var _ = require('underscore');
var coffea = require('coffea');
var util = require('util');

var commands = require('./commands.js');
var game = require('./game.js');

exports.setup = function() {
	var client = coffea(config.irc);
	global.client = client;
	commands.setup();
	game.setup(commands);

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
		commands._handle(evt2, evt.message);
	});

	client.on("join", function(evt) {
		console.log("[bot.js] %s joins %s", evt.user.getNick(), evt.channel.getName());
	});

	client.on("part", function(evt) {
		console.log("[bot.js] %s leaves %s", evt.user.getNick(), evt.channel.getName());
		var evt2 = {};
		evt2.user = evt.user.getNick();
		evt2.channel = evt.channel.getName();
		commands._eventPart(evt2);
	});
	
	client.on('quit', function(evt) {
    	console.log("[bot.js] %s quit from IRC", evt.user.getNick());
    	var evt2 = {};
    	evt2.user = evt.user.getNick();
    	commands._eventQuit(evt2);
	});

	client.on('kick', function(evt) {
		console.log("[bot.js] %s was kicked from %s by %s", evt.user.getNick(), evt.channel.getName(), evt.by.getNick());
		var evt2 = {};
		evt2.kicker = evt.by.getNick();
		evt2.kicked = evt.user.getNick();
		evt2.channel = evt.channel.getName();
		commands._eventKick(evt2);
	});

	client.on('nick', function(evt) {
    	console.log("[bot.js] %s changes nick to %s", evt.oldNick, evt.user.getNick());
	});
};
