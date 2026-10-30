import { t as pick } from "./pick-BAh7WYWl.js";
import { r as serializeAttributes } from "./attributes-CI6LN9fK.js";

//#region ../html/dist/dev/media/background-video/template.js
/**
* Attributes forwarded to the inner `<video>`. `src` is deliberately not one of them: each element decides what to do
* with it, whether that is assigning the inner video or handing it to a playback engine, and serializing it into the
* template would start a native load either way.
*/
const VideoAttributes = [
	"autoplay",
	"controls",
	"controlslist",
	"crossorigin",
	"disablepictureinpicture",
	"disableremoteplayback",
	"loop",
	"muted",
	"playsinline",
	"preload"
];
/**
* The shadow template both background-video elements render: a `<slot>` for a placeholder image, and a `<video>`
* stretched over the host.
*
* Shared so the two can't drift in presentation. `object-fit` and `object-position` are the only styling hooks — a
* background video has no controls to theme.
*/
function getTemplateHTML(attrs) {
	return `
    <style>
      :host {
        position: relative;
      }

      video {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: var(--media-object-fit, inherit);
        object-position: var(--media-object-position, 50% 50%);
      }
    </style>
    <slot></slot>
    <video${serializeAttributes(pick(attrs, [...VideoAttributes]))}></video>
  `;
}

//#endregion
export { getTemplateHTML as t };
//# sourceMappingURL=template-g8ycZc0H.js.map