/*! Video.js | https://videojs.org/help */
import { t as findComposedElement } from "../children-D2Flrhz2.js";
import { n as isHTMLImageElement } from "../predicates-C_TReuAB.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { l as selectPlayback, s as selectMetadata } from "../selectors-B0umcXKn.js";
import { t as logMissingFeature } from "../log-DrTPNK96.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";

//#region ../core/dist/dev/core/ui/poster/core.js
/**
* Turns playback and metadata into poster presentation state.
*
* Owns no image of its own: a binding finds one, supplies how it is faring through {@link PosterCore.setImageLoadState},
* and paints the result.
*
* @internal
*/
var PosterCore = class {
	#media = null;
	#loadState = "none";
	/** Supply the latest player state. Call before reading {@link PosterCore.getState}. */
	setMedia(media) {
		this.#media = media;
	}
	/** Supply how the binding's image is faring. */
	setImageLoadState(loadState) {
		this.#loadState = loadState;
	}
	/** Derive the presentation state to paint. */
	getState() {
		const media = this.#media;
		return {
			visible: !media.started,
			src: media.poster,
			loading: this.#loadState === "loading",
			loaded: this.#loadState === "loaded",
			error: this.#loadState === "error"
		};
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/poster/data.js
/** @internal */
const PosterDataAttrs = {
	/** Present until playback starts. */
	visible: "data-visible",
	/** Present while the poster image is fetching. */
	loading: "data-loading",
	/** Present once the poster image has decoded. */
	loaded: "data-loaded",
	/** Present when the poster image failed. */
	error: "data-error"
};

//#endregion
//#region ../html/dist/dev/ui/poster/element.js
const SHADOW_CSS = `\
:host {
  display: block;
}
img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: var(--media-object-fit, contain);
  object-position: var(--media-object-position, center);
}
img:not([src]) {
  visibility: hidden;
}`;
/**
* Whether anything already points this image somewhere, which answers both whether the author owns the source and
* whether there is a download to wait for. A `<source>` counts: inside a `<picture>` it can win over the `src`.
*/
function hasSource(img) {
	if (img.hasAttribute("src") || img.hasAttribute("srcset")) return true;
	const parent = img.parentElement;
	return parent?.localName === "picture" && parent.querySelector("source") !== null;
}
/**
* Whether `complete` on this image describes a request. It is also true for one that omits both `src` and `srcset`,
* whatever a parent `<picture>` is fetching on its behalf, so only an image sourced from its own attributes can be
* read.
*/
function hasOwnSource(img) {
	return !!img.getAttribute("src") || img.hasAttribute("srcset");
}
/**
* The image the element draws when none is supplied, reachable from outside as `::part(image)`. Decorative by default,
* like the one each skin carries: a resolved URL says nothing about what it depicts.
*/
function createFallbackImage() {
	const img = document.createElement("img");
	img.alt = "";
	img.setAttribute("part", "image");
	img.setAttribute("decoding", "async");
	return img;
}
/**
* `<media-poster>` — sets `src` on a poster image it does not own.
*
* The image is a child, as in `<picture>`, but sourcing runs the other way around: `<picture>` treats the `src` on its
* `<img>` as the fallback, while here an image with no source of its own is the one this element fills in. Give the
* child a `src`, a `srcset`, or `<source>` candidates and it is yours, left alone.
*
* Left empty, the element draws an image of its own in its shadow root. Supply one as a child to describe it or wrap
* it: `<media-poster><img alt="Keynote speaker"></media-poster>`. Inside a skin, an `<img slot="poster">` of yours
* replaces the one the skin carries.
*/
var PosterElement = class extends UIElement {
	static {
		this.tagName = "media-poster";
	}
	#core = new PosterCore();
	#shadow = this.attachShadow({ mode: "open" });
	#fallback = createFallbackImage();
	#children = new MutationObserver(() => this.requestUpdate());
	#playback = new PlayerController(this, playerContext, selectPlayback);
	#metadata = new PlayerController(this, playerContext, selectMetadata);
	#image = null;
	/** Whether `#image` had no source of its own when it became active. */
	#owned = false;
	#imageLoadState = "pending";
	#imageEvents = null;
	#disconnect = null;
	constructor() {
		super();
		const style = document.createElement("style");
		style.textContent = SHADOW_CSS;
		this.#shadow.append(style, document.createElement("slot"), this.#fallback);
	}
	connectedCallback() {
		super.connectedCallback();
		if (this.destroyed) return;
		this.#disconnect = new AbortController();
		const { signal } = this.#disconnect;
		this.addEventListener("slotchange", () => this.requestUpdate(), { signal });
		this.#children.observe(this, {
			childList: true,
			subtree: true
		});
		if (!this.#playback.value) logMissingFeature(this.localName, this.#playback.displayName ?? "playback");
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		this.#adopt(null);
		this.#children.disconnect();
		this.#disconnect?.abort();
		this.#disconnect = null;
	}
	get #loadState() {
		if (!this.#image || !hasSource(this.#image)) return "none";
		return this.#imageLoadState === "pending" ? "loading" : this.#imageLoadState;
	}
	update(changed) {
		super.update(changed);
		const playback = this.#playback.value;
		if (!playback) return;
		this.#core.setMedia({
			started: playback.started,
			poster: this.#metadata.value?.poster ?? ""
		});
		const { src } = this.#core.getState();
		this.#adopt(findComposedElement(this, isHTMLImageElement) ?? this.#fallback);
		this.#applySource(src);
		this.#core.setImageLoadState(this.#loadState);
		applyStateDataAttrs(this, this.#core.getState(), PosterDataAttrs);
	}
	/**
	* Ownership is settled once, when an image becomes active: after the first fill the `src` we set would itself look
	* authored. Re-slot an image with a source to hand it back, the way React decides a field is controlled at mount.
	*/
	#adopt(next) {
		if (next === this.#image) return;
		if (this.#owned) this.#image?.removeAttribute("src");
		this.#imageEvents?.abort();
		this.#imageEvents = null;
		this.#image = next;
		this.#owned = next !== null && !hasSource(next);
		this.#imageLoadState = "pending";
		if (next === this.#fallback) this.#shadow.append(this.#fallback);
		else if (next) this.#fallback.remove();
		if (!next) return;
		if (next.naturalWidth > 0) this.#imageLoadState = "loaded";
		else if (next.complete && hasOwnSource(next)) this.#imageLoadState = "error";
		this.#imageEvents = new AbortController();
		const { signal } = this.#imageEvents;
		const settle = (loadState) => () => {
			this.#imageLoadState = loadState;
			this.requestUpdate();
		};
		next.addEventListener("load", settle("loaded"), { signal });
		next.addEventListener("error", settle("error"), { signal });
	}
	#applySource(src) {
		const img = this.#image;
		if (!img || !this.#owned) return;
		if (!src) {
			this.#imageLoadState = "pending";
			img.removeAttribute("src");
		} else if (img.getAttribute("src") !== src) {
			this.#imageLoadState = "pending";
			img.setAttribute("src", src);
		}
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/poster.js
safeDefine(PosterElement);

//#endregion
//# sourceMappingURL=poster.dev.js.map