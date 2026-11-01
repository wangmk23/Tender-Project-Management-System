//#region ../utils/dist/dom/text-track.js
/**
* Whether a text track is a captions or subtitles track.
*
* @internal
*/
function isCaptionOrSubtitleTrack(track) {
	return track.kind === "captions" || track.kind === "subtitles";
}
/**
* Captions and subtitles tracks in the order menus present them: grouped by kind, keeping source order within a kind.
* Shared so selection fallbacks pick the same track the captions menu lists first.
*
* @internal
*/
function getCaptionOrSubtitleTracks(tracks) {
	return Array.from(tracks).filter(isCaptionOrSubtitleTrack).sort(sortByKind);
}
/**
* Find the `<track>` element that owns the given `TextTrack`.
*
* @internal
*/
function findTrackElement(media, track) {
	if (!(media instanceof HTMLElement)) return null;
	for (const el of media.querySelectorAll("track")) if (el.track === track) return el;
	return null;
}
function sortByKind(a, b) {
	return a.kind > b.kind ? 1 : a.kind < b.kind ? -1 : 0;
}

//#endregion
export { getCaptionOrSubtitleTracks as n, isCaptionOrSubtitleTrack as r, findTrackElement as t };
//# sourceMappingURL=text-track-CnWDzah_.js.map