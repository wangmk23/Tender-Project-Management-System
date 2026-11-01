import { n as isAbortError } from "./predicate-3rF1m2uv.js";
import { i as fetchResolvable, p as resolveUrl, s as getResponseText } from "./session-data-6y7aXrmJ.js";

//#region ../spf/dist/dev/media/hls/parse-json-chapters.js
/**
* Apple's JSON chapters notation — the document an `#EXT-X-SESSION-DATA` tag with `DATA-ID="com.apple.hls.chapters"`
* points at. An array of chapter entries, each with a required `start-time`, an optional `duration`, and optional
* `titles` (one per BCP-47 language, `und` for language-neutral), `images` (URLs relative to the document), and
* free-form `metadata`. Chapters run from their start to the next entry's start unless a `duration` says otherwise; a
* duration is also how chapters overlap or nest.
*
* Pure and DOM-free, and written for a spec-valid document: the types below are Apple's schema, and the parser trusts
* them. A document that isn't one fails loudly at the caller, which already treats a chapters fetch as best-effort.
*
* @see https://developer.apple.com/documentation/http-live-streaming/providing-javascript-object-notation-json-chapters
*/
/** The `DATA-ID` Apple reserves for JSON chapters. */
const APPLE_HLS_CHAPTERS_DATA_ID = "com.apple.hls.chapters";
/**
* Parse an Apple JSON chapters document, in document order — the order Apple's players display, and the order that
* decides which entry is "next" for a chapter without a `duration`.
*
* @param document - The parsed JSON document
* @param baseUrl - The document's URL, for resolving relative image URLs
* @returns The chapters, in document order
*/
function parseHlsJsonChapters(document, baseUrl) {
	return document.map((entry, index) => {
		const startTime = entry["start-time"];
		const endTime = entry.duration !== void 0 ? startTime + entry.duration : document[index + 1]?.["start-time"];
		const chapter = {
			startTime,
			titles: Object.fromEntries((entry.titles ?? []).map(({ language, title }) => [language, title]))
		};
		if (endTime !== void 0) chapter.endTime = endTime;
		if (entry.images) chapter.images = entry.images.map((image) => ({
			category: image["image-category"],
			width: image["pixel-width"],
			height: image["pixel-height"],
			url: resolveUrl(image.url, baseUrl)
		}));
		if (entry.metadata) chapter.metadata = entry.metadata;
		return chapter;
	});
}

