//#region ../utils/dist/dom/template.js
/**
* Create an `HTMLTemplateElement` from an HTML string, or `null` when `document` is unavailable (SSR).
*
* @internal
*/
function createTemplate(html) {
	const doc = globalThis.document;
	if (!doc) return null;
	const template = doc.createElement("template");
	template.innerHTML = html;
	return template;
}
/**
* Return the first direct-child template in a container.
*
* @internal
*/
function getTemplateElement(container) {
	for (const child of container.children) if (child.localName === "template" && "content" in child) return child;
	return null;
}
/**
* Return a template's only element root, or `null` when it does not contain exactly one.
*
* @internal
*/
function getTemplateRoot(template) {
	const root = template.content.firstElementChild;
	return root && !root.nextElementSibling ? root : null;
}
/**
* Deep-clone a resolved template root into the target document.
*
* @internal
*/
function cloneTemplateRoot(root, targetDocument = root.ownerDocument) {
	return targetDocument.importNode(root, true);
}
/**
* Deep-clone a template's content into a container.
*
* @internal
*/
function renderTemplate(container, template) {
	container.appendChild(container.ownerDocument.importNode(template.content, true));
}

//#endregion
export { renderTemplate as a, getTemplateRoot as i, createTemplate as n, getTemplateElement as r, cloneTemplateRoot as t };
//# sourceMappingURL=template-Cya7joDn.js.map