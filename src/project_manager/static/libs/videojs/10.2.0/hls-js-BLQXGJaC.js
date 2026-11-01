import { t as CustomMediaElement } from "./custom-media-element-CfmsPmjg.js";
import { t as safeDefine } from "./safe-define-THEasJ9B.js";
import { t as MediaAttachMixin } from "./media-attach-mixin-yt2XYok0.js";
import { t as MuxVideoAdapter } from "./adapter-B6PUbU6H.js";
import { t as MuxVideoMixin } from "./mixin-C4uZGyLO.js";

//#region ../html/dist/dev/media/mux-video/hls-js.js
const MuxVideoBase = MuxVideoMixin(MediaAttachMixin(CustomMediaElement("video", MuxVideoAdapter)));
var MuxVideo = class extends MuxVideoBase {};

//#endregion
//#region ../html/dist/dev/define/media/mux-video/hls-js.js
var MuxVideoElement = class extends MuxVideo {
	static {
		this.tagName = "mux-video";
	}
};
safeDefine(MuxVideoElement);

//#endregion
export { MuxVideoElement as t };
//# sourceMappingURL=hls-js-BLQXGJaC.js.map