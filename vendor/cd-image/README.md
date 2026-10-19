# vendor/cd-image

What [`../../make-cd-image.html`](../../make-cd-image.html) draws with. The tool it was
ported from fetched all of this from an image host and a Dropbox share at run time; here it
is in the repo, so a link going stale cannot turn every cover made afterwards into a black
circle set in a fallback sans.

## The scans

| File | Was | What it is |
| --- | --- | --- |
| `cd.png` | https://i.ibb.co/wZVNfHxH/cd.png | the disc, used as the mask that gives it its edges and centre hole |
| `case.png` | https://i.ibb.co/0jrDZsNw/overlay2.png | the glossy case layer, mixed with the blend mode the page offers |
| `plastic.png` | https://i.ibb.co/BHScw0Fb/overlay.png | the plastic, laid flat over the top |
| `tape.png` | https://i.ibb.co/LhD935Sk/tape.png | the strip of tape, tintable |

Note the rename: the original's `overlay.png` is the plastic and `overlay2.png` is the case,
which is the sort of pairing you only get to work out once.

## The faces

`fonts/`, twenty-six of them, named below as the page lists them. Each was a
`dl.dropboxusercontent.com` link in the original's `@font-face` block; the share id and key
are kept so a missing one can be fetched again.

| Face | File | Source |
| --- | --- | --- |
| Another | `fonts/Another_.ttf` | <https://dl.dropboxusercontent.com/scl/fi/rbzmyung3mwewj5v96gbj/Another_.ttf?rlkey=vznfwz7ekicwg7f6u87xx9uqb&raw=1> |
| Berosong | `fonts/Berosong-Regular.ttf` | <https://dl.dropboxusercontent.com/scl/fi/z0k2ykup98ga0sum6ot90/Berosong-Regular.ttf?rlkey=2yksbm5fxylukj9gbg1y0i7ox&raw=1> |
| Bitmgothic | `fonts/Bitmgothic.otf` | <https://dl.dropboxusercontent.com/scl/fi/f8b6a2gap9sbebuacx6m5/Bitmgothic.otf?rlkey=jgw3edjvd59z0xmtcyw1a39yn&raw=1> |
| Black Takora | `fonts/BlackTakora-Regular.ttf` | <https://dl.dropboxusercontent.com/scl/fi/pqalgp3x6m0byi7zjk9ah/BlackTakora-Regular.ttf?rlkey=gypefiouizptkgczh4dhwig8e&raw=1> |
| Blackout Oldskull | `fonts/BlackoutOldskull.ttf` | <https://dl.dropboxusercontent.com/scl/fi/ms4pjvtftzglj0ygjfop9/BlackoutOldskull.ttf?rlkey=xy0dwlbv52am02mn8r7ch6xpm&raw=1> |
| Brush Story | `fonts/BrushStory.ttf` | <https://dl.dropboxusercontent.com/scl/fi/1l6qcrisyatifkmos91cx/BrushStory.ttf?rlkey=1nm35yo36phhtmokajwzl2tu9&raw=1> |
| Children | `fonts/Children.ttf` | <https://dl.dropboxusercontent.com/scl/fi/bkyd4bek72rjk7rty5qog/Children.ttf?rlkey=ovednpombtfwxxcoo5xxz78td&raw=1> |
| Festival Valentine | `fonts/Festival-Valentine.otf` | <https://dl.dropboxusercontent.com/scl/fi/4p9poiy1a75dyr0h2sv9d/Festival-Valentine.otf?rlkey=8nj3kqn6vwr1y5k6829fbg9gz&raw=1> |
| Flaster | `fonts/FLASTER.ttf` | <https://dl.dropboxusercontent.com/scl/fi/ooxhjftck3i2ugpnism49/FLASTER.ttf?rlkey=u6h5b11a8f4mjinqcexrtd4m0&raw=1> |
| Flunkies BB | `fonts/FlunkiesBB.otf` | <https://dl.dropboxusercontent.com/scl/fi/1akba6wqyq5cncwggjbw5/FlunkiesBB.otf?rlkey=gmq9j1x5ddlslnz74jawf3z7w&raw=1> |
| Higher Jump | `fonts/Higher-Jump.ttf` | <https://dl.dropboxusercontent.com/scl/fi/th8abgip6zsadcdxpov7z/Higher-Jump.ttf?rlkey=mp81fpeaw27enqyyuqdjophrg&raw=1> |
| Holitter Gothic | `fonts/Holitter_Gothic.ttf` | <https://dl.dropboxusercontent.com/scl/fi/429etziebim647mc6l1/Holitter_Gothic.ttf?rlkey=2nvdpg1vhylruya1ztimk9otk&raw=1> |
| Jawarde | `fonts/Jawarde.ttf` | <https://dl.dropboxusercontent.com/scl/fi/aocl6itmadd3zpnn3id2u/Jawarde.ttf?rlkey=q6lapc74blvnv1nw7buwrt50k&raw=1> |
| KALOOT | `fonts/KALOOT.ttf` | <https://dl.dropboxusercontent.com/scl/fi/6i999rqtbt1h4ky4tvuld/KALOOT.ttf?rlkey=8xcawla5rzw8f5f9a0kqjn5sg&raw=1> |
| Kind Handwriting | `fonts/Kind-Handwriting.ttf` | <https://dl.dropboxusercontent.com/scl/fi/zmo16f70jgvj325relsha/Kind-Handwriting.ttf?rlkey=pbc2oka5jbm114ann2pplr2j8&raw=1> |
| League Gothic | `fonts/LeagueGothic-Regular.otf` | <https://dl.dropboxusercontent.com/scl/fi/u592wpkq4pe2agctmvbor/LeagueGothic-Regular.otf?rlkey=q55hcwtzm0dd8ft88qm98jn&raw=1> |
| Peppermint Pen | `fonts/Peppermint-Pen.otf` | <https://dl.dropboxusercontent.com/scl/fi/77pb6doh738qtbwavfta9/Peppermint-Pen.otf?rlkey=8r3xetfl6g9v39q51sx5kfi6g&raw=1> |
| Permanent Marker | `fonts/PermanentMarker.ttf` | <https://dl.dropboxusercontent.com/scl/fi/0h22s5rrybn6b4pv890nn/PermanentMarker.ttf?rlkey=mler26y1ij9ypida7bgeykqb7&raw=1> |
| Roasted Ketchup | `fonts/Roasted-Ketchup.ttf` | <https://dl.dropboxusercontent.com/scl/fi/ylxjswo2795ou8q9pdkt/Roasted-Ketchup.ttf?rlkey=rvhrh98i94p7lx2xe0nrvbavz&raw=1> |
| Saphifen | `fonts/Saphifen.ttf` | <https://dl.dropboxusercontent.com/scl/fi/ha53v2xjtqubtmi243knj/Saphifen.ttf?rlkey=1jy907his4s7w78e1h1xl01cq&raw=1> |
| Sevarothz | `fonts/Sevarothz.ttf` | <https://dl.dropboxusercontent.com/scl/fi/xmuk88rxa9cyduu5oa2fb/Sevarothz.ttf?rlkey=3urrsyg7rynfr7bejrqs361cv&raw=1> |
| Sketch Gothic | `fonts/Sketch-Gothic-School.ttf` | <https://dl.dropboxusercontent.com/scl/fi/mj56i2jsuu43385w4hw5c/Sketch-Gothic-School.ttf?rlkey=3d2lk04j06a4v6xfobxybpxww&raw=1> |
| Smiley | `fonts/Smiley.ttf` | <https://dl.dropboxusercontent.com/scl/fi/h70qd62lobienxt7w21q0/Smiley.ttf?rlkey=ptoec991g2jiqu78c3mg0d910&raw=1> |
| Stylish Marker | `fonts/Stylish-Marker-demo.ttf` | <https://dl.dropboxusercontent.com/scl/fi/aj8h7h0sr9a8u24aym6yz/Stylish-Marker-demo.ttf?rlkey=pnvgsyt78g2cgspsmsy2rvn90&raw=1> |
| Sunny Brush | `fonts/Sunny-Brush.ttf` | <https://dl.dropboxusercontent.com/scl/fi/n7pk5akyxi3ukhthhspl4/Sunny-Brush.ttf?rlkey=cu8wpneop8ujc0l51ajvxwhjf&raw=1> |
| Ye Olde Oak | `fonts/Ye-Olde-Oak.ttf` | <https://dl.dropboxusercontent.com/scl/fi/todur3erqwb867uigg89c/Ye-Olde-Oak.ttf?rlkey=jt33vs1tt0q67sudnibgojtsw&raw=1> |

Five more faces are offered in the page and are not here, because they come from whatever
machine is looking at it: Arial, Impact, Courier New, Georgia and Verdana.

## Licences

These are third-party faces gathered for one person's own covers, and the repo is public.
Redistribution terms vary by foundry and none are recorded here; check each before leaning
on it for anything beyond personal use.
