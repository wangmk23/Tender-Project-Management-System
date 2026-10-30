import { i as isFunction, t as hasMethods } from "./predicate-3rF1m2uv.js";

//#region ../media/dist/dev/core/media-tracks/rendition-event.js
/** @internal */
var RenditionEvent = class extends Event {
	rendition;
	constructor(type, init) {
		super(type);
		this.rendition = init.rendition;
	}
};

//#endregion
//#region ../media/dist/dev/core/media-tracks/utils.js
const privateProps = /* @__PURE__ */ new WeakMap();
function getPrivate(instance) {
	return privateProps.get(instance) ?? setPrivate(instance, {});
}
function setPrivate(instance, props) {
	let saved = privateProps.get(instance);
	if (!saved) privateProps.set(instance, saved = {});
	return Object.assign(saved, props);
}

//#endregion
//#region ../media/dist/dev/core/media-tracks/audio-rendition-list.js
function addRendition$1(track, rendition) {
	const renditionList = getPrivate(track).media?.deref()?.audioRenditions;
	getPrivate(rendition).media = getPrivate(track).media;
	getPrivate(rendition).track = track;
	const renditionSet = getPrivate(track).renditionSet;
	renditionSet.add(rendition);
	const index = renditionSet.size - 1;
	if (!(index in AudioRenditionList.prototype)) Object.defineProperty(AudioRenditionList.prototype, index, { get() {
		return getCurrentRenditions$1(this)[index];
	} });
	queueMicrotask(() => {
		if (!renditionList || !track.enabled) return;
		renditionList.dispatchEvent(new RenditionEvent("addrendition", { rendition }));
	});
}
function removeRendition$1(rendition) {
	const renditionList = getPrivate(rendition).media?.deref()?.audioRenditions;
	const track = getPrivate(rendition).track;
	getPrivate(track).renditionSet.delete(rendition);
	queueMicrotask(() => {
		if (!renditionList || !track.enabled) return;
		renditionList.dispatchEvent(new RenditionEvent("removerendition", { rendition }));
	});
}
function selectedChanged$2(rendition) {
	const renditionList = getPrivate(rendition).media?.deref()?.audioRenditions;
	if (!renditionList || getPrivate(renditionList).changeRequested) return;
	getPrivate(renditionList).changeRequested = true;
	queueMicrotask(() => {
		delete getPrivate(renditionList).changeRequested;
		if (!getPrivate(rendition).track.enabled) return;
		renditionList.dispatchEvent(new Event("change"));
	});
}
function getCurrentRenditions$1(renditionList) {
	const media = getPrivate(renditionList).media?.deref();
	if (!media) return [];
	return [...media.audioTracks].filter((track) => track.enabled).flatMap((track) => [...getPrivate(track).renditionSet]);
}
/** @internal */
var AudioRenditionList = class extends EventTarget {
	#addRenditionCallback;
	#removeRenditionCallback;
	#changeCallback;
	[Symbol.iterator]() {
		return getCurrentRenditions$1(this).values();
	}
	get length() {
		return getCurrentRenditions$1(this).length;
	}
	getRenditionById(id) {
		return getCurrentRenditions$1(this).find((rendition) => `${rendition.id}` === `${id}`) ?? null;
	}
	get selectedIndex() {
		return getCurrentRenditions$1(this).findIndex((rendition) => rendition.selected);
	}
	set selectedIndex(index) {
		for (const [i, rendition] of getCurrentRenditions$1(this).entries()) rendition.selected = i === index;
	}
	get onaddrendition() {
		return this.#addRenditionCallback;
	}
	set onaddrendition(callback) {
		if (this.#addRenditionCallback) {
			this.removeEventListener("addrendition", this.#addRenditionCallback);
			this.#addRenditionCallback = void 0;
		}
		if (isFunction(callback)) {
			this.#addRenditionCallback = callback;
			this.addEventListener("addrendition", callback);
		}
	}
	get onremoverendition() {
		return this.#removeRenditionCallback;
	}
	set onremoverendition(callback) {
		if (this.#removeRenditionCallback) {
			this.removeEventListener("removerendition", this.#removeRenditionCallback);
			this.#removeRenditionCallback = void 0;
		}
		if (isFunction(callback)) {
			this.#removeRenditionCallback = callback;
			this.addEventListener("removerendition", callback);
		}
	}
	get onchange() {
		return this.#changeCallback;
	}
	set onchange(callback) {
		if (this.#changeCallback) {
			this.removeEventListener("change", this.#changeCallback);
			this.#changeCallback = void 0;
		}
		if (isFunction(callback)) {
			this.#changeCallback = callback;
			this.addEventListener("change", callback);
		}
	}
};

//#endregion
//#region ../media/dist/dev/core/media-tracks/audio-rendition.js
/**
* The consumer should use the `selected` setter to select one or multiple renditions that the engine is allowed to
* play.
*
* @internal
*/
var AudioRendition = class {
	src;
	id;
	bitrate;
	codec;
	#selected = false;
	get selected() {
		return this.#selected;
	}
	set selected(value) {
		if (this.#selected === value) return;
		this.#selected = value;
		selectedChanged$2(this);
	}
};

//#endregion
//#region ../media/dist/dev/core/media-tracks/change-event.js
/** @internal */
var TrackEvent = class extends Event {
	track;
	constructor(type, init) {
		super(type);
		this.track = init.track;
	}
};

//#endregion
//#region ../media/dist/dev/core/media-tracks/audio-track-list.js
function addAudioTrack(media, track) {
	const trackList = media.audioTracks;
	getPrivate(track).media = new WeakRef(media);
	if (!getPrivate(track).renditionSet) getPrivate(track).renditionSet = /* @__PURE__ */ new Set();
	const trackSet = getPrivate(trackList).trackSet;
	trackSet.add(track);
	const index = trackSet.size - 1;
	if (!(index in AudioTrackList.prototype)) Object.defineProperty(AudioTrackList.prototype, index, { get() {
		return [...getPrivate(this).trackSet][index];
	} });
	queueMicrotask(() => {
		trackList.dispatchEvent(new TrackEvent("addtrack", { track }));
	});
}
function removeAudioTrack(track) {
	const trackList = getPrivate(track).media?.deref()?.audioTracks;
	if (!trackList) return;
	if (!getPrivate(trackList).trackSet.delete(track)) return;
	queueMicrotask(() => {
		trackList.dispatchEvent(new TrackEvent("removetrack", { track }));
	});
}
function enabledChanged(track) {
	const trackList = getPrivate(track).media?.deref()?.audioTracks;
	if (!trackList || getPrivate(trackList).changeRequested) return;
	getPrivate(trackList).changeRequested = true;
	queueMicrotask(() => {
		delete getPrivate(trackList).changeRequested;
		trackList.dispatchEvent(new Event("change"));
	});
}
/** @internal */
var AudioTrackList = class extends EventTarget {
	#addTrackCallback;
	#removeTrackCallback;
	#changeCallback;
	constructor() {
		super();
		getPrivate(this).trackSet = /* @__PURE__ */ new Set();
	}
	get #tracks() {
		return getPrivate(this).trackSet;
	}
	[Symbol.iterator]() {
		return this.#tracks.values();
	}
	get length() {
		return this.#tracks.size;
	}
	getTrackById(id) {
		return [...this.#tracks].find((track) => track.id === id) ?? null;
	}
	get onaddtrack() {
		return this.#addTrackCallback;
	}
	set onaddtrack(callback) {
		if (this.#addTrackCallback) {
			this.removeEventListener("addtrack", this.#addTrackCallback);
			this.#addTrackCallback = void 0;
		}
		if (isFunction(callback)) {
			this.#addTrackCallback = callback;
			this.addEventListener("addtrack", callback);
		}
	}
	get onremovetrack() {
		return this.#removeTrackCallback;
	}
	set onremovetrack(callback) {
		if (this.#removeTrackCallback) {
			this.removeEventListener("removetrack", this.#removeTrackCallback);
			this.#removeTrackCallback = void 0;
		}
		if (isFunction(callback)) {
			this.#removeTrackCallback = callback;
			this.addEventListener("removetrack", callback);
		}
	}
	get onchange() {
		return this.#changeCallback;
	}
	set onchange(callback) {
		if (this.#changeCallback) {
			this.removeEventListener("change", this.#changeCallback);
			this.#changeCallback = void 0;
		}
		if (isFunction(callback)) {
			this.#changeCallback = callback;
			this.addEventListener("change", callback);
		}
	}
};

//#endregion
//#region ../media/dist/dev/core/media-tracks/audio-track.js
/** @internal */
var AudioTrack = class {
	id;
	kind;
	label = "";
	language = "";
	sourceBuffer;
	#enabled = false;
	addRendition(src, codec, bitrate) {
		const rendition = new AudioRendition();
		rendition.src = src;
		rendition.codec = codec;
		rendition.bitrate = bitrate;
		addRendition$1(this, rendition);
		return rendition;
	}
	removeRendition(rendition) {
		removeRendition$1(rendition);
	}
	get enabled() {
		return this.#enabled;
	}
	set enabled(value) {
		if (this.#enabled === value) return;
		this.#enabled = value;
		enabledChanged(this);
	}
};

//#endregion
//#region ../media/dist/dev/core/media-tracks/video-rendition-list.js
function addRendition(track, rendition) {
	const renditionList = getPrivate(track).media?.deref()?.videoRenditions;
	getPrivate(rendition).media = getPrivate(track).media;
	getPrivate(rendition).track = track;
	const renditionSet = getPrivate(track).renditionSet;
	renditionSet.add(rendition);
	const index = renditionSet.size - 1;
	if (!(index in VideoRenditionList.prototype)) Object.defineProperty(VideoRenditionList.prototype, index, { get() {
		return getCurrentRenditions(this)[index];
	} });
	queueMicrotask(() => {
		if (!renditionList || !track.selected) return;
		renditionList.dispatchEvent(new RenditionEvent("addrendition", { rendition }));
	});
}
function removeRendition(rendition) {
	const renditionList = getPrivate(rendition).media?.deref()?.videoRenditions;
	const track = getPrivate(rendition).track;
	getPrivate(track).renditionSet.delete(rendition);
	queueMicrotask(() => {
		if (!renditionList || !track.selected) return;
		renditionList.dispatchEvent(new RenditionEvent("removerendition", { rendition }));
	});
}
function selectedChanged$1(rendition) {
	const renditionList = getPrivate(rendition).media?.deref()?.videoRenditions;
	if (!renditionList || getPrivate(renditionList).changeRequested) return;
	getPrivate(renditionList).changeRequested = true;
	queueMicrotask(() => {
		delete getPrivate(renditionList).changeRequested;
		if (!getPrivate(rendition).track.selected) return;
		renditionList.dispatchEvent(new Event("change"));
	});
}
function activeChanged(rendition) {
	const renditionList = getPrivate(rendition).media?.deref()?.videoRenditions;
	if (!renditionList || getPrivate(renditionList).activeChangeRequested) return;
	getPrivate(renditionList).activeChangeRequested = true;
	queueMicrotask(() => {
		delete getPrivate(renditionList).activeChangeRequested;
		if (!getPrivate(rendition).track.selected) return;
		renditionList.dispatchEvent(new Event("activechange"));
	});
}
function getCurrentRenditions(renditionList) {
	const media = getPrivate(renditionList).media?.deref();
	if (!media) return [];
	return [...media.videoTracks].filter((track) => track.selected).flatMap((track) => [...getPrivate(track).renditionSet]);
}
/** @internal */
var VideoRenditionList = class extends EventTarget {
	#addRenditionCallback;
	#removeRenditionCallback;
	#changeCallback;
	[Symbol.iterator]() {
		return getCurrentRenditions(this).values();
	}
	get length() {
		return getCurrentRenditions(this).length;
	}
	getRenditionById(id) {
		return getCurrentRenditions(this).find((rendition) => `${rendition.id}` === `${id}`) ?? null;
	}
	get selectedIndex() {
		return getCurrentRenditions(this).findIndex((rendition) => rendition.selected);
	}
	set selectedIndex(index) {
		for (const [i, rendition] of getCurrentRenditions(this).entries()) rendition.selected = i === index;
	}
	get onaddrendition() {
		return this.#addRenditionCallback;
	}
	set onaddrendition(callback) {
		if (this.#addRenditionCallback) {
			this.removeEventListener("addrendition", this.#addRenditionCallback);
			this.#addRenditionCallback = void 0;
		}
		if (isFunction(callback)) {
			this.#addRenditionCallback = callback;
			this.addEventListener("addrendition", callback);
		}
	}
	get onremoverendition() {
		return this.#removeRenditionCallback;
	}
	set onremoverendition(callback) {
		if (this.#removeRenditionCallback) {
			this.removeEventListener("removerendition", this.#removeRenditionCallback);
			this.#removeRenditionCallback = void 0;
		}
		if (isFunction(callback)) {
			this.#removeRenditionCallback = callback;
			this.addEventListener("removerendition", callback);
		}
	}
	get onchange() {
		return this.#changeCallback;
	}
	set onchange(callback) {
		if (this.#changeCallback) {
			this.removeEventListener("change", this.#changeCallback);
			this.#changeCallback = void 0;
		}
		if (isFunction(callback)) {
			this.#changeCallback = callback;
			this.addEventListener("change", callback);
		}
	}
};

//#endregion
//#region ../media/dist/dev/core/media-tracks/video-rendition.js
/**
* The consumer should use the `selected` setter to select one or multiple renditions that the engine is allowed to
* play.
*
* @internal
*/
var VideoRendition = class {
	src;
	id;
	width;
	height;
	bitrate;
	frameRate;
	codec;
	#selected = false;
	#active = false;
	get selected() {
		return this.#selected;
	}
	set selected(value) {
		if (this.#selected === value) return;
		this.#selected = value;
		selectedChanged$1(this);
	}
	get active() {
		return this.#active;
	}
	set active(value) {
		if (this.#active === value) return;
		this.#active = value;
		activeChanged(this);
	}
};

//#endregion
//#region ../media/dist/dev/core/media-tracks/video-track-list.js
function addVideoTrack(media, track) {
	const trackList = media.videoTracks;
	getPrivate(track).media = new WeakRef(media);
	if (!getPrivate(track).renditionSet) getPrivate(track).renditionSet = /* @__PURE__ */ new Set();
	const trackSet = getPrivate(trackList).trackSet;
	trackSet.add(track);
	const index = trackSet.size - 1;
	if (!(index in VideoTrackList.prototype)) Object.defineProperty(VideoTrackList.prototype, index, { get() {
		return [...getPrivate(this).trackSet][index];
	} });
	queueMicrotask(() => {
		trackList.dispatchEvent(new TrackEvent("addtrack", { track }));
	});
}
function removeVideoTrack(track) {
	const trackList = getPrivate(track).media?.deref()?.videoTracks;
	if (!trackList) return;
	if (!getPrivate(trackList).trackSet.delete(track)) return;
	queueMicrotask(() => {
		trackList.dispatchEvent(new TrackEvent("removetrack", { track }));
	});
}
function selectedChanged(selected) {
	const trackList = getPrivate(selected).media?.deref()?.videoTracks ?? [];
	let hasUnselected = false;
	for (const track of trackList) {
		if (track === selected) continue;
		track.selected = false;
		hasUnselected = true;
	}
	if (!hasUnselected) return;
	if (getPrivate(trackList).changeRequested) return;
	getPrivate(trackList).changeRequested = true;
	queueMicrotask(() => {
		delete getPrivate(trackList).changeRequested;
		trackList.dispatchEvent(new Event("change"));
	});
}
/** @internal */
var VideoTrackList = class extends EventTarget {
	#addTrackCallback;
	#removeTrackCallback;
	#changeCallback;
	constructor() {
		super();
		getPrivate(this).trackSet = /* @__PURE__ */ new Set();
	}
	get #tracks() {
		return getPrivate(this).trackSet;
	}
	[Symbol.iterator]() {
		return this.#tracks.values();
	}
	get length() {
		return this.#tracks.size;
	}
	getTrackById(id) {
		return [...this.#tracks].find((track) => track.id === id) ?? null;
	}
	get selectedIndex() {
		return [...this.#tracks].findIndex((track) => track.selected);
	}
	get onaddtrack() {
		return this.#addTrackCallback;
	}
	set onaddtrack(callback) {
		if (this.#addTrackCallback) {
			this.removeEventListener("addtrack", this.#addTrackCallback);
			this.#addTrackCallback = void 0;
		}
		if (isFunction(callback)) {
			this.#addTrackCallback = callback;
			this.addEventListener("addtrack", callback);
		}
	}
	get onremovetrack() {
		return this.#removeTrackCallback;
	}
	set onremovetrack(callback) {
		if (this.#removeTrackCallback) {
			this.removeEventListener("removetrack", this.#removeTrackCallback);
			this.#removeTrackCallback = void 0;
		}
		if (isFunction(callback)) {
			this.#removeTrackCallback = callback;
			this.addEventListener("removetrack", callback);
		}
	}
	get onchange() {
		return this.#changeCallback;
	}
	set onchange(callback) {
		if (this.#changeCallback) {
			this.removeEventListener("change", this.#changeCallback);
			this.#changeCallback = void 0;
		}
		if (isFunction(callback)) {
			this.#changeCallback = callback;
			this.addEventListener("change", callback);
		}
	}
};

//#endregion
//#region ../media/dist/dev/core/media-tracks/video-track.js
/** @internal */
var VideoTrack = class {
	id;
	kind;
	label = "";
	language = "";
	sourceBuffer;
	#selected = false;
	addRendition(src, width, height, codec, bitrate, frameRate) {
		const rendition = new VideoRendition();
		rendition.src = src;
		rendition.width = width;
		rendition.height = height;
		rendition.frameRate = frameRate;
		rendition.bitrate = bitrate;
		rendition.codec = codec;
		addRendition(this, rendition);
		return rendition;
	}
	removeRendition(rendition) {
		removeRendition(rendition);
	}
	get selected() {
		return this.#selected;
	}
	set selected(value) {
		if (this.#selected === value) return;
		this.#selected = value;
		if (value !== true) return;
		selectedChanged(this);
	}
};

//#endregion
//#region ../media/dist/dev/core/media-tracks/mixin.js
const HTMLMediaElementConstructor = globalThis.HTMLMediaElement;
const nativeVideoTracksFn = getBaseMediaTracksFn(HTMLMediaElementConstructor, "video");
const nativeAudioTracksFn = getBaseMediaTracksFn(HTMLMediaElementConstructor, "audio");
/** @internal */
function MediaTracksMixin(MediaElementClass) {
	if (!MediaElementClass?.prototype) return MediaElementClass;
	const prototype = MediaElementClass.prototype;
	const videoTracksFn = getBaseMediaTracksFn(MediaElementClass, "video");
	if (!videoTracksFn || `${videoTracksFn}`.includes("[native code]")) Object.defineProperty(prototype, "videoTracks", { get() {
		return getVideoTracks(this);
	} });
	const audioTracksFn = getBaseMediaTracksFn(MediaElementClass, "audio");
	if (!audioTracksFn || `${audioTracksFn}`.includes("[native code]")) Object.defineProperty(prototype, "audioTracks", { get() {
		return getAudioTracks(this);
	} });
	if (!hasOwn(prototype, "addVideoTrack")) prototype.addVideoTrack = function(kind, label = "", language = "") {
		const track = new VideoTrack();
		track.kind = kind;
		track.label = label;
		track.language = language;
		addVideoTrack(this, track);
		return track;
	};
	if (!hasOwn(prototype, "removeVideoTrack")) prototype.removeVideoTrack = removeVideoTrack;
	if (!hasOwn(prototype, "addAudioTrack")) prototype.addAudioTrack = function(kind, label = "", language = "") {
		const track = new AudioTrack();
		track.kind = kind;
		track.label = label;
		track.language = language;
		addAudioTrack(this, track);
		return track;
	};
	if (!hasOwn(prototype, "removeAudioTrack")) prototype.removeAudioTrack = removeAudioTrack;
	if (!hasOwn(prototype, "detach")) {
		const baseDetach = prototype.detach;
		prototype.detach = function() {
			const priv = getPrivate(this);
			priv.videoTracksCleanup?.abort();
			priv.audioTracksCleanup?.abort();
			delete priv.videoTracks;
			delete priv.audioTracks;
			delete priv.videoTracksCleanup;
			delete priv.audioTracksCleanup;
			baseDetach?.call(this);
		};
	}
	if (!hasOwn(prototype, "videoRenditions")) Object.defineProperty(prototype, "videoRenditions", { get() {
		return initVideoRenditions(this);
	} });
	if (!hasOwn(prototype, "audioRenditions")) Object.defineProperty(prototype, "audioRenditions", { get() {
		return initAudioRenditions(this);
	} });
	return MediaElementClass;
}
function hasOwn(value, key) {
	return Object.hasOwn(value, key);
}
function initVideoRenditions(media) {
	let renditions = getPrivate(media).videoRenditions;
	if (!renditions) {
		renditions = new VideoRenditionList();
		getPrivate(renditions).media = new WeakRef(media);
		getPrivate(media).videoRenditions = renditions;
	}
	return renditions;
}
function initAudioRenditions(media) {
	let renditions = getPrivate(media).audioRenditions;
	if (!renditions) {
		renditions = new AudioRenditionList();
		getPrivate(renditions).media = new WeakRef(media);
		getPrivate(media).audioRenditions = renditions;
	}
	return renditions;
}
function getBaseMediaTracksFn(MediaElementClass, type) {
	if (MediaElementClass?.prototype) return Object.getOwnPropertyDescriptor(MediaElementClass.prototype, `${type}Tracks`)?.get;
}
function isNativeTrackList(value) {
	return hasMethods(value, ["addEventListener", "removeEventListener"]);
}
function getVideoTracks(media) {
	let tracks = getPrivate(media).videoTracks;
	if (!tracks) {
		tracks = new VideoTrackList();
		getPrivate(media).videoTracks = tracks;
		const nativeEl = media.target;
		const nativeTracks = nativeVideoTracksFn && nativeEl ? nativeVideoTracksFn.call(nativeEl) : void 0;
		if (isNativeTrackList(nativeTracks)) {
			const currentTracks = tracks;
			for (const nativeTrack of nativeTracks) addVideoTrack(media, nativeTrack);
			const onChange = () => {
				currentTracks.dispatchEvent(new Event("change"));
			};
			const onAddTrack = (event) => {
				if ([...currentTracks].some((track) => track instanceof VideoTrack)) return;
				addVideoTrack(media, event.track);
			};
			const onRemoveTrack = (event) => {
				removeVideoTrack(event.track);
			};
			const onCustomAddTrack = (event) => {
				if (!(event.track instanceof VideoTrack)) return;
				for (const nativeTrack of nativeTracks) removeVideoTrack(nativeTrack);
			};
			const controller = new AbortController();
			const { signal } = controller;
			getPrivate(media).videoTracksCleanup = controller;
			nativeTracks.addEventListener("change", onChange, { signal });
			nativeTracks.addEventListener("addtrack", onAddTrack, { signal });
			nativeTracks.addEventListener("removetrack", onRemoveTrack, { signal });
			currentTracks.addEventListener("addtrack", onCustomAddTrack, { signal });
		}
	}
	return tracks;
}
function getAudioTracks(media) {
	let tracks = getPrivate(media).audioTracks;
	if (!tracks) {
		tracks = new AudioTrackList();
		getPrivate(media).audioTracks = tracks;
		const nativeEl = media.target;
		const nativeTracks = nativeAudioTracksFn && nativeEl ? nativeAudioTracksFn.call(nativeEl) : void 0;
		if (isNativeTrackList(nativeTracks)) {
			const currentTracks = tracks;
			for (const nativeTrack of nativeTracks) addAudioTrack(media, nativeTrack);
			const onChange = () => {
				currentTracks.dispatchEvent(new Event("change"));
			};
			const onAddTrack = (event) => {
				if ([...currentTracks].some((track) => track instanceof AudioTrack)) return;
				addAudioTrack(media, event.track);
			};
			const onRemoveTrack = (event) => {
				removeAudioTrack(event.track);
			};
			const onCustomAddTrack = (event) => {
				if (!(event.track instanceof AudioTrack)) return;
				for (const nativeTrack of nativeTracks) removeAudioTrack(nativeTrack);
			};
			const controller = new AbortController();
			const { signal } = controller;
			getPrivate(media).audioTracksCleanup = controller;
			nativeTracks.addEventListener("change", onChange, { signal });
			nativeTracks.addEventListener("addtrack", onAddTrack, { signal });
			nativeTracks.addEventListener("removetrack", onRemoveTrack, { signal });
			currentTracks.addEventListener("addtrack", onCustomAddTrack, { signal });
		}
	}
	return tracks;
}

//#endregion
export { MediaTracksMixin as t };
//# sourceMappingURL=mixin-BvQk9qei.js.map