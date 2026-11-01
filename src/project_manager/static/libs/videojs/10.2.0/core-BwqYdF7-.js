import { r as toPercent } from "./number-D2skb7-A.js";
import { n as findLastIndexAtOrBefore } from "./find-last-at-or-before-BxNdB0lA.js";

//#region ../utils/dist/array/find-range-at.js
/**
* Finds the ordered range containing the target value.
*
* @internal
*/
function findRangeAt(ranges, value, getStart, getEnd) {
	const index = findLastIndexAtOrBefore(ranges, value, getStart);
	if (index < 0) return void 0;
	const range = ranges[index];
	const end = getEnd(range);
	const last = index === ranges.length - 1;
	return value < end || last && value === end ? range : void 0;
}

//#endregion
//#region ../core/dist/dev/core/ui/time-slider/chapters/core.js
/**
* A stable key for a chapter cue: its id when it has one, then where it starts and what it says. Keyed by content
* rather than identity because the store hands out fresh cue data on every sync (a duration change re-clamps ends); two
* cues sharing all of that within one list are told apart by position.
*/
function getCueKey(cue, seen) {
	const id = cue.id;
	const base = `cue-${typeof id === "string" && id ? `${id}-` : ""}${cue.startTime}-${cue.text}`;
	const count = seen.get(base) ?? 0;
	seen.set(base, count + 1);
	return count ? `${base}-${count}` : base;
}
/**
* Produces an ordered, non-overlapping, contiguous partition of the slider domain.
*
* @internal
*/
function normalizeChapterCues(cues, min, max) {
	if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
	const seen = /* @__PURE__ */ new Map();
	const sorted = cues.map((cue, index) => ({
		cue,
		index,
		key: getCueKey(cue, seen)
	})).filter(({ cue }) => Number.isFinite(cue.startTime) && Number.isFinite(cue.endTime)).sort((a, b) => a.cue.startTime - b.cue.startTime || a.index - b.index);
	const chapters = [];
	let end = min;
	let previousKey = "start";
	for (const { cue, key } of sorted) {
		const start = Math.max(min, cue.startTime);
		const cueEnd = Math.min(max, cue.endTime);
		if (cueEnd <= start) continue;
		if (start > end) chapters.push({
			key: `gap-${previousKey}-${key}`,
			start: end,
			end: start,
			cue: null
		});
		const segmentStart = Math.max(start, end);
		if (cueEnd <= segmentStart) continue;
		chapters.push({
			key,
			start: segmentStart,
			end: cueEnd,
			cue
		});
		end = cueEnd;
		previousKey = key;
	}
	if (chapters.length === 0) return [{
		key: "gap-start-end",
		start: min,
		end: max,
		cue: null
	}];
	if (end < max) chapters.push({
		key: `gap-${previousKey}-end`,
		start: end,
		end: max,
		cue: null
	});
	return chapters;
}
/**
* Prepares chapter ranges and state for platform renderers.
*
* @internal
*/
var TimeSliderChaptersCore = class {
	#cues = null;
	#min = 0;
	#max = 0;
	#result = null;
	getRanges(cues, min, max) {
		if (this.#result && (this.#cues === cues || this.#cues?.length === 0 && cues.length === 0) && this.#min === min && this.#max === max) return this.#result;
		const hasRange = max > min;
		const rangeMax = hasRange ? max : min + 1;
		const chapters = normalizeChapterCues(hasRange ? cues : [], min, rangeMax);
		const ranges = chapters.map(({ key, start, end, cue }) => ({
			key,
			start,
			end,
			highlight: cue !== null
		}));
		this.#cues = cues;
		this.#min = min;
		this.#max = max;
		this.#result = {
			chapters,
			ranges,
			max: rangeMax
		};
		return this.#result;
	}
	findChapter(chapters, value) {
		return findRangeAt(chapters, value, (chapter) => chapter.start, (chapter) => chapter.end);
	}
	getState(segment, chapters, bufferedEnd) {
		return {
			...segment,
			cue: chapters[segment.index]?.cue ?? null,
			bufferPercent: toPercent(bufferedEnd, segment.start, segment.end)
		};
	}
};

//#endregion
export { TimeSliderChaptersCore as t };
//# sourceMappingURL=core-BwqYdF7-.js.map