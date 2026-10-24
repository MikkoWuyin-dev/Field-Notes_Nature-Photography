# The Fieldnotes Report — explained plainly

*The same findings as `AUDIT.md`, but written so anyone can follow it. Nothing here is
dumbed down — just said without jargon.*

---

## First, what is this thing?

Fieldnotes is a website that teaches nature photography. It's a plan for **32 weeks**:
start with the camera you already own, learn the basics, practise in the field, and finish
with a small portfolio you're proud of. It has **9 stages**, **25 learning cards**, and
links to **16 free resources** other people made.

It also remembers what you've finished, counts your practice streak, and can nudge you at
7pm so you don't forget to go outside.

The unusual part: the entire website is **one single file**. No folders of pictures, no
other programs it depends on. One file, like one very long piece of paper.

---

## The big picture

Imagine you're building a treehouse. When I looked at this one, the tree was solid and the
floor was strong — genuinely well built. But half the treehouse was full of toys, the
ladder was missing (so you could only get up if you happened to have a key), and the labels
on the boxes were written in pencil where they could smudge.

That's the honest summary. **It wasn't sloppy — it was just all packed tightly together.**

---

## The three big problems (now fixed)

### 1. If you turned off JavaScript, the website disappeared

JavaScript is the code that makes a page *do* things. The Fieldnotes page used it for
everything — including *showing the lessons themselves*.

That's like a vending machine that only shows you the snacks after you pay. If the code was
blocked (some schools and offices block it, some old phones choke on it), you'd see the
welcome banner and… mostly empty space. A search engine would see the same nothing.

**What I did:** I wrote a small tool that builds a **plain-text version** of the whole
course — all 9 stages, all 25 cards, all 16 links — and tucks it into the page. It only
appears when JavaScript is off. The tool reads the same course data, so the two versions
can't slowly drift apart. There's even a command that complains if they ever disagree.

### 2. The website saved your progress by *position*, which is fragile

You know how you save your place in a book by remembering "page 47"? Now imagine someone
slips three new pages in near the front. Page 47 is a *different* spot now. You didn't do
anything wrong — your bookmark just quietly became wrong.

That's exactly how progress was saved: "stage 2, card 3." If a card was ever added or moved,
everyone's checkmarks would silently slide onto the wrong lessons.

**What I did:** I gave every stage and every card a **name tag** instead of a number
(`chris-brays-10-part-photography-course-videos` rather than `s0-r0`). Name tags don't move
when the list is rearranged.

Then I wrote a translation step, because some people already have checkmarks saved the old
way. When the page opens, it reads old-style bookmarks and quietly converts them. **People's
progress carries over — they don't have to do anything.** I tested this: three old-style
checkmarks went in, three correct checkmarks came out.

### 3. Almost half the file was cartoon decoration — and it loaded first

There are eight tiny pixel creatures in the page called "pals." They wander around, sit on
headings, and look cute. Someone else made that engine; it's a good one.

It was **83 KB of the 179 KB file** — about 46%, or nearly half. And it ran *before* the
lessons did. On a slow phone connection, that's like unloading a box of toys before you
unlock the front door.

**What I did:** the toys now sit in a box by the door. They come out when the page is idle
(or the instant you ask for them), never before the lessons. I checked that all eight still
appear — just later, and only after the important part is on screen.

---

## The smaller problems I fixed

**A leftover scrap from a stranger.** The file had a small script in it that belonged to
Cloudflare (a company that speeds up websites). It was copied in by accident, did nothing
useful here, and tried to load a file that doesn't exist. Deleted. Like finding a receipt
from a shop you never visited at the bottom of your bag.

**Text that was hard to read.** I did the maths on every colour combination, using the
standard formula for "can people actually read this." Two pairs failed the standard —
blue text on cream paper, and the intro sentence on the blue banner. They're a bit darker
and brighter now: **4.32 → 5.8** and **4.25 → 4.58** (the standard is 4.5, and higher is
easier to read). The rest were fine, some very fine.

**Buttons too small for thumbs.** Three buttons — including the checkmark you tap to mark a
lesson done, which is *the* thing you do on a phone — were 38 pixels tall. The guidelines
say 44. They're 44 now.

**A table of contents that skipped a number.** Headings went h1, h2, h3… then jumped
straight to h5. Screen readers (the software blind people use, which reads pages aloud and
can jump between headings like a table of contents) got confused. There's a real h4 in
there now, so the list counts up properly.

**No little icon in the browser tab.** Now there's one, drawn right into the file so it
costs no extra download.

**No preview when you share the link.** There are now proper title-and-description tags for
social media, plus a machine-readable description that helps search engines understand the
page is a free course.

**No instructions for whoever edits this next.** Now there's a `README.md`: what each file
is, how to change the lessons, and the single most important rule — **never rename a card's
name tag**, because that's what someone's saved progress is attached to.

**No way to check you didn't break anything.** Now there's a test that opens the real page
in a pretend browser and pokes at it **38 times**: does it show 25 cards? Does checking one
move the counter to "1 of 25"? Does search find 7 results for "wildlife"? Does an old saved
file still import? You run it with `npm test`; it takes about 4 seconds.

**Ugly printing, sloppy inputs, dead code.** The page now prints nicely in black and white
with the web addresses spelled out. It rejects impossible dates (30 February) and impossible
times (99:99). And I removed two bits of code that did nothing at all.

---

## Two things I chose *not* to change, and why

**I left the saved-progress storage name alone.** It's oddly named (`rll-roadmap-progress…`),
but renaming it would mean everyone's existing progress stops being found. Not worth it to
tidy a label nobody sees.

**I didn't add a big security lock (a "CSP").** Because everything is inline in one file,
the lock would need a special exception to work — which makes it much weaker. It's better
done properly on the server when the site is published, and tested so it doesn't break the
"download my progress" button.

There's also one improvement I parked on purpose: a fancier responsive technique
("container queries"). The layout already stretches and shrinks smoothly on every screen
size, so rewiring working CSS for no visible gain seemed like a bad trade. Worth revisiting
if the course grows.

---

## Where it stands now

| | Before | After |
|---|---|---|
| File size (as sent over the internet) | 57.9 KB | 66.3 KB |
| Readable without JavaScript | no | **yes, all 25 cards** |
| Progress survives reordering cards | no | **yes** |
| Automatic checks | 0 | **38, all passing** |
| Decoration blocking the content | yes | **no** |
| Instructions for future editors | none | **README + audit** |

The file got about 8 KB bigger (compressed). That's the price of the readable without-
JavaScript version — a good trade, since it means the course works for everyone.

Everything is saved in small separate steps on the branch — six changes plus the audit —
so anyone can see exactly what happened and undo one thing without undoing the rest.

---

## What's still on the to-do list

- **Automatically run the checks** every time someone suggests a change (that's called CI —
  a robot that runs `npm test`). Not done yet.
- **Pick a licence.** Right now it doesn't say what others are allowed to do with the file.
  Only the owner can decide that.
- **Add the real web address** once the site has a home. There are two tags I deliberately
  left out rather than guess a URL — a wrong one is worse than none.
- **A picture for link previews.** Right now shared links show text only.
- **Delete a duplicate copy** of the installed helper tools that's taking 11 MB of disk but
  isn't part of the website.

---

## The one-sentence version

The Fieldnotes website was carefully built and honest about what it is — the problem was
that everything (lessons, decoration, code, styling) was packed into a single file in a way
that made the content depend on the decoration; it now shows its lessons without JavaScript,
remembers your progress by name instead of position, and comes with tests and instructions.
