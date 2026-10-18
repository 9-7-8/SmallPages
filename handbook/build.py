"""Assemble ../minecraft-server-guide.html from the sources in this folder.

    python handbook/build.py            rebuild the page
    python handbook/build.py --check    is the built page up to date? (exit 1 if not)

WHY THE PAGE IS STILL ONE FILE
------------------------------
The built page is what gets committed and published, and several other things
depend on it being one file at one URL:

  * the Discord bot's /links, the pack download page and every bookmark a
    friend has point at .../SmallPages/minecraft-server-guide.html
  * server-stats.py injects the stats payload INTO the built file
  * sync-handbook-counts.sh rewrites the jar count INSIDE the built file
  * publish-handbook.sh structure-checks the built file before pushing it

So the split is at the SOURCE, not at the URL: twenty-three section files you
can actually edit, assembled into the single page everything else expects.

THE TWO MACHINE-MAINTAINED THINGS ARE CARRIED FORWARD, NOT REGENERATED
----------------------------------------------------------------------
server-stats.py and sync-handbook-counts.sh both write into the BUILT file. A
build that regenerated those from source would silently revert whichever ran
last. So this reads them back out of the previous build and transplants them:

  * everything between the SERVER-STATS-DATA markers
  * every class="jarcount" number

That makes a build idempotent and safe to run at any time, including right
after the nightly stats push. The numbers baked into the source files are only
a fallback for a first build with no previous output.

NAV ORDER IS PANEL ORDER, FROM ONE FILE
---------------------------------------
nav.txt is the only place the order lives. publish-handbook.sh compares tab
ORDER with panel ORDER - not the sets - so a section appended in the wrong
place is refused with a message in which every number looks correct. Generating
both from nav.txt means that can no longer happen.

The default section (the first one in the first group) is the one that renders
visible; `hidden` and the two `on` markers are applied here, not stored in the
sources, so "exactly one visible panel" is not something a hand edit can break.
"""
import io, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, os.pardir, 'minecraft-server-guide.html')
CR = '\r\n'

NAV_MARK = '<!--BUILD:NAV-->'
PANELS_MARK = '<!--BUILD:PANELS-->'
STATS_BEGIN = '/* SERVER-STATS-DATA-BEGIN */'
STATS_END = '/* SERVER-STATS-DATA-END */'

# Sections are glued with a single newline, which is what the page has always
# had. Keep it: changing it makes every future build diff start with a wall of
# whitespace noise that hides the real change.
SEP = CR


def read(path):
    return io.open(path, encoding='utf-8', newline='').read()


def parse_nav(text):
    """nav.txt: a flush-left line is a group, indented lines are `id  Label`."""
    groups, cur = [], None
    for raw in text.split('\n'):
        line = raw.rstrip('\r')
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        if line[0].isspace():
            assert cur is not None, 'a section appears before any group: %r' % line
            parts = line.strip().split(None, 1)
            assert len(parts) == 2, 'a section needs an id and a label: %r' % line
            sid, label = parts
            assert re.match(r'^[a-z]+$', sid), 'section ids are lowercase letters: %r' % sid
            cur[1].append((sid, label))
        else:
            cur = (line.strip(), [])
            groups.append(cur)
    assert groups, 'nav.txt lists no groups'
    assert groups[0][1], 'the first group has no sections, so there is no default'
    return groups


def slug(name):
    return re.sub(r'[^a-z]+', '-', name.replace('&amp;', 'and').lower()).strip('-')


def build_nav(groups, default):
    out = ['    <nav class="booknav">\n']
    for gi, (gname, items) in enumerate(groups):
        gid = 'navhead-' + slug(gname)
        out.append('      <div class="navgroup%s">\n' % (' on' if gi == 0 else ''))
        out.append('        <h2 class="navhead" id="%s">%s</h2>\n' % (gid, gname))
        out.append('        <div class="navlist" role="tablist" aria-orientation="vertical"'
                   ' aria-labelledby="%s">\n' % gid)
        for sid, label in items:
            on = ' class="on"' if sid == default else ''
            sel = 'true' if sid == default else 'false'
            out.append('          <button%s id="tab-%s" role="tab" aria-controls="panel-%s"'
                       ' aria-selected="%s">%s</button>\n' % (on, sid, sid, sel, label))
        out.append('        </div>\n      </div>\n')
    out.append('    </nav>')
    return ''.join(out).replace('\n', CR)


