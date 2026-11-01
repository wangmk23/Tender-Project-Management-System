import { s as isNumber } from "./predicate-3rF1m2uv.js";

//#region ../utils/dist/function/public-promise.js
/**
* A promise that can be settled from outside its executor.
*
* Useful as a barrier that one piece of code waits on and another settles — for example an in-flight load that callers
* await until whichever event finishes it resolves.
*
* @example
*   ```ts
*   const ready = createPublicPromise<void>();
*   element.addEventListener('load', () => ready.resolve(), { once: true });
*   await ready;
*   ```;
*
* @internal
*/
function createPublicPromise() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	promise.resolve = resolve;
	promise.reject = reject;
	return promise;
}

//#endregion
//#region ../media/dist/dev/dom/media-played-ranges/media-played-ranges.js
/**
* Mixin that tracks played ranges for media adapters lacking a native `HTMLMediaElement.played` (e.g. iframe-based
* embeds like Vimeo).
*
* Listens for standard media events the host dispatches on itself (`play`, `pause`, `ended`, `timeupdate`, `seeking`,
* `seeked`) and derives a `TimeRanges`-like `played` value from the host's `currentTime` / `paused`.
*
* @example
*   class VimeoAdapter extends MediaPlayedRangesMixin(EventTarget) { ... }
*
* @internal
*/
function MediaPlayedRangesMixin(BaseClass) {
	class MediaPlayedRanges extends BaseClass {
		#playedRanges = [];
		#currentPlayedRange = null;
		#rangeEpsilon = .5;
		#disconnect = new AbortController();
		constructor(...args) {
			super(...args);
			const options = { signal: this.#disconnect.signal };
			this.addEventListener("play", () => this.#onPlaybackStart(this.#currentTime), options);
			this.addEventListener("pause", () => this.#onPlaybackStop(this.#currentTime), options);
			this.addEventListener("ended", () => this.#onPlaybackStop(this.#currentTime), options);
			this.addEventListener("timeupdate", () => this.#onPlaybackProgress(this.#currentTime), options);
			this.addEventListener("seeking", () => this.#commitCurrentRange(), options);
			this.addEventListener("seeked", () => this.#onSeeked(this.#currentTime), options);
		}
		/** The host (subclass) supplies `currentTime` / `paused`. */
		get #host() {
			return this;
		}
		get #currentTime() {
			return this.#host.currentTime;
		}
		get played() {
			const time = this.#currentTime;
			if (!this.#host.paused && !this.#currentPlayedRange && isNumber(time)) this.#currentPlayedRange = {
				start: time,
				end: time
			};
			this.#onPlaybackProgress(time);
			if (this.#currentPlayedRange && isNumber(time)) this.#addPlayedRange(this.#currentPlayedRange.start, this.#currentPlayedRange.end);
			if (!this.#playedRanges.length) return createTimeRanges([[0, 0]]);
			return createTimeRanges(this.#playedRanges.map((r) => [r.start, r.end]));
		}
		destroy() {
			this.#disconnect.abort();
			super.destroy?.();
		}
		#onPlaybackStart(time) {
			const t = isNumber(time) ? time : this.#currentTime;
			if (!this.#currentPlayedRange) this.#currentPlayedRange = {
				start: t,
				end: t
			};
		}
		#onPlaybackProgress(time) {
			if (this.#currentPlayedRange && isNumber(time) && time > this.#currentPlayedRange.end) this.#currentPlayedRange.end = time;
		}
		#onSeeked(time) {
			const t = isNumber(time) ? time : this.#currentTime;
			this.#currentPlayedRange = {
				start: t,
				end: t
			};
		}
		#onPlaybackStop(time) {
			const t = isNumber(time) ? time : this.#currentTime;
			this.#commitCurrentRange(t);
		}
		#commitCurrentRange(time) {
			if (!this.#currentPlayedRange) return;
			if (isNumber(time)) this.#currentPlayedRange.end = time;
			const { start, end } = this.#currentPlayedRange;
			this.#currentPlayedRange = null;
			this.#addPlayedRange(start, end);
		}
		#addPlayedRange(start, end) {
			if (start >= end) return;
			const allRanges = [...this.#playedRanges, {
				start,
				end
			}];
			allRanges.sort((a, b) => a.start - b.start);
			const merged = [];
			for (const range of allRanges) {
				const last = merged.length ? merged[merged.length - 1] : null;
				if (!last) {
					merged.push({ ...range });
					continue;
				}
				if (range.start <= last.end + this.#rangeEpsilon) {
					last.start = Math.min(last.start, range.start);
					last.end = Math.max(last.end, range.end);
				} else merged.push({ ...range });
			}
			this.#playedRanges = merged;
		}
	}
	return MediaPlayedRanges;
}
function createTimeRanges(ranges) {
	Object.defineProperties(ranges, {
		start: { value: (i) => ranges[i]?.[0] ?? 0 },
		end: { value: (i) => ranges[i]?.[1] ?? 0 }
	});
	return ranges;
}

//#endregion
export { createPublicPromise as n, MediaPlayedRangesMixin as t };
//# sourceMappingURL=media-played-ranges-B4JAhSRt.js.map