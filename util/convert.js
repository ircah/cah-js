var fs = require('fs');
var JSON5 = require('json5');
var entities = new (require('html-entities').AllHtmlEntities)();


// amount of non-overlapping matches for <search> in <string>
// e.g. count_in_string("ssss", "ss") -> 2
function count_in_string(string, search)
{
	var ctr, i;
	ctr = 0;
	i = -search.length; // start from 0
	while((i = string.indexOf(search, i + search.length)) !== -1) {
		ctr++;
	}
	return ctr;
}

function process_txt(text)
{
	var a;

	a = text
		.replace(/(?:<br>)+/g, " ")
		//.replace(/<br>/g, "\u21b2") // alternative: replace newlines w/ newline symbol
		.replace(/<(?:b|i|small)>([^<]+)<\/(?:b|i|small)>/g, "$1")
	;
	a = entities.decode(a);

	return a;
}

process.argv = process.argv.slice(1);
if(process.argv.length <= 2) {
	console.log("Converts JSON CAH sets downloaded from http://www.crhallberg.com/cah/json");
	console.log("Usage: " + process.argv[0] + " <input json> <output json5>");
	process.exit(1);
}

var input_file = process.argv[1];
var output_file = process.argv[2];

var data = fs.readFileSync(input_file, "utf8");
var data = JSON.parse(data);

if(data.order.length > 1) {
	console.log("Only a single set is supported at a time");
	process.exit(1);
}

var out = {};
var i = 0;

out.questions = [];
out.answers = [];
out.meta = {};
out.meta.name = data[data.order[0]].name;

for(var e in data.blackCards) {
	e = data.blackCards[e];
	var tmp = {};

	tmp.text = process_txt(e.text.replace(/_/g, "%s"));

	if(e.pick != 1 && count_in_string(tmp.text, "%s") != e.pick)
		tmp.pick = e.pick;
	out.questions.push(tmp);
	i++;
}

for(var e in data.whiteCards) {
	e = data.whiteCards[e];
	if(e.slice(-1) == '.') // strip trailing dots
		e = e.slice(0, -1);
	out.answers.push(process_txt(e));
	i++;
}

fs.writeFileSync(output_file, JSON5.stringify(out, null, 2));

console.log("Processed " + i + " cards!");
