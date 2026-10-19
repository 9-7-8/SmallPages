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

| Face | File | Dropbox `scl/fi/…` | `rlkey` |
| --- | --- | --- | --- |
| Another | `fonts/Another_.ttf` | `rbzmyung3mwewj5v96gbj` | `vznfwz7ekicwg7f6u87xx9uqb` |
| Berosong | `fonts/Berosong-Regular.ttf` | `z0k2ykup98ga0sum6ot90` | `2yksbm5fxylukj9gbg1y0i7ox` |
| Bitmgothic | `fonts/Bitmgothic.otf` | `f8b6a2gap9sbebuacx6m5` | `jgw3edjvd59z0xmtcyw1a39yn` |
| Black Takora | `fonts/BlackTakora-Regular.ttf` | `pqalgp3x6m0byi7zjk9ah` | `gypefiouizptkgczh4dhwig8e` |
| Blackout Oldskull | `fonts/BlackoutOldskull.ttf` | `ms4pjvtftzglj0ygjfop9` | `xy0dwlbv52am02mn8r7ch6xpm` |
| Brush Story | `fonts/BrushStory.ttf` | `1l6qcrisyatifkmos91cx` | `1nm35yo36phhtmokajwzl2tu9` |
| Children | `fonts/Children.ttf` | `bkyd4bek72rjk7rty5qog` | `ovednpombtfwxxcoo5xxz78td` |
| Festival Valentine | `fonts/Festival-Valentine.otf` | `4p9poiy1a75dyr0h2sv9d` | `8nj3kqn6vwr1y5k6829fbg9gz` |
| Flaster | `fonts/FLASTER.ttf` | `ooxhjftck3i2ugpnism49` | `u6h5b11a8f4mjinqcexrtd4m0` |
| Flunkies BB | `fonts/FlunkiesBB.otf` | `1akba6wqyq5cncwggjbw5` | `gmq9j1x5ddlslnz74jawf3z7w` |
| Higher Jump | `fonts/Higher-Jump.ttf` | `th8abgip6zsadcdxpov7z` | `mp81fpeaw27enqyyuqdjophrg` |
| Holitter Gothic | `fonts/Holitter_Gothic.ttf` | `429etziebim647mc6l1` | `2nvdpg1vhylruya1ztimk9otk` |
| Jawarde | `fonts/Jawarde.ttf` | `aocl6itmadd3zpnn3id2u` | `q6lapc74blvnv1nw7buwrt50k` |
| KALOOT | `fonts/KALOOT.ttf` | `6i999rqtbt1h4ky4tvuld` | `8xcawla5rzw8f5f9a0kqjn5sg` |
| Kind Handwriting | `fonts/Kind-Handwriting.ttf` | `zmo16f70jgvj325relsha` | `pbc2oka5jbm114ann2pplr2j8` |
| League Gothic | `fonts/LeagueGothic-Regular.otf` | `u592wpkq4pe2agctmvbor` | `q55hcwtzm0dd8ft88qm98jn` |
| Peppermint Pen | `fonts/Peppermint-Pen.otf` | `77pb6doh738qtbwavfta9` | `8r3xetfl6g9v39q51sx5kfi6g` |
| Permanent Marker | `fonts/PermanentMarker.ttf` | `0h22s5rrybn6b4pv890nn` | `mler26y1ij9ypida7bgeykqb7` |
| Roasted Ketchup | `fonts/Roasted-Ketchup.ttf` | `ylxjswo2795ou8q9pdkt` | `rvhrh98i94p7lx2xe0nrvbavz` |
| Saphifen | `fonts/Saphifen.ttf` | `ha53v2xjtqubtmi243knj` | `1jy907his4s7w78e1h1xl01cq` |
| Sevarothz | `fonts/Sevarothz.ttf` | `xmuk88rxa9cyduu5oa2fb` | `3urrsyg7rynfr7bejrqs361cv` |
| Sketch Gothic | `fonts/Sketch-Gothic-School.ttf` | `mj56i2jsuu43385w4hw5c` | `3d2lk04j06a4v6xfobxybpxww` |
| Smiley | `fonts/Smiley.ttf` | `h70qd62lobienxt7w21q0` | `ptoec991g2jiqu78c3mg0d910` |
| Stylish Marker | `fonts/Stylish-Marker-demo.ttf` | `aj8h7h0sr9a8u24aym6yz` | `pnvgsyt78g2cgspsmsy2rvn90` |
| Sunny Brush | `fonts/Sunny-Brush.ttf` | `n7pk5akyxi3ukhthhspl4` | `cu8wpneop8ujc0l51ajvxwhjf` |
| Ye Olde Oak | `fonts/Ye-Olde-Oak.ttf` | `todur3erqwb867uigg89c` | `jt33vs1tt0q67sudnibgojtsw` |

Five more faces are offered in the page and are not here, because they come from whatever
machine is looking at it: Arial, Impact, Courier New, Georgia and Verdana.

## Licences

These are third-party faces gathered for one person's own covers, and the repo is public.
Redistribution terms vary by foundry and none are recorded here; check each before leaning
on it for anything beyond personal use.
