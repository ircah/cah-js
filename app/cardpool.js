var _ = require('underscore');

var cards = require('./cards.js');

function CardPool(collection) {
	this.answerCards = cards.getAnswerCards(collection);
	this.answerCardIndex = 0;
	this.questionCards = cards.getQuestionCards(collection);
	this.questionCardIndex = 0;

	var reshuffleQuestionCards = function() {
		this.questionCards = _.shuffle(this.questionCards);
		this.questionCardIndex = 0;
	}.bind(this);
	var reshuffleAnswerCards = function() {
		this.answerCards = _.shuffle(this.answerCards);
		this.answerCardIndex = 0;
	}.bind(this);
	this.randomQuestionCard = function() {
		var card = this.questionCards[this.questionCardIndex];
		this.questionCardIndex++;
		if(this.questionCardIndex >= this.questionCards.length)
			reshuffleQuestionCards();
		return card;
	}
	this.randomAnswerCard = function() {
		var card = this.answerCards[this.answerCardIndex];
		this.answerCardIndex++;
		if(this.answerCardIndex >= this.answerCards.length)
			reshuffleAnswerCards();
		return card;
	}
	this.reshuffleCards = function() {
		reshuffleAnswerCards();
		reshuffleQuestionCards();
	}

	this.reshuffleCards();
}

exports.CardPool = CardPool;
