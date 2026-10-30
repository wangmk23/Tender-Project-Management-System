import { t as ContextProvider } from "./context-provider-2u40YNUB.js";
import { t as applyElementProps } from "./element-props-CYmZOrQN.js";
import { n as menuGroupContext } from "./context-D5Xgpnkx.js";

//#region ../html/dist/dev/ui/menu/group-controller.js
var MenuGroupController = class {
	#host;
	#provider;
	#contextValue = { registerLabel: (id) => this.#registerLabel(id) };
	#labelId;
	#appliedLabelId;
	constructor(host) {
		this.#host = host;
		this.#provider = new ContextProvider(host, {
			context: menuGroupContext,
			initialValue: this.#contextValue
		});
	}
	applyProps() {
		const currentLabelledBy = this.#host.getAttribute("aria-labelledby") ?? void 0;
		const hasExplicitLabelledBy = currentLabelledBy !== void 0 && currentLabelledBy !== this.#appliedLabelId;
		if (this.#host.hasAttribute("aria-label") || hasExplicitLabelledBy) {
			if (this.#appliedLabelId && currentLabelledBy === this.#appliedLabelId) this.#host.removeAttribute("aria-labelledby");
			this.#appliedLabelId = void 0;
			applyElementProps(this.#host, { role: "group" });
			return;
		}
		this.#appliedLabelId = this.#labelId;
		applyElementProps(this.#host, {
			role: "group",
			"aria-labelledby": this.#labelId
		});
	}
	#registerLabel(id) {
		this.#labelId = id;
		this.#provider.setValue(this.#contextValue);
		this.#host.requestUpdate();
		return () => {
			if (this.#labelId !== id) return;
			this.#labelId = void 0;
			this.#host.requestUpdate();
		};
	}
};

//#endregion
export { MenuGroupController as t };
//# sourceMappingURL=group-controller-juSZS8Uz.js.map