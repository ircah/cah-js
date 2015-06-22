var _ = require('underscore');
var fs = require('fs');
var util = require('util');

var loaded_sets = {};
var compiled_collections = {};

function load()
{
	var setnames = [];

	// Figure out which sets to load
	_.each(global.config.collections, function(coll) {
		_.each(coll, function(a) { setnames.push(a); });
	});

	_.each(setnames, function(setname) {
		var set = JSON.parse(fs.readFileSync(util.format("config/sets/%s.json", setname), "utf8"));
		_.each(set.questions, function(q) {
			q.pick = q.pick || 1; // 'pick' is optional
		});
		loaded_sets[setname] = set;
	});

	// Compile collections based on loaded sets
	_.each(global.config.collections, function(coll, collname) {
		var c = {};
		c.source_sets = coll;
		c.questions = [];
		c.answers = [];
		_.each(coll, function(setname) {
			_.each(loaded_sets[setname].questions, function(a) { c.questions.push(a); });
			_.each(loaded_sets[setname].answers, function(a) { c.answers.push(a); });
		});
		compiled_collections[collname] = c;
	});
}

function randint(max) // 0 <= return val <= max
{
	return Math.floor(Math.random() * max);
}

exports.info = function() {
	var black=0, white=0;

	_.each(loaded_sets, function(set) {
		black += _.size(set.questions);
		white += set.answers.length;
	});
	return util.format("%d collections, %d sets, %d cards (%d questions, %d answers)", _.size(compiled_collections), _.size(loaded_sets), black + white, black, white);
};

exports.collectionExists = function(collection) {
	return !!compiled_collections[collection];
};

exports.getQuestionCard = function(collection) {
	var cards = compiled_collections[collection].questions;
	return cards[randint(cards.length - 1)];
};

exports.getAnswerCard = function(collection) {
	var cards = compiled_collections[collection].answers;
	return cards[randint(cards.length - 1)];
};

exports.setup = function() {
	load();

	console.log("[cards.js] Loaded " + exports.info());
};
