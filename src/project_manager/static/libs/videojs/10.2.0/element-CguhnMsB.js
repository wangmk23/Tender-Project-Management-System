import { f as isUndefined, o as isNull, s as isNumber } from "./predicate-3rF1m2uv.js";
import { t as findComposedElement } from "./children-D2Flrhz2.js";
import { t as listen } from "./listen-CO63BggB.js";
import { n as isHTMLImageElement } from "./predicates-C_TReuAB.js";
import { i as observeResize } from "./observe-elements-B5qhV5BC.js";
import { t as UIElement } from "./ui-element--3_7he7k.js";
import { i as playerContext } from "./context-CL8SSE10.js";
import { t as PlayerController } from "./controller-BArmvAzk.js";
import { p as selectTextTrack } from "./selectors-B0umcXKn.js";
import { t as findLastAtOrBefore } from "./find-last-at-or-before-BxNdB0lA.js";
import { t as applyElementProps } from "./element-props-CYmZOrQN.js";
import { t as applyStateDataAttrs } from "./state-data-attrs-DiSfe3GX.js";

//#region ../core/dist/dev/core/ui/thumbnail/core.js
/** @internal */
var ThumbnailCore = class {
	findActiveThumbnail(thumbnails, time) {
		return findLastAtOrBefore(thumbnails, time, (thumbnail) => thumbnail.startTime);
	}
	/**
	* Parse CSS constraint strings into numeric `ThumbnailConstraints`.
	*
	* Accepts any object with string `minWidth`/`maxWidth`/`minHeight`/`maxHeight` properties — `CSSStyleDeclaration`
	* satisfies this structurally.
	*/
	parseConstraints(raw) {
		const minW = parseFloat(raw.minWidth);
		const maxW = parseFloat(raw.maxWidth);
		const minH = parseFloat(raw.minHeight);
		const maxH = parseFloat(raw.maxHeight);
		return {
			minWidth: Number.isFinite(minW) ? minW : 0,
			maxWidth: Number.isFinite(maxW) ? maxW : Infinity,
			minHeight: Number.isFinite(minH) ? minH : 0,
			maxHeight: Number.isFinite(maxH) ? maxH : Infinity
		};
	}
	/**
	* Calculate a uniform scale factor that sizes `tileWidth × tileHeight` to the given CSS min/max constraints while
	* preserving aspect ratio.
	*
	* - Fills the max constraints, scaling the tile up as readily as down. A box that grows — entering fullscreen widens it
	*   through a container query — has to take the tile with it rather than leave it at its native size.
	* - Raises that to meet min constraints, which win over max as they do in CSS.
	* - Returns `1` when unconstrained.
	*/
	calculateScale(tileWidth, tileHeight, constraints) {
		const { minWidth, maxWidth, minHeight, maxHeight } = constraints;
		const maxRatio = Math.min(maxWidth / tileWidth, maxHeight / tileHeight);
		const minRatio = Math.max(minWidth / tileWidth, minHeight / tileHeight);
		const scale = Number.isFinite(maxRatio) ? maxRatio : 1;
		return Number.isFinite(minRatio) && minRatio > scale ? minRatio : scale;
	}
	/**
	* Compute container and image dimensions for the current thumbnail, scaled to the element's CSS min/max constraints.
	*
	* The container clips the sprite sheet via `overflow: hidden`, and the image is positioned with `transform:
	* translate()` to show the correct tile.
	*/
	resize(thumbnail, imgNaturalWidth, imgNaturalHeight, constraints) {
		const tileWidth = thumbnail.width ?? imgNaturalWidth;
		const tileHeight = thumbnail.height ?? imgNaturalHeight;
		if (!tileWidth || !tileHeight) return void 0;
		const scale = this.calculateScale(tileWidth, tileHeight, constraints);
		const coordX = thumbnail.coords?.x ?? 0;
		const coordY = thumbnail.coords?.y ?? 0;
		const inset = scale !== 1 ? 1 : 0;
		return {
			scale,
			containerWidth: Math.max(0, Math.floor(tileWidth * scale) - inset * 2),
			containerHeight: Math.max(0, Math.floor(tileHeight * scale) - inset * 2),
			imageWidth: Math.ceil(imgNaturalWidth * scale),
			imageHeight: Math.ceil(imgNaturalHeight * scale),
			offsetX: Math.ceil(coordX * scale) + inset,
			offsetY: Math.ceil(coordY * scale) + inset
		};
	}
	/**
	* Resolve the CORS mode the image should request with.
	*
	* `null` opts out and drops the attribute. Any other explicit value wins, including `''`, which the CORS-settings
	* attribute reads as Anonymous. Otherwise the inherited mode applies, which renderers supply only for
	* `<track>`-sourced thumbnails since a list set directly may point at a host unrelated to the media component.
	*/
	resolveCrossOrigin(explicit, inherited) {
		if (isNull(explicit)) return void 0;
		if (!isUndefined(explicit)) return explicit;
		return inherited ?? void 0;
	}
	getState(loading, error, thumbnail) {
		return {
			loading,
			error,
			hidden: !loading && !thumbnail
		};
	}
	getAttrs(_state) {
		return {
			dir: "ltr",
			role: "img",
			"aria-hidden": "true"
		};
	}
};

