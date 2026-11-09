// Clocked offsets count Unicode code points in the original string (docs: Responses & source positions).
// JavaScript strings are UTF-16, so every slice here goes through Array.from.

export function cpLength(s) {
  return Array.from(s).length;
}

export function cpSlice(s, start, end) {
  return Array.from(s).slice(start, end).join("");
}

/** Code-point index of `needle` in `hay` (or -1). */
export function cpIndexOf(hay, needle, from = 0) {
  const fromUnits = Array.from(hay).slice(0, from).join("").length;
  const i = hay.indexOf(needle, fromUnits);
  return i < 0 ? -1 : cpLength(hay.slice(0, i));
}

/** Split an answer into sentence claims with code-point offsets into the original answer. */
export function splitClaims(answer) {
  const out = [];
  const cps = Array.from(answer);
  let start = 0;
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    const next = cps[i + 1];
    const isEnd = (c === "." || c === "!" || c === "?") && (next === undefined || /\s/.test(next));
    const isBreak = c === "\n";
    if (isEnd || isBreak || i === cps.length - 1) {
      const end = isBreak ? i : i + 1;
      pushTrimmed(cps, start, end, out);
      start = i + 1;
    }
  }
  return out.slice(0, 30); // Verify accepts 1-30 explicit claims
}

function pushTrimmed(cps, start, end, out) {
  while (start < end && /\s/.test(cps[start])) start++;
  while (end > start && /\s/.test(cps[end - 1])) end--;
  if (end > start) out.push({ text: cps.slice(start, end).join(""), start, end });
}

/** Replace [start,end) code-point spans with replacement strings (spans must not overlap). */
export function replaceSpans(text, spans) {
  const cps = Array.from(text);
  const sorted = [...spans].sort((a, b) => b.start - a.start);
  for (const s of sorted) cps.splice(s.start, s.end - s.start, s.replacement);
  return cps.join("");
}

export function placeholder(type) {
  return `<${String(type).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}>`;
}
