# Tells

One entry per rule id of the scanner catalog. Each says what the tell looks like, how to fix it, and gives a before and after. An after never adds a fact the before lacks; where the fix needs one, it shows a placeholder in angle brackets, such as `<measured figure>`, for the writer to fill from a real source or to cut the claim. W = word or phrase, S = structure. Only S04, S05 and S07 may be kept after a reread, and `## Did` says why; every other hit gets rewritten.

## Word and phrase tells

### W01 inflated verb
Looks like: a grand verb where a small one is exact (leverage, utilize, delve, showcase, foster, empower, streamline, harness, unlock, elevate, embark, orchestrate, spearhead).
Fix: use the plain verb (use, look at, show, help, speed up, start, run).
- Before: The tool leverages your existing config to streamline setup.
- After: The tool reads your existing config, so setup takes fewer steps.

### W02 grand abstract word
Looks like: a big noun or adjective that points at nothing (tapestry, landscape, realm, journey, ecosystem, pivotal, crucial, robust, seamless, comprehensive, holistic, multifaceted).
Fix: name the concrete thing, or drop the word.
- Before: A robust, seamless journey through the payment landscape.
- After: Pay in <number of screens> screens; a failed payment <what happens>.

### W03 sales hype
Looks like: a claim of top rank with no number behind it (game-changer, cutting-edge, world-class, blazing fast, effortless, turnkey, industry-leading).
Fix: state the measurable fact. If there is none, cut the claim. Marketing positioning belongs to the marketer.
- Before: A blazing fast, game-changing import.
- After: Import handles <row count> rows in <measured seconds> seconds.

### W04 filler opener
Looks like: a phrase that announces a point before making it (it's worth noting that, when it comes to, needless to say, let's dive in, in today's fast-paced world, have you ever wondered).
Fix: delete the opener and start with the point.
- Before: It's worth noting that backups run at night.
- After: Backups run at night.

### W05 stacked hedge
Looks like: two softeners on one verb (might perhaps, could possibly, may potentially).
Fix: keep one hedge if the doubt is real; otherwise state it flatly and say what decides it.
- Before: This could possibly fail on older phones.
- After: This may fail on older phones. (If the cutoff is known: "This fails on phones older than <version>.")

### W06 chat residue
Looks like: text left over from a conversation: an offer, praise of the question, or a sign-off (hope this helps, let me know if, feel free to ask, great question, happy to help, as an AI, sure, here is).
Fix: delete it. A document answers; it does not chat. Put a real next step or contact in plain words if the reader needs one.
- Before: Great question! Here is the setup. Let me know if you need more.
- After: Setup: <the setup steps>. For more help: <the real contact>.

### W07 empty intensifier
Looks like: a word that adds force and no content (very, really, extremely, truly, highly, absolutely, literally, quite, genuinely).
Fix: delete it, or replace the phrase with a number or a stronger exact word.
- Before: The file is really very large.
- After: The file is <size>.

### W08 signpost or summary announcer
Looks like: a phrase that says what the text will do or just did (in conclusion, in summary, to sum up, in a nutshell, the key takeaway, as mentioned earlier, in this guide we will, without further ado).
Fix: cut it. Start the section with its first fact; end where the content ends.
- Before: In this guide we will show how to reset a password. In conclusion, resets are easy.
- After: To reset a password: <the real steps>.

## Structure tells

### S01 contrast
Looks like: "not X but Y", or "isn't X, it's Y", used to set up a claim by denying one nobody made.
Fix: state Y directly. A contrast stays only if readers really believed X.
- Before: This isn't a plugin, it's a platform.
- After: This is a platform.

### S02 dash-heavy paragraph
Looks like: more than two em dashes in one paragraph, each cutting off an aside.
Fix: split into sentences, or use commas and brackets for asides. Keep at most two.
- Before: The editor — fast, small — saves often — every minute — to disk.
- After: The editor is fast and small. It saves to disk every minute.

### S03 lists of three, repeated
Looks like: two or more "a, b, and c" runs in one paragraph, picked for rhythm rather than count.
Fix: keep the items that exist; use the true number. Turn a long run into a list.
- Before: It is fast, simple, and safe, and it works on Mac, Linux, and Windows.
- After: It is fast, simple and safe. It runs on Mac, Linux and Windows.

### S04 staged reveal
Looks like: a short question or colon tease that holds back the answer ("the result:", "here's the catch:", "the truth?").
Fix: write the answer as part of the sentence. Reread the hit; if the pause helps the reader, keep it and give the reason in `## Did`.
- Before: The catch? Uploads over 1 MiB are rejected.
- After: Uploads over 1 MiB are rejected.

### S05 one-line closer
Looks like: a short final line that repeats what the paragraph said ("in the end", "simply put", "and just like that", "so there you have it").
Fix: delete it. Reread the hit; keep the line only if it carries a step or fact the paragraph lacks.
- Before: ...then restart the app. And just like that, you're done.
- After: ...then restart the app.

### S06 bold-label list item
Looks like: list items that each open with a bold label and colon (`- **Speed:** ...`), turning prose into a pitch sheet.
Fix: write the item as a sentence that starts with its subject, or use a table if the data is a set of pairs. A bold label is fine for a defined term in a glossary.
- Before: `- **Speed:** loads in 2 seconds`
- After: `- It loads in 2 seconds.`

### S07 question asked and answered
Looks like: the author poses a question and answers it in the next breath ("Why does this matter? Because...").
Fix: write the answer as a statement. Reread the hit; in an FAQ the question is the heading, so keep it there.
- Before: Why does it matter? Because a stale cache shows old prices.
- After: A stale cache shows old prices.

### S08 flat rhythm
Looks like: four or more sentences in a row within three words of the same length, which reads as a drumbeat.
Fix: join two short ones, split one long one, and let the main point have the longest or shortest sentence.
- Before: The app opens fast. The menu is clean. The tools are simple. The help is nearby.
- After: The app opens fast and the menu is clean. The tools are simple, and the help is nearby.

### S09 emoji in heading or list
Looks like: an emoji at the front of a heading or list item as decoration.
Fix: remove it. Headings and items carry meaning in words; colour or an icon alone is never enough.
- Before: `## 🚀 Getting started`
- After: `## Getting started`