//#endregion
//#region ../core/dist/dev/dom/ui/thumbnail.js
/** @internal */
function createThumbnail(options) {
	const { getContainer, getImg, onStateChange } = options;
	const core = new ThumbnailCore();
	let loading = false;
	let error = false;
	let naturalWidth = 0;
	let naturalHeight = 0;
	let lastSrc = "";
	let boundImg = null;
	let checkedImg = null;
	let stopListeningToImg = null;
	let stopObservingResize = null;
	const failedSrcs = /* @__PURE__ */ new Set();
	function onImgLoad() {
		const img = getImg();
		if (img) {
			naturalWidth = img.naturalWidth;
			naturalHeight = img.naturalHeight;
		}
		failedSrcs.delete(lastSrc);
		loading = false;
		error = false;
		onStateChange();
	}
	function markFailed() {
		failedSrcs.add(lastSrc);
		loading = false;
		error = true;
	}
	function onImgError() {
		markFailed();
		onStateChange();
	}
	function bindImg(img) {
		stopListeningToImg = new AbortController();
		listen(img, "load", onImgLoad, { signal: stopListeningToImg.signal });
		listen(img, "error", onImgError, { signal: stopListeningToImg.signal });
	}
	function ensureBindings() {
		const img = getImg();
		if (img !== boundImg) {
			stopListeningToImg?.abort();
			stopListeningToImg = null;
			boundImg = img;
			checkedImg = null;
			if (img) bindImg(img);
		}
		if (!stopObservingResize) {
			const container = getContainer();
			if (container) stopObservingResize = observeResize(container, onStateChange);
		}
	}
	function updateSrc(url) {
		ensureBindings();
		const src = url ?? "";
		if (src === lastSrc) return;
		lastSrc = src;
		if (src) {
			const failed = failedSrcs.has(src);
			loading = !failed;
			error = failed;
		} else {
			loading = false;
			error = false;
			naturalWidth = 0;
			naturalHeight = 0;
		}
	}
	function connect() {
		ensureBindings();
		const img = getImg();
		if (!img || img === checkedImg) return;
		checkedImg = img;
		if (!img.complete || !lastSrc) return;
		const previous = {
			loading,
			error,
			naturalWidth,
			naturalHeight
		};
		if (img.naturalWidth > 0) {
			naturalWidth = img.naturalWidth;
			naturalHeight = img.naturalHeight;
			loading = false;
			error = false;
		} else markFailed();
		if (previous.loading !== loading || previous.error !== error || previous.naturalWidth !== naturalWidth || previous.naturalHeight !== naturalHeight) onStateChange();
	}
	function disconnectImg(img) {
		if (img !== boundImg) return;
		stopListeningToImg?.abort();
		stopListeningToImg = null;
		boundImg = null;
		checkedImg = null;
	}
	function destroy() {
		stopListeningToImg?.abort();
		stopListeningToImg = null;
		boundImg = null;
		checkedImg = null;
		stopObservingResize?.();
		stopObservingResize = null;
	}
	return {
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
		get naturalWidth() {
			return naturalWidth;
		},
		get naturalHeight() {
			return naturalHeight;
		},
		readConstraints() {
			const el = getContainer();
			if (!el) return {
				minWidth: 0,
				maxWidth: Infinity,
				minHeight: 0,
				maxHeight: Infinity
			};
			return core.parseConstraints(getComputedStyle(el));
		},
		updateSrc,
		connect,
		disconnectImg,
		destroy
	};
}

