/*! Video.js | https://videojs.org/help */
import { t as CustomMediaElement } from "../custom-media-element-CfmsPmjg.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as HlsVideoAdapter } from "../adapter-RIXFeJHQ.js";
import { t as MediaAttachMixin } from "../media-attach-mixin-yt2XYok0.js";

//#region ../html/dist/dev/media/hls-video/adapter.js
var HlsVideo = class extends MediaAttachMixin(CustomMediaElement("video", HlsVideoAdapter)) {};

//#endregion
//#region ../html/dist/dev/define/media/hls-video.js
/** Lightweight SPF-backed HLS media component registered as `<hls-video>`. */
var HlsVideoElement = class extends HlsVideo {
	static {
		this.tagName = "hls-video";
	}
};
safeDefine(HlsVideoElement);

//#endregion
export { HlsVideoElement };
//# sourceMappingURL=hls-video.dev.js.map