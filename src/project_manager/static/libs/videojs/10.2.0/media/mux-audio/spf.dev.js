/*! Video.js | https://videojs.org/help */
import { t as CustomMediaElement } from "../../custom-media-element-CfmsPmjg.js";
import { t as safeDefine } from "../../safe-define-THEasJ9B.js";
import { t as MediaAttachMixin } from "../../media-attach-mixin-yt2XYok0.js";
import { t as HlsAudioAdapter } from "../../adapter-D8eYKG7L.js";
import { t as MuxAudioMixin } from "../../mixin-CFhFTi2U.js";
import { t as MuxMixin } from "../../mixin-CUfVgYXU.js";

//#region ../adapters/mux-audio/dist/dev/spf/adapter.js
/**
* The Mux Media over the SPF audio-only HLS engine.
*
* Same Mux surface as the video flavor — `src`, the structured `source`, and the derived `contentData` all come from
* the shared mixin — over the subtractive engine, so only the audio renditions of whatever the playback ID names are
* fetched. That is the one place this diverges from the hls.js-backed `<mux-audio>`, which runs the full engine and
* downloads video renditions it never shows.
*
* `source.drm` is accepted but inert, unlike on the video flavor: the audio-only engine composes no EME. Mux encrypts
* video renditions and leaves audio clear, so a protected playback ID still plays here.
*
* `contentData` is kept rather than dropped, for the same reason its hls.js counterpart has it: a playback ID played as
* audio is usually a _video_ asset, whose poster and storyboard exist and which an audio skin may well want. The
* element ignores it either way. Mux publishes neither for a genuinely audio-only asset, so those URLs 404 — see the
* known shortcoming on the video flavor, which shares the derivation.
*/
var MuxAudioAdapter = class extends MuxMixin(HlsAudioAdapter) {
	static {
		this.defaultProps = {
			...HlsAudioAdapter.defaultProps,
			src: "",
			source: null
		};
	}
};

//#endregion
//#region ../html/dist/dev/media/mux-audio/spf.js
const MuxAudioBase = MuxAudioMixin(MediaAttachMixin(CustomMediaElement("audio", MuxAudioAdapter)));
/**
* `<mux-audio>` over the SPF audio-only Mux Media instead of the hls.js-backed one.
*
* Shares its name with the flavor in `./hls-js` on purpose: the import path picks the engine, and nothing else about
* the surface moves. Deliberately not exported from this directory's barrel, so importing one flavor never pulls the
* other's engine in with it.
*
* The engine underneath is the subtractive audio-only one, so only the audio renditions of the playback ID are fetched
* — unlike the hls.js-backed flavor, which runs the full engine and downloads video renditions it never plays.
*/
var MuxAudio = class extends MuxAudioBase {};

//#endregion
//#region ../html/dist/dev/define/media/mux-audio/spf.js
var MuxAudioElement = class extends MuxAudio {
	static {
		this.tagName = "mux-audio";
	}
};
safeDefine(MuxAudioElement);

//#endregion
export { MuxAudioElement };
//# sourceMappingURL=spf.dev.js.map