//#endregion
//#region ../core/dist/dev/core/ui/thumbnail/data.js
/** @internal */
const ThumbnailDataAttrs = {
	loading: "data-loading",
	error: "data-error",
	hidden: "data-hidden"
};

//#endregion
//#region ../core/dist/dev/core/ui/thumbnail/media-fragment.js
/**
* Parse `url#xywh=x,y,w,h` into a URL and optional sprite coordinates.
*
* @internal
*/
function parseMediaFragment(text, baseURL) {
	const parts = text.trim().split("#");
	const rawURL = parts[0] ?? "";
	const hash = parts[1];
	const url = baseURL ? new URL(rawURL, baseURL).href : rawURL;
	if (!hash) return { url };
	const eqIndex = hash.indexOf("=");
	if (eqIndex === -1) return { url };
	const keys = hash.slice(0, eqIndex);
	const values = hash.slice(eqIndex + 1).split(",").map(Number);
	const data = {};
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const value = values[i];
		if (key && isNumber(value) && !Number.isNaN(value)) data[key] = value;
	}
	const result = { url };
	if (isNumber(data.w)) result.width = data.w;
	if (isNumber(data.h)) result.height = data.h;
	if (isNumber(data.x) && isNumber(data.y)) result.coords = {
		x: data.x,
		y: data.y
	};
	return result;
}
/**
* Convert an array of text cues (e.g. `VTTCue` from a `<track>` element) into {@link ThumbnailImage} entries by parsing
* the media-fragment in each cue's text.
*
* @internal
*/
function mapCuesToThumbnails(cues, baseURL) {
	const images = [];
	for (const cue of cues) {
		const fragment = parseMediaFragment(cue.text, baseURL);
		const image = {
			url: fragment.url,
			startTime: cue.startTime,
			endTime: cue.endTime
		};
		if (fragment.width) image.width = fragment.width;
		if (fragment.height) image.height = fragment.height;
		if (fragment.coords) image.coords = fragment.coords;
		images.push(image);
	}
	return images;
}

