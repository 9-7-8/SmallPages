import glob, re, html
from html.parser import HTMLParser

WATCH = {"title","h1","h2","h3","h4","label","button","option","legend","summary","th","caption"}

class Grab(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack=[]; self.buf=[]; self.out=[]; self.attrs=[]
    def handle_starttag(self, tag, attrs):
        d=dict(attrs)
        for a in ("aria-label","placeholder","title"):
            if d.get(a): self.attrs.append((a,d[a]))
        cls = d.get("class","")
        key = tag if tag in WATCH else ("span."+cls if tag=="span" and cls in ("name","what") else None)
        if key:
            self.stack.append((key, len(self.out)))
            self.buf.append("")
        elif self.stack:
            self.buf[-1] += " "
    def handle_endtag(self, tag):
        if self.stack and (self.stack[-1][0]==tag or self.stack[-1][0].startswith("span.") and tag=="span"):
            key,_=self.stack.pop()
            text=re.sub(r"\s+"," ",self.buf.pop()).strip()
            if text: self.out.append((key,text))
    def handle_data(self, data):
        if self.stack: self.buf[-1]+=data

bad=0
for f in sorted(glob.glob("*.html")):
    g=Grab(); g.feed(open(f,encoding="utf-8").read())
    rows=[]
    for key,text in g.out + [("@"+a,v) for a,v in g.attrs]:
        if text[:1].islower():
            rows.append((key,text))
    if rows:
        print("\n### %s  (%d)" % (f,len(rows)))
        for k,t in rows: print("  %-10s %s" % (k, t[:100]))
        bad+=len(rows)
print("\ntotal:", bad)
