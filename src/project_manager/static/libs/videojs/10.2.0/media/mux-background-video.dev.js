/*! Video.js | https://videojs.org/help */
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as HlsBackgroundVideo } from "../adapter-BMUDxUdB.js";

//#region ../html/dist/dev/define/media/mux-background-video.js
/**
* `<mux-background-video>` — the Mux-flavored tag for `<hls-background-video>`.
*
* A distinct subclass rather than a re-export because a custom-element class can hold one tag name: registering the
* same class twice throws. The behavior is entirely the shared base's.
*/
var MuxBackgroundVideoElement = class extends HlsBackgroundVideo {
	static {
		this.tagName = "mux-background-video";
	}
};
safeDefine(MuxBackgroundVideoElement);

//#endregion
export { MuxBackgroundVideoElement };
//# sourceMappingURL=mux-background-video.dev.js.map