//#endregion
//#region ../spf/dist/dev/media/dom/text/chapters-tracks.js
/**
* SPF-owned chapters `<track>` selector. Distinct from the subtitle tracks' `data-src-track` so each helper family
* removes only its own elements — and so host-page `<track kind="chapters">` children are never touched.
*/
const SPF_CHAPTERS_TRACK_SELECTOR = "track[data-src-chapters-track]";
/**
* Where a chapter with no end of its own ends: as far out as a cue can go. The notation leaves the last chapter open,
* the HTML spec spells "unbounded" as `Infinity`, and every current engine rejects a non-finite cue time — so, like Mux
* Elements before it, SPF writes the largest safe integer and leaves it there. Consumers that need the chapter to end
* where the media ends clamp to the media duration when they read the cue; video.js's textTrack feature does.
*/
const OPEN_CHAPTER_END = Number.MAX_SAFE_INTEGER;
/**
* The languages any chapter is titled in, first-seen order, with the one to lead moved to the front. Consumers that
* read "the" chapters track take the first one on the element (video.js's textTrack feature does), so append order is
* the whole selection mechanism.
*/
function orderLanguages(chapters, preferredLanguage) {
	const languages = [];
	for (const chapter of chapters) for (const language of Object.keys(chapter.titles)) if (!languages.includes(language)) languages.push(language);
	const lead = [preferredLanguage, "und"].find((language) => language !== void 0 && languages.includes(language));
	if (lead) {
		languages.splice(languages.indexOf(lead), 1);
		languages.unshift(lead);
	}
	return languages;
}
/**
* Run `callback` once the `<track>`'s (empty) load has settled. A `<track>` with no `src` still runs the track
* processing model the moment its mode leaves `disabled`: the empty URL fails the load, `readyState` goes to `ERROR`
* and `error` fires. Chromium and WebKit drop any cue added before that point, so cues have to wait for it. Same
* sequence the subtitle tracks go through — their cues just happen to arrive later, after a segment fetch.
*/
function onceSettled(el, callback) {
	if (el.readyState >= HTMLTrackElement.LOADED) {
		callback();
		return;
	}
	const settle = () => {
		el.removeEventListener("load", settle);
		el.removeEventListener("error", settle);
		callback();
	};
	el.addEventListener("load", settle);
	el.addEventListener("error", settle);
}
/**
* Project chapters onto `mediaElement` as one hidden `<track kind="chapters">` per title language, each holding a
* `VTTCue` per chapter titled in that language. The element is the store — there is no chapters state elsewhere — so
* consumers read `TextTrack.cues` like they would for an authored `<track>`.
*
* The tracks are `<track>` children (the only spec mechanism that can also remove a text track), tagged
* `data-src-chapters-track` for `removeAllChaptersTracksFromMedia`. No `src` — a `data:` URL would do, but WebKit
* refuses one on a `crossorigin` media element — so the cues arrive programmatically: the track is set `hidden` to let
* its empty load settle, then filled while `disabled`, then set `hidden` again. That last mode change is what queues
* the `TextTrackList` `change` observers re-read cues on; a srcless `<track>` never fires `load`.
*/
function addChaptersTracksToMedia(mediaElement, chapters, { preferredLanguage } = {}) {
	for (const language of orderLanguages(chapters, preferredLanguage)) {
		const el = document.createElement("track");
		el.kind = "chapters";
		el.srclang = language;
		el.toggleAttribute("data-src-chapters-track", true);
		mediaElement.appendChild(el);
		el.track.mode = "hidden";
		onceSettled(el, () => {
			if (el.parentNode !== mediaElement) return;
			el.track.mode = "disabled";
			for (const chapter of chapters) {
				const title = chapter.titles[language];
				if (title === void 0) continue;
				el.track.addCue(new VTTCue(chapter.startTime, chapter.endTime ?? OPEN_CHAPTER_END, title));
			}
			el.track.mode = "hidden";
		});
	}
}
/** Remove every SPF-owned chapters `<track>` child from `mediaElement`; subtitle and host-page tracks stay. */
function removeAllChaptersTracksFromMedia(mediaElement) {
	const elements = mediaElement.querySelectorAll(SPF_CHAPTERS_TRACK_SELECTOR);
	for (const el of elements) el.remove();
}

//#endregion
//#region ../spf/dist/dev/media/dom/text/load-chapters-tracks.js
/**
* Fetch and parse one Apple JSON chapters document. Chapters are optional and playback never depends on them, so a
* document that won't load or won't parse is warned about and yields none.
*/
async function fetchHlsJsonChapters(url, signal, credentials) {
	try {
		const response = await fetchResolvable({ url }, {
			signal,
			credentials
		});
		if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
		const document = JSON.parse(await getResponseText(response));
		return parseHlsJsonChapters(document, response.url || url);
	} catch (error) {
		if (!signal.aborted && !isAbortError(error)) console.warn(`[loadChaptersTracks] Failed to load the chapters document at ${url}`, error);
		return [];
	}
}
/**
* Load the Apple JSON chapters document at `url` onto `mediaElement` as hidden `<track kind="chapters">` elements, one
* per title language, via {@link addChaptersTracksToMedia}. Shared by SPF's `loadChapters` behavior and the hls.js and
* native HLS adapters, so every HLS path produces the same tracks.
*
* Aborting `signal` cancels a request in flight and removes the tracks loaded so far. Callers own deduplication — load
* again only for a different document or element.
*/
function loadChaptersTracks(mediaElement, url, signal, { credentials, ...options } = {}) {
	if (signal.aborted) return;
	signal.addEventListener("abort", () => removeAllChaptersTracksFromMedia(mediaElement), { once: true });
	fetchHlsJsonChapters(url, signal, credentials).then((chapters) => {
		if (signal.aborted) return;
		addChaptersTracksToMedia(mediaElement, chapters, options);
	});
}

//#endregion
export { APPLE_HLS_CHAPTERS_DATA_ID as n, loadChaptersTracks as t };
//# sourceMappingURL=load-chapters-tracks-ca_JiVd8.js.map