var _ = require('underscore');
var util = require('util');

var cards = require('./cards.js');

function cmd_start(evt, args) {
	evt.reply("haz " + cards.info());
	evt.reply("random question card (from default collection): " + JSON.stringify(cards.getQuestionCard(global.config.default_collection)));
	evt.reply("random answer card (from default collection): " + JSON.stringify(cards.getAnswerCard(global.config.default_collection)));
	global.client.quit();
}

exports.setup = function() {
	global.commands["start"] = cmd_start;

	cards.setup();
};
