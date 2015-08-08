#!/usr/bin/env python3
import re
import json # turns out the dump function of the json5 module just calls the normal json module （╯°□°）╯︵ ┻━┻


INPUT = "cards-DevOpsAgainstHumanity.csv"
META_NAME = "DevOps Against Humanity"
DELIM = ","
QUOTE = "\""
SKIPLINES = 2


def parse_csv(line):
	a = []
	tmp = ""
	at_elem_start = True
	in_quotes = False
	in_escape = False
	for c in line:
		if at_elem_start:
			if c == DELIM: # empty element
				a.append("")
				continue
			in_quotes = (c == QUOTE)
			if not in_quotes:
				tmp += c
			at_elem_start = False
			continue
		if c == QUOTE and in_quotes and not in_escape:
			in_escape = True
		elif c == QUOTE and in_quotes and in_escape:
			tmp += QUOTE
			in_escape = False
		elif (c == DELIM and in_quotes and in_escape) or (c == DELIM and not in_quotes):
			a.append(tmp)
			tmp = ""
			in_escape = False
			at_elem_start = True
		else:
			tmp += c
	a.append(tmp)
	return a

r_blank = re.compile(r"_+")
odict = {}
odict["questions"] = []
odict["answers"] = []
odict["meta"] = {}
odict["meta"]["name"] = META_NAME

ifd = open(INPUT, "r")
for i in range(SKIPLINES):
	ifd.readline()
n = 0

while True:
	l = ifd.readline()
	if not l:
		break
	l = l.rstrip("\r\n")
	l = parse_csv(l)
	if l[0] != "":
		odict["answers"].append(l[0])
		n += 1
	if l[1] != "":
		tmp = {}
		tmp["text"] = re.sub(r_blank, "%s", l[1])
		# pick is inferred from number of %s
		odict["questions"].append(tmp)
		n += 1

ifd.close()
ofd = open(INPUT.replace(".csv", ".json5"), "w")
json.dump(odict, ofd, indent=2, sort_keys=True)
ofd.close()

print("Processed %d cards." % (n, ))

