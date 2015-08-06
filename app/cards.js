var _ = require('underscore');
var fs = require('fs');
var util = require('util');
var JSON5 = require('json5');

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
		var path, set;

		path = util.format("config/sets/%s.json5", setname);
		if (!fs.existsSync(path)) {
			path = util.format("sets/%s.json5", setname);
		}

		set = JSON5.parse(fs.readFileSync(path));
		_.each(set.questions, function(q) {
			var tmp, i;
			tmp = q.text;

			if (q.pick === undefined) {
				q.pick = 0;

				while ((i = tmp.indexOf("%s")) !== -1) { // count number of %s
					q.pick++;
					tmp = tmp.slice(i + 2);
				}

				if (q.pick === 0) {
					q.pick = 1;  // default to pick 1 if not explicitly specified and no %s found
				}
			}

			if (q.pick < 1 || (q.pick % 1) !== 0) {
				throw new RangeError(util.format("q.pick must be a positive integer (got %s)", q.pick));
			}
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
	return util.format("%d collections, %d sets, %d cards (%d questions / %d answers)", _.size(compiled_collections), _.size(loaded_sets), black + white, black, white);
};

exports.collectionInfo = function(coll) {
	var black, white, setinfo = [];

	black = _.size(compiled_collections[coll].questions);
	white = compiled_collections[coll].answers.length;

	_.each(compiled_collections[coll].source_sets, function(set) {
		setinfo.push(util.format("%s (%d/%d)", loaded_sets[set].meta.name, _.size(loaded_sets[set].questions), loaded_sets[set].answers.length));
	});

	return util.format("%d cards (%d questions / %d answers): %s", black + white, black, white, setinfo.join(", "));
};

exports.collectionExists = function(collection) {
	return !!compiled_collections[collection];
};

exports.getQuestionCards = function(collection) {
	return compiled_collections[collection].questions;
};

exports.getAnswerCards = function(collection) {
	return compiled_collections[collection].answers;
};

exports.randomQuestionCard = function(collection) {
	var cards = compiled_collections[collection].questions;
	return cards[randint(cards.length - 1)];
};

exports.randomAnswerCard = function(collection) {
	var cards = compiled_collections[collection].answers;
	return cards[randint(cards.length - 1)];
};

exports.setup = function() {
	load();

	console.log("[cards.js] Loaded " + exports.info());
};
