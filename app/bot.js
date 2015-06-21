var coffea = require('coffea');
var util = require('util');

exports.setup = function() {
	var client = coffea(config.irc);
	global.client = client;

	client.on("motd", function(motd) {
		client.join(global.config.channels);
	});

	client.on("message", function(evt) {
		console.log(util.format("irc msg on %s: <%s> %s", evt.channel.getName(), evt.user.getNick(), evt.message));
	});

	client.on("join", function(evt) {
		console.log(util.format("irc %s joins %s", evt.user.getNick(), evt.channel.getName()));
	});

	client.on("part", function(evt) {
		console.log(util.format("irc %s leaves %s", evt.user.getNick(), evt.channel.getName()));
	});
};
