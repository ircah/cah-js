var util = require('util');

function cmd_start(evt, args) {
	evt.reply(util.format("fak u %s, I'm not starting a game!", evt.user));
	global.client.write("QUIT :");
}

exports.setup = function() {
	global.commands["start"] = cmd_start;
};
