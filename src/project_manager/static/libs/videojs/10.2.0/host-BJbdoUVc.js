//#region ../core/dist/dev/core/ui/popover/host.js
/**
* Hosted floating UI surfaces (popover, menu, tooltip, and future overlays) that support parent-driven lifecycle may
* set {@link POPUP_HOST_ATTR}. Ancestors can discover them with {@link POPUP_HOST_SELECTOR} and call methods such as
* `close('imperative-action')` when the element implements that contract.
*
* @internal
*/
const POPUP_HOST_ATTR = "data-popup";
/** @internal */
const POPUP_HOST_SELECTOR = `[${POPUP_HOST_ATTR}]`;

//#endregion
export { POPUP_HOST_SELECTOR as n, POPUP_HOST_ATTR as t };
//# sourceMappingURL=host-BJbdoUVc.js.map