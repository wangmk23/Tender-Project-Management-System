//#region ../utils/dist/string/generate-id.js
/**
* Generate a unique-ish string ID via timestamp + random.
*
* @example
*   const id = generateId(); // "1738423156789-542891"
*
* @returns String in `timestamp-random` format (e.g. `"1738423156789-542891"`).
* @internal
*/
function generateId() {
	return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

//#endregion
export { generateId as t };
//# sourceMappingURL=generate-id-DHFQ63E5.js.map