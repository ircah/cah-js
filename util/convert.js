var fs = require('fs');
var entities = new (require('html-entities').AllHtmlEntities)();

function process_txt(text)
{
	var a;
	
	a = text
		//.replace(/<br>/g, "\u21b2")
		.replace(/(?:<br>)+/g, " ")
		.replace(/<(?:b|i|small)>([^<]+)<\/(?:b|i|small)>/g, "$1")
	;
	a = entities.decode(a);

	return a;
}

process.argv = process.argv.slice(1);
if(process.argv.length <= 2) {
	console.log("Converts JSON files downloaded from http://www.crhallberg.com/cah/json");
	console.log("Usage: " + process.argv[0] + " <input json> <output json>");
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

for(e in data.blackCards) {
	e = data.blackCards[e];
	var tmp = {};

	tmp.text = process_txt(e.text.replace(/_/g, "%s"));
	
	if(e.pick != 1)
		tmp.pick = e.pick;
	out.questions.push(tmp);
	i++;
}

for(e in data.whiteCards) {
	e = data.whiteCards[e];
	if(e.slice(-1) == '.')
		e = e.slice(0, -1);
	out.answers.push(process_txt(e));
	i++;
}

fs.writeFileSync(output_file, JSON.stringify(out));

console.log("Processed " + i + " cards!");