//#endregion
//#region ../html/dist/dev/ui/thumbnail/element.js
const SHADOW_CSS = `\
:host {
  display: inline-block;
  overflow: hidden;
}
img,
::slotted(img) {
  display: block;
}`;
/**
* Image attributes the element fills in from its own properties. Ones already on an image when it is adopted are the
* author's and are left alone, so an `<img slot="thumbnail" loading="lazy">` keeps its settings inside a skin.
*/
const IMAGE_ATTRIBUTES = [
	"crossorigin",
	"loading",
	"fetchpriority"
];
/** The image the element draws when none is supplied, reachable from outside as `::part(image)`. */
function createFallbackImage() {
	const img = document.createElement("img");
	img.alt = "";
	img.setAttribute("part", "image");
	img.setAttribute("aria-hidden", "true");
	img.setAttribute("decoding", "async");
	return img;
}
/**
* `<media-thumbnail>` — resolves and sizes a time-based thumbnail into an image.
*
* The element owns `src` and `srcset` on the active image. Left empty, it draws an image of its own in its shadow root.
* Supply an `<img>` child instead — `<media-thumbnail time="12"><img alt=""></media-thumbnail>` — to compose overlays
* or loading indicators beside the image the element controls. Any `crossorigin`, `loading`, or `fetchpriority` the
* child already carries wins over the element's own; the rest are filled in. Inside a skin, an `<img slot="thumbnail">`
* of yours replaces the one the skin carries.
*/
var ThumbnailElement = class extends UIElement {
	static {
		this.tagName = "media-thumbnail";
	}
	static {
		this.properties = {
			time: { type: Number },
			crossOrigin: {
				type: String,
				attribute: "crossorigin"
			},
			loading: { type: String },
			fetchPriority: {
				type: String,
				attribute: "fetchpriority"
			}
		};
	}
	#core;
	#shadow;
	#fallback;
	#children;
	#imageAttributes;
	#textTracks;
	#slots;
	#img;
	/** Attributes `#img` already carried when adopted, which the author owns. */
	#authored;
	#thumbnails;
	#externalThumbnails;
	#lastTextTrack;
	#api;
	constructor() {
		super();
		this.time = 0;
		this.#core = new ThumbnailCore();
		this.#shadow = this.attachShadow({ mode: "open" });
		this.#fallback = createFallbackImage();
		this.#children = new MutationObserver(() => this.requestUpdate());
		this.#imageAttributes = new MutationObserver(() => this.requestUpdate());
		this.#textTracks = new PlayerController(this, playerContext, selectTextTrack);
		this.#slots = null;
		this.#img = null;
		this.#authored = /* @__PURE__ */ new Set();
		this.#thumbnails = [];
		this.#api = null;
		const style = document.createElement("style");
		style.textContent = SHADOW_CSS;
		this.#shadow.append(style, document.createElement("slot"), this.#fallback);
	}
	/**
	* Set thumbnail images directly, bypassing the automatic `<track>` detection. When set, this takes priority over the
	* text track path.
	*/
	get thumbnails() {
		return this.#externalThumbnails;
	}
	set thumbnails(value) {
		this.#externalThumbnails = value;
		this.requestUpdate();
	}
	connectedCallback() {
		super.connectedCallback();
		if (this.destroyed) return;
		this.#api = createThumbnail({
			getContainer: () => this,
			getImg: () => this.#img,
			onStateChange: () => this.requestUpdate()
		});
		this.#children.observe(this, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["src", "srcset"]
		});
		this.#slots = new AbortController();
		listen(this, "slotchange", () => this.requestUpdate(), { signal: this.#slots.signal });
		this.requestUpdate();
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		this.#adopt(null);
		this.#children.disconnect();
		this.#slots?.abort();
		this.#slots = null;
		this.#api?.destroy();
		this.#api = null;
	}
	destroyCallback() {
		this.#api?.destroy();
		super.destroyCallback();
	}
	update(changed) {
		super.update(changed);
		const textTrack = this.#textTracks.value;
		if (this.#externalThumbnails) this.#thumbnails = this.#externalThumbnails;
		else if (textTrack !== this.#lastTextTrack) {
			this.#lastTextTrack = textTrack;
			const thumbnailsTrack = textTrack?.thumbnailsTrack;
			this.#thumbnails = thumbnailsTrack && thumbnailsTrack.cues.length > 0 ? mapCuesToThumbnails(thumbnailsTrack.cues, thumbnailsTrack.src ?? void 0) : [];
		}
		const thumbnail = this.#core.findActiveThumbnail(this.#thumbnails, this.time);
		const img = findComposedElement(this, isHTMLImageElement) ?? this.#fallback;
		this.#adopt(img);
		this.#applyImageAttributes(img, textTrack);
		this.#api?.updateSrc(thumbnail?.url);
		this.#applySource(thumbnail?.url);
		this.#api?.connect();
		if (!thumbnail) {
			this.#resetStyles();
			const state = this.#core.getState(false, false, void 0);
			applyElementProps(this, this.#core.getAttrs(state));
			applyStateDataAttrs(this, state, ThumbnailDataAttrs);
			return;
		}
		const api = this.#api;
		const state = this.#core.getState(api?.loading ?? false, api?.error ?? false, thumbnail);
		applyElementProps(this, this.#core.getAttrs(state));
		applyStateDataAttrs(this, state, ThumbnailDataAttrs);
		if (api?.naturalWidth && api.naturalHeight) {
			const constraints = api.readConstraints();
			const result = this.#core.resize(thumbnail, api.naturalWidth, api.naturalHeight, constraints);
			if (result) this.#applyResize(result);
		}
	}
	/**
	* Leaving `crossOrigin` unset means "follow the media component", so thumbnails keep working on a CORS-enabled player
	* without a skin having to thread an attribute through. Only the `<track>` path inherits: `thumbnails` set directly
	* may point at a host that has nothing to do with the media component.
	*/
	#inheritedCrossOrigin(textTrack) {
		return this.#externalThumbnails ? void 0 : textTrack?.thumbnailsTrack?.crossOrigin;
	}
	/** Sync image attributes from element properties, leaving the ones the author put on the image alone. */
	#applyImageAttributes(img, textTrack) {
		const props = {
			crossorigin: this.#core.resolveCrossOrigin(this.crossOrigin, this.#inheritedCrossOrigin(textTrack)),
			loading: this.loading,
			fetchpriority: this.fetchPriority
		};
		for (const name of this.#authored) delete props[name];
		applyElementProps(img, props);
	}
	#applyResize(result) {
		this.style.width = `${result.containerWidth}px`;
		this.style.height = `${result.containerHeight}px`;
		const imgStyle = this.#img?.style;
		if (!imgStyle) return;
		imgStyle.width = `${result.imageWidth}px`;
		imgStyle.height = `${result.imageHeight}px`;
		imgStyle.maxWidth = "none";
		imgStyle.transform = result.offsetX || result.offsetY ? `translate(-${result.offsetX}px, -${result.offsetY}px)` : "";
	}
	#resetStyles() {
		this.style.width = "";
		this.style.height = "";
		const imgStyle = this.#img?.style;
		if (!imgStyle) return;
		imgStyle.width = "";
		imgStyle.height = "";
		imgStyle.maxWidth = "";
		imgStyle.transform = "";
	}
	#adopt(next) {
		if (next === this.#img) return;
		const previous = this.#img;
		if (previous) {
			this.#api?.disconnectImg(previous);
			this.#resetStyles();
			previous.removeAttribute("src");
			previous.removeAttribute("srcset");
			for (const name of IMAGE_ATTRIBUTES) if (!this.#authored.has(name)) previous.removeAttribute(name);
		}
		this.#img = next;
		this.#authored = new Set(next ? IMAGE_ATTRIBUTES.filter((name) => next.hasAttribute(name)) : []);
		this.#imageAttributes.disconnect();
		if (next && next !== this.#fallback) this.#imageAttributes.observe(next, {
			attributes: true,
			attributeFilter: ["src", "srcset"]
		});
		if (next === this.#fallback) this.#shadow.append(this.#fallback);
		else if (next) this.#fallback.remove();
		this.#api?.updateSrc(void 0);
	}
	#applySource(src) {
		const img = this.#img;
		if (!img) return;
		img.removeAttribute("srcset");
		if (!src) img.removeAttribute("src");
		else if (img.getAttribute("src") !== src) img.setAttribute("src", src);
	}
};

//#endregion
export { ThumbnailElement as t };
//# sourceMappingURL=element-CguhnMsB.js.map