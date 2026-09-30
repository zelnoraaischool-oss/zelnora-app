import { mergeAttributes, Node } from "@tiptap/core";
import Heading from "@tiptap/extension-heading";

/** 変数（差し込み項目）を表すインラインノード。本文では {{表示名}} として扱う */
export const Variable = Node.create({
  name: "variable",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      key: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-key") ?? "",
        renderHTML: (attrs) => ({ "data-key": attrs.key as string }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-variable]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-variable": "", class: "variable-chip" }), `{{${String(node.attrs.key)}}}`];
  },
  renderText({ node }) {
    return `{{${String(node.attrs.key)}}}`;
  },
});

/** 条番号（第N条）を自動で振る見出し */
export const NumberedHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      numbered: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-numbered") === "true",
        renderHTML: (attrs) => ({ "data-numbered": attrs.numbered ? "true" : "false" }),
      },
    };
  },
}).configure({ levels: [1, 2, 3] });
