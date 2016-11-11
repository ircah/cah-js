var _ = require('underscore');

var cards = require('./cards.js');

class CardPool {
	constructor(collection) {
		this.answerCards = cards.getAnswerCards(collection);
		this.answerCardIndex = 0;
		this.questionCards = cards.getQuestionCards(collection);
		this.questionCardIndex = 0;

		this.reshuffleCards();
	}
	_reshuffleQuestionCards() {
		this.questionCards = _.shuffle(this.questionCards);
		this.questionCardIndex = 0;
	}
	_reshuffleAnswerCards() {
		this.answerCards = _.shuffle(this.answerCards);
		this.answerCardIndex = 0;
	}
	randomQuestionCard() {
		var card = this.questionCards[this.questionCardIndex];
		this.questionCardIndex++;
		if(this.questionCardIndex >= this.questionCards.length)
			this._reshuffleQuestionCards();
		return card;
	}
	randomAnswerCard() {
		var card = this.answerCards[this.answerCardIndex];
		this.answerCardIndex++;
		if(this.answerCardIndex >= this.answerCards.length)
			this._reshuffleAnswerCards();
		return card;
	}
	reshuffleCards() {
		this._reshuffleAnswerCards();
		this._reshuffleQuestionCards();
	}
}

exports.CardPool = CardPool;
