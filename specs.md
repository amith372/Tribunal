# The Tribunal — Specification

> **This file = *what* to build**, written as prose in five parts (per the course's specification standard). It is the source of truth and wins if it and `CLAUDE.md` ever disagree on behavior.
> **Any change to this file must be logged in `spec_logs.md` in the same step** — under a header for the actual current date, stating what changed, why, and which Part. An edit here without that entry is an incomplete edit.

## Part 1 — Goal and reason

The Tribunal is a web app that puts a fictional character on trial. The user writes a charge sheet that names the accused, chooses which of five Game-of-Thrones characters is the defendant, and then casts the other four — two to defend and two to prosecute — on a Side Select screen where each side holds exactly two. Each advocate makes a single statement, in its own voice, arguing its assigned side. Three fixed judges, modelled on real Israeli Supreme Court presidents, then each read the charge sheet and all four statements and return a verdict of guilty or not guilty with their reasoning. The app shows the three verdicts, the majority verdict, and the tokens and price the run spent. As each advocate's statement arrives its avatar moves from idle to thinking to happy; once the four are done the judges deliberate behind loading gavels; the results then appear as five swipeable panels — the final verdict, the three judges (tap to expand reasoning), the four advocates with their side, the token-and-price breakdown, and a closing summary slide. A finished run can be exported as a single self-contained HTML file.

**The reason we are building it** is to see how real judicial temperaments would judge a fictional case, and how different characters' statements change the verdict; when an unwritten decision arises, resolve it toward making that comparison clear and honest. (As a class project, also resolve toward showing the specification and how we verify the AI.)

The decisions that shape it, each a judgement rather than a recipe:

- Advocates each speak once; there is no debate, and no advocate sees another's statement.
- Everyone reasons only from the charge sheet, the provided character and judge facts, and — for judges — the four statements. Personas set voice and values, never facts, and no outside knowledge of the characters may enter. A needed-but-missing fact is labelled an assumption, never asserted as true.
- The defendant is one of the five characters and the four advocates are the other four; the defendant is never also an advocate.
- **The user casts the sides.** Which two advocates prosecute and which two defend is a deliberate choice the user makes, not one the app assigns — who argues which side is exactly what a run is testing. The Side Select screen holds each side to two, so an invalid split is hard even to express; the server still checks the split independently of what the screen allowed.
- The five characters' descriptions, their relations, and the three judges' personas come from three provided data files and are the only source of character facts. Those files describe *standing relationships*; the charge sheet supplies *what happened*. The two are kept apart, because a data file that states the alleged act as fact would decide the trial before it runs.
- **The charge sheet must name the defendant.** A charge sheet that never mentions the accused leaves the advocates nothing to argue about and would have them invent the case. The match is case-insensitive and on whole words, against the character's given and used names — "Dany" counts for Daenerys — but never against a shared surname: "Lannister" fits Tyrion and Cersei, and "Targaryen" fits Daenerys and the hidden-heir Jon, so a name that cannot identify one character is no evidence the sheet is about them.
- Only free OpenRouter models are used, so a run costs no money. The user toggles between one model for all seven roles and a different model per role — that toggle chooses the **mode only**. The model identifiers themselves are chosen by the developer and live server-side; they are never editable in the app, the browser never sends one, and no request may introduce one. Because the free roster rotates, the identifiers are re-verified before a demo and are changeable without a code change. Current defaults, each confirmed live and free: one-model mode uses `nvidia/nemotron-3-ultra-550b-a55b:free` for all seven roles; per-role mode draws its judges from `nvidia/nemotron-3-ultra-550b-a55b:free`, `google/gemma-4-31b-it:free` and `nvidia/nemotron-3-super-120b-a12b:free`, and its advocates from `openai/gpt-oss-20b:free`, `google/gemma-4-26b-a4b-it:free`, `dots-studio/dots-3-note-preview:free` and `nvidia/nemotron-3-nano-30b-a3b:free`.
- **Models are shuffled within their pool on every run.** A fixed role-to-model mapping would confound persona with model capability — if one judge always ran on the largest model, any difference in its verdicts might be the model rather than the judicial temperament, which is the very comparison the app exists to make. Judges keep the stronger pool and advocates the smaller one, since handing a judge a small model would trade one bias for a worse one; within each pool the assignment is random per run, and the results always report which model actually served each role.
- Sizes are held: the charge sheet is between 10 and 200 words — a floor as well as a ceiling, because a one-word sheet can name the defendant and pass every other check while leaving the advocates nothing to argue from but invention — each advocate statement at most 120, and each judge's verdict-and-reasoning at most 100.
- Before any model call, the app confirms the run is valid — the defendant is one of the five characters in `characters.md` (a character that is not in the story cannot be the defendant), the defendant is named in the charge sheet, the four advocates are the other characters split two-for and two-against, the defendant is not among them, and the charge sheet is present, within length, and actually states a charge or asks a question rather than only describing a scene — and refuses an invalid run before spending a single call. It reports every fault it finds at once rather than the first, each saying what is wrong and what to do about it, so a bad setup costs the user one correction and not four. This is a cheap structural check (a roster lookup and a name match), not a model call.
- The app is in English throughout. It is designed desktop-first and stays usable down to a phone: the result panels advance by on-screen arrows and by keyboard, and by swipe on touch. One thematic visual identity carries every screen — warm browns and stone, serif display type for headings and verdicts, rounded character tiles, subtle texture — built on shared design tokens so no screen drifts from the others, and using the project's own avatar art.

## Part 2 — Testable success criteria

Each has one true-or-false answer anyone can check:

- Every completed run shows exactly four statements — two for, two against — and three verdicts.
- The final verdict equals the majority of the three shown verdicts (3–0 or 2–1). If a judge fails, the result reads Hung (1–1) or Inconclusive, and no verdict is invented.
- Each judge shows exactly one verdict, guilty or not guilty, and reasoning that gives at least two distinct reasons.
- The token total on the results panel equals the per-call token numbers added up, and the price reads $0 while only free models are used.
- The defendant never appears among the four advocates.
- No model call is made unless the defendant is one of the five characters in `characters.md` and the setup is valid; an invalid setup is refused with a message and zero calls spent.
- A charge sheet that never names the chosen defendant is refused before any model call, and the refusal states which names were searched for, so the user can see why it failed rather than guess.
- A charge sheet shorter than 10 words or longer than 200 cannot be submitted, and every statement and judge reply stays within its word limit.
- A charge sheet that names the defendant but accuses them of nothing and asks nothing is refused before any model call, with a refusal that says what was missing.
- Every model call in a run used a model on the app's free allowlist. A request naming any other model is ignored, and there is no field, setting, or environment variable by which a run can be made to use a paid model.
- A finished run exports as one HTML file that opens from disk with no server and no network, carrying the charge sheet, the casting, the four statements, the three verdicts with reasoning, the per-call model/token/price table and the raw model responses — and its numbers match what the app showed.

## Part 3 — Architectural guidance

The backend holds the OpenRouter key and every prompt, and the browser never sees them; reach all models through a single OpenRouter client, which is also the one place the free-model rule is enforced. Read the character, relation, and judge facts from the three data files and treat them as the only character facts.

**There is no database; the exported HTML file is the run record.** A single user on a private URL never browses past runs, so a remote store earns nothing — but the audit trail still matters, since it is what shows the token numbers are real and the verdicts were read from the models rather than invented. So instead of a table that has to survive redeploys, each run produces a self-contained document carrying the charge sheet, the casting, the four statements, the three verdicts and their reasoning, the per-call breakdown of model, tokens, price and time, and the raw model responses. It is a file the user keeps and can submit, and it records an incomplete run honestly rather than hiding it.

Keep the pipeline stages as plain functions the routing layer calls, so each can be tested without a running server. Leave the file layout, the function shapes, and the export's internal structure to the agent.

## Part 4 — Validation approach

Before building, commit one known case and check the finished build against it by hand.

The case: **Jon Snow, charged with regicide and treason for assassinating Queen Daenerys Targaryen.** Jon is the defendant; the other four are the advocates — Tyrion and Cersei defend him (Cersei because his act removed her rival), while Daenerys and Grey Worm prosecute. Running this case, confirm by eye that: the pre-flight passes (Jon is a story character, he is named in the charge sheet, the split is two-for and two-against, and the defendant is not among the advocates); four statements appear, each on its assigned side; three verdicts appear, each guilty or not guilty with at least two reasons; the shown majority equals the count of the three verdicts; and the token total equals the per-call numbers summed, with a price of $0. Then export the run, open the downloaded file from disk with the server stopped, and confirm it renders completely on its own and its numbers match the panels.

Then run the deliberately invalid cases and confirm each is refused before a single model call: a defendant who is not in the story; a three-to-one split; and a charge sheet that never names the character chosen as defendant.

## Part 5 — Known pitfalls

Warnings to build against, each written once:

- A judge may return prose instead of the required form — read the verdict from the text, retry the call once, and only then mark it an error; never invent a verdict.
- A model call may time out, and a free model may be rate-limited (a 429) or delisted without notice — send a small fallback list of free models per call, retry another on failure, and keep partial results.
- **The free roster rotates, sometimes weekly.** Identifiers that were live when written have since disappeared entirely, so they are re-checked before a demo and are changeable without touching code. Every fallback chain ends at OpenRouter's own free router, so a mid-run delisting degrades a run instead of killing it — and because that router resolves to a different model at call time, the results report the model named in the response, never the one requested.
- A charge sheet may lack its actual question — the advocates must not invent the charge; the pre-flight and the prompts should surface a missing question rather than guess around it.
- A free model may ignore the word limit — cap it with a token limit set above the word count so a judge's reply never truncates mid-form.
- **A reasoning model spends tokens before it answers.** The strongest free models think at length by default, which slows the run, inflates the token count, and eats the very ceiling the point above sets — a reply budgeted for a hundred words can still truncate mid-form because the thinking consumed the budget first. So reasoning is asked for at low effort and its text is kept out of what comes back, leaving the answer alone to be read. The reasoning tokens the API reports are still counted and shown, because they were really spent.
- A defendant may be chosen who is not in the story, an invalid for-against split may be set, or the charge sheet may never name the accused — the pre-flight refuses the run before any call is spent, and refuses it on the server even where the screen would not have allowed it.
- A single judge failing can leave a one-to-one result — show Hung or Inconclusive rather than forcing a verdict.
- **A model field the user can edit is a cost hole, not a convenience.** Anyone holding the URL could type a paid identifier and spend against the owner's key, and the app has no login to stop them. The identifiers stay server-side, and the free rule is enforced where the call is made rather than where it is requested.
