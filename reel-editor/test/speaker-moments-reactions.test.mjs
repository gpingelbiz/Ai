import test from "node:test";
import assert from "node:assert/strict";
import { reactionsFor, reactionTailOut, candidateScore, resolveCandidate } from "../src/speaker-moments.mjs";

const ratings = { topic: 4, clarity: 4, payoff: 4, specificity: 4, delivery: 4, novelty: 4 };
const passage = { sourceId: "stage", in: 10, out: 20 };
const reaction = (id, start, end, extra = {}) => ({ id, sourceId: "stage", start, end, kind: "laughter", ...extra });

test("reactionsFor associates contained, end-overlapping and following spans with overlap seconds", () => {
  const rs = [reaction("inside", 12, 14), reaction("overlap", 19, 21), reaction("at-end", 20, 21), reaction("following", 22, 23), reaction("before", 8, 10), reaction("late", 22.001, 24), reaction("other", 12, 14, { sourceId: "other" }), reaction("invalid", NaN, 14), reaction("empty", 12, 12)];
  const associated = reactionsFor(passage, rs);
  assert.deepEqual(associated.contained.map((r) => [r.id, r.overlapSeconds]), [["inside", 2], ["overlap", 1]]);
  assert.deepEqual(associated.following.map((r) => [r.id, r.overlapSeconds]), [["at-end", 0], ["following", 0]]);
  assert.ok(!Object.hasOwn(rs[0], "overlapSeconds"));
  assert.deepEqual(reactionsFor(passage, [rs[4], rs[5], rs[6]]), { contained: [], following: [] });
  assert.deepEqual(reactionsFor({}), { contained: [], following: [] });
  assert.equal(reactionsFor({ source_id: "stage", start: 10, end: 20 }, [rs[0]]).contained.length, 1);
});

test("contained verified reactions earn five points once; unverified and other-source reactions do not", () => {
  const score = (rs) => candidateScore(ratings, { sourceId: "stage", start: 10, end: 20, reactions: rs });
  assert.equal(score([reaction("r", 12, 14, { verified: true })]), 100);
  assert.equal(score([reaction("r", 19, 23, { verified: true })]), 100);
  assert.equal(score([reaction("r", 12, 14, { confidence: "high" })]), 95);
  assert.equal(score([reaction("r", 12, 14, { verified: true, sourceId: "other" })]), 95);
  assert.equal(score([reaction("r", 12, 14, { verified: true, kind: "crowd" })]), 95);
  assert.equal(score([reaction("a", 12, 14, { verified: true }), reaction("b", 21, 23, { verified: true })]), 100);
});

test("reactionTailOut suggests a speech-free following/overlapping tail and never mutates out", () => {
  const rs = [reaction("r", 21, 23)];
  assert.equal(reactionTailOut(passage, rs, [{ start: 24, end: 25 }]), 23);
  assert.equal(reactionTailOut(passage, rs, [{ start: 22.5, end: 24 }]), null);
  assert.equal(reactionTailOut(passage, rs, [{ start: 20, end: 21 }]), null);
  assert.equal(reactionTailOut(passage, rs, [{ start: 19, end: 20.1 }]), null);
  assert.equal(reactionTailOut(passage, rs, [{ sourceId: "other", start: 22, end: 24 }]), 23);
  assert.equal(reactionTailOut(passage, [reaction("overlap", 19, 21)]), 21);
  assert.equal(reactionTailOut({ ...passage, duration: 22 }, rs), null);
  assert.equal(reactionTailOut(passage, [reaction("contained", 12, 14)]), null);
  assert.equal(passage.out, 20);
});

test("resolved candidates store both reaction categories, compatibility union, hints, and suggested tail", () => {
  const words = "Learn to speak clearly and listen to your audience.".split(" ").map((text, i) => ({ id: `w${i}`, text, sourceId: "stage", start: i, end: i + 0.8 }));
  const source = { id: "stage", event: "Real event", audio: "ok", duration: 20, rightsStatus: "approved", audioQuality: { score: 90, label: "clean", version: 1 } };
  const raw = { kind: "one_liner", source_id: "stage", start_word: words[0].id, end_word: words.at(-1).id, ratings, out: 100, reactionTailOut: 100 };
  const base = resolveCandidate(raw, { source, words });
  const rs = [reaction("inside", 3, 4, { verified: true }), reaction("after", base.out + 0.5, base.out + 2)];
  const c = resolveCandidate(raw, { source, words, reactions: rs });
  assert.equal(c.out, base.out);
  assert.equal(c.score, 100);
  assert.deepEqual(c.containedReactionIds, ["inside"]);
  assert.deepEqual(c.followingReactionIds, ["after"]);
  assert.deepEqual(c.reactionIds, ["inside", "after"]);
  assert.deepEqual(c.reactionHints, ["after"]);
  assert.equal(c.reactionAssociationVersion, 1);
  assert.equal(c.reactionAssociations.contained[0].overlapSeconds, 1);
  assert.equal(c.reactionTailOut, base.out + 2);
  assert.deepEqual(c.sourceAudioQuality, source.audioQuality);
  assert.equal(c.audioQuality, undefined, "a source-wide record is not a measured passage");
  assert.equal(c.event, "Real event");
  const next = [...words, { id: "next", sourceId: "stage", text: "Next.", start: base.out + 1, end: base.out + 2 }];
  assert.equal(resolveCandidate(raw, { source, words: next, reactions: rs }).reactionTailOut, null);
});
