import { t as pick } from "./pick-BAh7WYWl.js";
import { T as AbortControllerRegistry, _ as audioTrackFeature, a as remotePlaybackFeature, c as playbackFeature, d as liveFeature, f as fullscreenFeature, g as bufferFeature, i as sourceFeature, l as pipFeature, m as controlsFeature, n as timeFeature, o as qualityFeature, p as errorFeature, r as textTrackFeature, s as playbackRateFeature, t as volumeFeature, u as metadataFeature, w as throwNoTargetError, x as definePlayerFeature } from "./volume-aFyxrX8a.js";
import { t as listen } from "./listen-CO63BggB.js";
import { n as MediaStreamTypes } from "./types-D8a85nGw.js";
import { g as isMediaSeekCapable, o as isMediaBufferCapable, v as isMediaStreamTypeCapable } from "./predicate-VHPnHoui.js";

//#region ../core/dist/dev/dom/store/features/stream-type.js
const streamTypeFeature = definePlayerFeature({
	name: "streamType",
	state: () => ({ streamType: MediaStreamTypes.UNKNOWN }),
	attach({ target, signal, set }) {
		const { media } = target;
		if (isMediaStreamTypeCapable(media)) {
			const sync = () => set({ streamType: media.streamType });
			sync();
			listen(media, "streamtypechange", sync, { signal });
			return;
		}
		if (!isMediaSeekCapable(media)) return;
		const detect = () => {
			const { duration } = media;
			if (duration === Number.POSITIVE_INFINITY) return MediaStreamTypes.LIVE;
			if (Number.isFinite(duration) && duration > 0) return MediaStreamTypes.ON_DEMAND;
			return MediaStreamTypes.UNKNOWN;
		};
		const sync = () => set({ streamType: detect() });
		sync();
		listen(media, "durationchange", sync, { signal });
		listen(media, "loadedmetadata", sync, { signal });
		listen(media, "emptied", sync, { signal });
		if (isMediaBufferCapable(media)) listen(media, "progress", sync, { signal });
	}
});

//#endregion
//#region ../store/dist/dev/core/selector.js
const stateContext = {
	target: throwNoTargetError,
	signals: new AbortControllerRegistry(),
	get: throwNoTargetError,
	set: throwNoTargetError
};
/**
* Create a type-safe selector for a slice's state.
*
* The selector returns the slice's state, or `undefined` if the slice is not configured in the store.
*
* @example
*   ```ts
*   const selectPlayback = createSelector(playbackSlice);
*   selectPlayback(store.state); // { paused, play, pause, ... } | undefined
*   selectPlayback.displayName; // 'playback' (from slice name)
*   ```;
*
* @param slice - The slice to create a selector for.
*/
function createSelector(slice) {
	const initialState = slice.state(stateContext);
	const keys = [...Object.keys(initialState), ...Object.keys(slice.derived ?? {})];
	const firstKey = keys[0];
	if (!firstKey) return Object.assign(() => void 0, { displayName: slice.name });
	return Object.assign((state) => {
		if (!(firstKey in state)) return void 0;
		return pick(state, keys);
	}, { displayName: slice.name });
}

//#endregion
//#region ../core/dist/dev/dom/store/selectors.js
/** Select the audio track state (audioTrackList, selectAudioTrack). */
const selectAudioTrack = createSelector(audioTrackFeature);
/** Select the buffer state (buffered, seekable). */
const selectBuffer = createSelector(bufferFeature);
/** Select the controls state (controlsVisible, userActive, toggleControls, requestControlsLock). */
const selectControls = createSelector(controlsFeature);
/** Select the error state (error, dismissError). */
const selectError = createSelector(errorFeature);
/** Select the fullscreen state (isFullscreen, fullscreenAvailability, requestFullscreen, exitFullscreen). */
const selectFullscreen = createSelector(fullscreenFeature);
/** Select the live state (`liveEdgeStart`, `targetLiveWindow`). */
const selectLive = createSelector(liveFeature);
/** Select resolved content metadata (title, poster). */
const selectMetadata = createSelector(metadataFeature);
/**
* Select the PiP state (isPictureInPicture, pictureInPictureAvailability, requestPictureInPicture,
* exitPictureInPicture).
*/
const selectPiP = createSelector(pipFeature);
/** Select the playback state (paused, ended, play, pause). */
const selectPlayback = createSelector(playbackFeature);
/** Select the playback rate state (playbackRate, playbackRates, setPlaybackRate). */
const selectPlaybackRate = createSelector(playbackRateFeature);
/** Select the quality state (videoRenditionList, activeVideoRendition, selectVideoRendition). */
const selectQuality = createSelector(qualityFeature);
/** Select the remote playback state (remotePlaybackState, remotePlaybackAvailability, promptRemotePlayback). */
const selectRemotePlayback = createSelector(remotePlaybackFeature);
/** Select the source state (currentSrc, canPlay). */
const selectSource = createSelector(sourceFeature);
/** Select the stream type state (`streamType`: `'on-demand' | 'live' | 'unknown'`). */
const selectStreamType = createSelector(streamTypeFeature);
/**
* Select the text track state (textTrackList, subtitlesShowing, toggleSubtitles, selectSubtitlesTrack, chaptersCues,
* thumbnailsTrack).
*/
const selectTextTrack = createSelector(textTrackFeature);
/** Select the time state (currentTime, duration, seek). */
const selectTime = createSelector(timeFeature);
/** Select the volume state (volume, muted, setVolume, setMuted). */
const selectVolume = createSelector(volumeFeature);

//#endregion
export { selectFullscreen as a, selectPiP as c, selectQuality as d, selectRemotePlayback as f, selectVolume as h, selectError as i, selectPlayback as l, selectTime as m, selectBuffer as n, selectLive as o, selectTextTrack as p, selectControls as r, selectMetadata as s, selectAudioTrack as t, selectPlaybackRate as u };
//# sourceMappingURL=selectors-B0umcXKn.js.map