import { Fragment, type ReactNode } from "react";
import type { DocMark, DocNode } from "@/lib/contract/document";

/** 変数を埋めた本文（resolveDocument の結果）をHTMLとして表示する */
export function ContractBody({ doc }: { doc: DocNode }) {
  return <div className="contract-body">{renderChildren(doc.content)}</div>;
}

function renderChildren(nodes: DocNode[] | undefined): ReactNode {
  return (nodes ?? []).map((n, i) => <Fragment key={i}>{renderNode(n)}</Fragment>);
}

function wrapMarks(text: ReactNode, marks: DocMark[] | undefined): ReactNode {
  let out = text;
  for (const m of marks ?? []) {
    if (m.type === "bold") out = <strong>{out}</strong>;
    else if (m.type === "italic") out = <em>{out}</em>;
    else if (m.type === "underline") out = <u>{out}</u>;
    else if (m.type === "strike") out = <s>{out}</s>;
    else if (m.type === "var") out = <span className="var">{out}</span>;
    else if (m.type === "missing") out = <span className="missing">{out}</span>;
  }
  return out;
}

function renderNode(n: DocNode): ReactNode {
  switch (n.type) {
    case "text":
      return wrapMarks(n.text, n.marks);
    case "hardBreak":
      return <br />;
    case "paragraph":
      return <p>{renderChildren(n.content)}</p>;
    case "heading": {
      const level = Number(n.attrs?.level ?? 2);
      if (level === 1) return <h1>{renderChildren(n.content)}</h1>;
      if (level === 3) return <h3>{renderChildren(n.content)}</h3>;
      return <h2>{renderChildren(n.content)}</h2>;
    }
    case "bulletList":
      return <ul>{renderChildren(n.content)}</ul>;
    case "orderedList":
      return <ol start={Number(n.attrs?.start ?? 1)}>{renderChildren(n.content)}</ol>;
    case "listItem":
      return <li>{renderChildren(n.content)}</li>;
    case "blockquote":
      return <blockquote>{renderChildren(n.content)}</blockquote>;
    case "horizontalRule":
      return <hr />;
    case "table":
      return (
        <div className="overflow-x-auto">
          <table>
            <tbody>{renderChildren(n.content)}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr>{renderChildren(n.content)}</tr>;
    case "tableHeader":
      return <th colSpan={Number(n.attrs?.colspan ?? 1)}>{renderChildren(n.content)}</th>;
    case "tableCell":
      return <td colSpan={Number(n.attrs?.colspan ?? 1)}>{renderChildren(n.content)}</td>;
    case "variable":
      return <span className="missing">{`{{${String(n.attrs?.key ?? "")}}}`}</span>;
    default:
      return renderChildren(n.content);
  }
}