def build_panels(groups, default):
    blocks = []
    for _, items in groups:
        for sid, _label in items:
            path = os.path.join(HERE, 'sections', '%s.html' % sid)
            assert os.path.exists(path), 'nav.txt lists %s but %s does not exist' % (sid, path)
            s = read(path).rstrip(CR).rstrip('\n')
            # Anchored on the section tag itself, NOT on the first '>' in the
            # file: a section starts with a banner comment, so splitting on the
            # first '>' put `hidden` inside the comment and left every panel
            # visible.
            tag = re.compile(r'(<section class="panel" id="panel-%s"[^>]*?)(\s*>)' % sid)
            assert len(tag.findall(s)) == 1, \
                '%s.html does not contain exactly one panel-%s section tag' % (sid, sid)
            assert ' hidden' not in tag.search(s).group(1), \
                '%s.html stores a hidden attribute; build.py owns that' % sid
            if sid != default:
                s = tag.sub(lambda m: m.group(1) + ' hidden' + m.group(2), s, count=1)
            blocks.append(s)
    return SEP.join(blocks)


def carry_forward(page, previous):
    """Transplant the things other scripts write into the built file."""
    notes = []
    if previous:
        m = re.search(re.escape(STATS_BEGIN) + r'(.*?)' + re.escape(STATS_END),
                      previous, re.S)
        if m:
            page, n = re.subn(re.escape(STATS_BEGIN) + r'.*?' + re.escape(STATS_END),
                              lambda _: STATS_BEGIN + m.group(1) + STATS_END,
                              page, count=1, flags=re.S)
            assert n == 1, 'the shell has no SERVER-STATS-DATA block to carry into'
            notes.append('stats payload carried forward (%d bytes)' % len(m.group(1)))
        live = re.search(r'class="jarcount">(\d+)<', previous)
        if live:
            page, n = re.subn(r'(class="jarcount">)\d+(<)',
                              r'\g<1>%s\g<2>' % live.group(1), page)
            notes.append('jar count carried forward (%s, %d places)' % (live.group(1), n))
    return page, notes


def check_structure(page, groups):
    order = [sid for _, items in groups for sid, _ in items]
    tabs = re.findall(r'id="tab-([a-z]+)"[^>]*aria-controls="panel-\1"', page)
    panels = re.findall(r'<section class="panel" id="panel-([a-z]+)"', page)
    visible = len(re.findall(r'class="panel"(?![^>]*hidden)', page))
    problems = []
    if tabs != order:
        problems.append('tab order %s != nav.txt %s' % (tabs, order))
    if panels != order:
        problems.append('panel order %s != nav.txt %s' % (panels, order))
    if visible != 1:
        problems.append('%d visible panels, expected 1' % visible)
    if 'class="jarcount"' not in page:
        problems.append('no jarcount markers - sync-handbook-counts.sh would find nothing')
    for mark in (NAV_MARK, PANELS_MARK):
        if mark in page:
            problems.append('%s was not substituted' % mark)
    return problems


def main():
    check_only = '--check' in sys.argv[1:]
    groups = parse_nav(read(os.path.join(HERE, 'nav.txt')))
    default = groups[0][1][0][0]
    shell = read(os.path.join(HERE, 'shell.html'))
    assert shell.count(NAV_MARK) == 1 and shell.count(PANELS_MARK) == 1, \
        'shell.html must contain %s and %s exactly once each' % (NAV_MARK, PANELS_MARK)

    page = shell.replace(NAV_MARK, build_nav(groups, default))
    page = page.replace(PANELS_MARK, build_panels(groups, default))

    previous = read(OUT) if os.path.exists(OUT) else ''
    page, notes = carry_forward(page, previous)

    problems = check_structure(page, groups)
    if problems:
        print('BUILD IS STRUCTURALLY BROKEN:')
        for p in problems:
            print('  %s' % p)
        return 1

    n = sum(len(items) for _, items in groups)
    if check_only:
        if page == previous:
            print('up to date: %d groups, %d sections' % (len(groups), n))
            return 0
        print('OUT OF DATE: minecraft-server-guide.html does not match the sources.')
        print('Run: python handbook/build.py')
        return 1

    for note in notes:
        print('  %s' % note)
    if page == previous:
        print('no change: %d groups, %d sections, %d bytes' % (len(groups), n, len(page)))
        return 0
    io.open(OUT, 'w', encoding='utf-8', newline='').write(page)
    print('built %d groups, %d sections, %d bytes (was %d), default section "%s"'
          % (len(groups), n, len(page), len(previous), default))
    return 0


if __name__ == '__main__':
    sys.exit(main())
