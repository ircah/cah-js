#!/usr/bin/env python3
import re
import json # turns out the dump function of the json5 module just calls the normal json module （╯°□°）╯︵ ┻━┻

INPUT = "cards-DevOpsAgainstHumanity.csv"
META_NAME = "DevOps Against Humanity"
DEL = ","
LSKIP = 2
TRANSFORMS = [
	(r'"+', r'"')
]


r_blank = re.compile(r"_+")
odict = {}
odict["questions"] = []
odict["answers"] = []
odict["meta"] = {}
odict["meta"]["name"] = META_NAME
ifd = open(INPUT, "r")
for i in range(LSKIP):
	ifd.readline()
n = 0
while True:
	l = ifd.readline()
	if not l:
		break
	l = l.rstrip("\r\n")
	pos = l.find(",")
	l = (l[:pos], l[pos+1:])
	if l[0] != "":
		txt = l[0]
		for t in TRANSFORMS:
			txt = re.sub(t[0], t[1], txt)
		odict["answers"].append(txt)
		n += 1
	if l[1] != "":
		txt = l[1]
		txt = re.sub(r_blank, "%s", txt)
		for t in TRANSFORMS:
			txt = re.sub(t[0], t[1], txt)
		tmp = {}
		tmp["text"] = txt # pick is inferred from number of %s
		odict["questions"].append(tmp)
		n += 1
ifd.close()
ofd = open(INPUT.replace(".csv", ".json5"), "w")
json.dump(odict, ofd, indent=2, sort_keys=True)
ofd.close()
print("Processed %d cards." % (n, ))

