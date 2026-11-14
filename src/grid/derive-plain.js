// What a host with no formatter writes for content (patch.js's content(), as a derive): the
// format is ignored. A host patch and a tab's reducer cannot drift apart (N2).

import { shown, typed } from "./codec/value.js";

export function derivePlain(content, fmt, result) {
  if (content === null || content === undefined) return null;
  if (typeof content === "number") return { text: shown(content), n: true };
  if (typeof content === "boolean") return { text: shown(content) };
  if (typeof content === "string") {
    if (content === "") return null;
    return typed(content) === content ? { text: content } : { text: content, t: true };
  }
  if (typeof content === "object" && typeof content.f === "string") {
    if (result === undefined) result = content.r;
    if (result === undefined) return { text: "", f: content.f };
    const cell = { text: shown(result), f: content.f };
    if (typeof result === "number") cell.n = true;
    return cell;
  }
  throw new TypeError(`grid content: ${String(content)} is not a number, true, false, text or a formula`);
}

derivePlain.plain = true;
