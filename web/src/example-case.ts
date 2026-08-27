/**
 * The charge sheet behind the setup screen's "load the example" button.
 *
 * **It lives in its own module so the server suite can hold it against the canonical
 * text.** It used to sit inside `Setup.tsx`, where the comment beside it asserted it was
 * "the same text as the server's `PART_4_CHARGE_SHEET`" and nothing checked that it was.
 * The old reasoning — that a drifted copy costs a demo its wording, not its correctness —
 * undersold what the copy is for: specs.md Part 4 has the validation case run *from this
 * button*, so a sheet that drifted would have the by-hand validation checking the app
 * against text the spec never named. That is a correctness cost, not a cosmetic one.
 *
 * The two copies are still written independently, which is what makes the check worth
 * running: `example-case.test.ts` in the server suite fails if either is edited alone.
 * `.ts` rather than `.tsx` on purpose — the server's vitest has no JSX transform, so a
 * constant it needs to import cannot live in a component file.
 *
 * It is the canonical charge sheet in full — the act alleged, the agreed factual record,
 * and the question put to the tribunal — which is 243 of the 300 words allowed. The
 * record is the part that earns the length: an advocate handed only the act would have to
 * invent the circumstances around it, and inventing is the one thing an advocate may
 * never do.
 */
export const EXAMPLE_CASE = {
  defendantId: "jon-snow",
  chargeSheet:
    "Case T-001: The Realm v. Jon Snow. Accused: Jon Snow. Deceased: Daenerys Targaryen. " +
    "The act alleged is that Jon Snow intentionally killed Daenerys Targaryen, stabbing her " +
    "during a private meeting in the throne room after the fall of King's Landing. " +
    "The agreed factual record: King's Landing had surrendered \u2014 its bells rang and " +
    "organised resistance had ceased \u2014 and Daenerys then used Drogon against the streets " +
    "and the civilians in them, causing destruction on a vast scale. After the victory she " +
    "told her assembled forces that the campaign of liberation would continue beyond King's " +
    "Landing; Jon had seen the city and heard the speech. Tyrion Lannister renounced his " +
    "office as Hand and was imprisoned, having warned Jon that Daenerys would treat Jon's " +
    "sisters, and anyone else she regarded as an obstacle, as enemies. Jon asked her to " +
    "forgive Tyrion and to show mercy; she refused to let others choose what was good and " +
    "presented her own judgement as decisive. Daenerys was unarmed and was not attacking Jon " +
    "when he killed her. Jon used their intimacy to get close enough to strike, and he had " +
    "not convened a council, attempted detention, or sought a public surrender of power. " +
    "The question for judgment: was Jon Snow's intentional killing of Daenerys Targaryen " +
    "justified as the necessary defence of others and of the realm, given what he knew, the " +
    "scale of the threatened harm, the absence or presence of safer alternatives, and his " +
    "lack of formal authority?",
};
