import { test } from "node:test";
import assert from "node:assert/strict";
import { cpLength, cpSlice, cpIndexOf, splitClaims, replaceSpans, placeholder } from "../lib/text.js";

test("code-point offsets survive astral characters (docs: Responses & source positions)", () => {
  const s = "Hi 👋 Ana, email ana@example.com";
  const i = cpIndexOf(s, "ana@example.com");
  assert.equal(i, 16);
  assert.equal(cpSlice(s, i, i + cpLength("ana@example.com")), "ana@example.com");
  assert.notEqual(s.indexOf("ana@example.com"), i); // UTF-16 index differs
});

test("splitClaims returns sentences with offsets into the original answer", () => {
  const a = "First fact. Second fact!  Third? Last one without stop";
  const claims = splitClaims(a);
  assert.deepEqual(claims.map((c) => c.text), ["First fact.", "Second fact!", "Third?", "Last one without stop"]);
  for (const c of claims) assert.equal(cpSlice(a, c.start, c.end), c.text);
});

test("splitClaims does not split decimals or emails and caps at 30", () => {
  assert.equal(splitClaims("It costs $12.50 per month. Write to a.b@example.com today.").length, 2);
  assert.equal(splitClaims(Array.from({ length: 40 }, (_, i) => `Fact ${i}.`).join(" ")).length, 30);
});

test("replaceSpans + placeholder", () => {
  assert.equal(replaceSpans("call Dana now", [{ start: 5, end: 9, replacement: placeholder("person name") }]), "call <PERSON_NAME> now");
});
