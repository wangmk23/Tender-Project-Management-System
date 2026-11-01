/*! Video.js | https://videojs.org/help */
import { t as CustomMediaElement } from "../../custom-media-element-CfmsPmjg.js";
import { t as safeDefine } from "../../safe-define-THEasJ9B.js";
import { t as HlsVideoAdapter } from "../../adapter-RIXFeJHQ.js";
import { t as MediaAttachMixin } from "../../media-attach-mixin-yt2XYok0.js";
import { t as MuxMixin } from "../../mixin-CUfVgYXU.js";
import { t as MuxVideoMixin } from "../../mixin-C4uZGyLO.js";

//#region ../adapters/mux-video/dist/dev/spf/adapter.js
/**
* The Mux Media over the SPF HLS engine.
*
* Mirrors `@videojs/mux-video`'s hls.js-backed `MuxVideoAdapter` — same class shape, same `src`/`source` relationship,
* same derived `contentData` — over a different engine, though named for the flavor rather than sharing that class's
* name. It carries no `engine` or `preferPlayback`: SPF publishes no engine-shaped config for a consumer to pass, so
* the source is Mux identity and nothing else.
*
* `source.drm` licenses playback: a `drm.token` derives Mux's three license servers, and entries naming servers
* outright override them. A source carrying neither prunes its encrypted renditions and reports unsupported DRM,
* exactly as an engine with no EME does.
*/
var MuxVideoAdapter = class extends MuxMixin(HlsVideoAdapter) {
	static {
		this.defaultProps = {
			...HlsVideoAdapter.defaultProps,
			src: "",
			source: null
		};
	}
};

//#endregion
//#region ../html/dist/dev/media/mux-video/spf.js
const MuxVideoBase = MuxVideoMixin(MediaAttachMixin(CustomMediaElement("video", MuxVideoAdapter)));
/**
* `<mux-video>` over the SPF-backed Mux Media instead of the hls.js-backed one.
*
* Shares its name with the flavor in `./hls-js` on purpose: the import path picks the engine, and nothing else about
* the surface moves. Deliberately not exported from this directory's barrel, so importing one flavor never pulls the
* other's engine in with it.
*/
var MuxVideo = class extends MuxVideoBase {};

//#endregion
//#region ../html/dist/dev/define/media/mux-video/spf.js
var MuxVideoElement = class extends MuxVideo {
	static {
		this.tagName = "mux-video";
	}
};
safeDefine(MuxVideoElement);

//#endregion
export { MuxVideoElement };
//# sourceMappingURL=spf.dev.js.map