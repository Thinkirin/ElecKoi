import { createContext, useContext } from "react";

const MarkdownComponentContext = createContext(null);
const markdownLabels = Object.freeze({
  code: Object.freeze({
    copyLabel: "复制",
    copiedLabel: "已复制",
    toolbarLabels: Object.freeze({
      codeLabel: "代码",
      wrapLabel: "自动换行",
      unwrapLabel: "不换行",
    }),
  }),
  footnotes: "脚注",
});

export function OfficialMarkdownProvider({ component, children }) {
  return <MarkdownComponentContext.Provider value={component || null}>{children}</MarkdownComponentContext.Provider>;
}

export function OfficialMarkdown({ content, streaming = false }) {
  const MarkdownText = useContext(MarkdownComponentContext);
  if (!MarkdownText) throw new Error("DSH 官方文字渲染组件未接入。");
  return <div className="eleckoi-dsh-markdown">
    <MarkdownText text={content || ""} streaming={streaming} labels={markdownLabels} />
  </div>;
}
