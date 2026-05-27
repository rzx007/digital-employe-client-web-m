export { ArtifactPreview, type ArtifactPreviewProps } from "./artifact-preview"
export { ArtifactPanel, type ArtifactPanelProps } from "./artifact-panel"
export {
  ArtifactHeader,
  type ArtifactHeaderProps,
  ArtifactAction,
  type ArtifactActionProps,
} from "./artifact-header"
export {
  CodeRenderer,
  type CodeRendererProps,
} from "./artifact-content/code-renderer"
/** @deprecated 与 CodeRenderer 相同，保留别名便于旧引用 */
export {
  CodeRenderer as TextRenderer,
  type CodeRendererProps as TextRendererProps,
} from "./artifact-content/code-renderer"
export {
  SheetRenderer,
  type SheetRendererProps,
} from "./artifact-content/sheet-renderer"
export {
  ImageRenderer,
  type ImageRendererProps,
} from "./artifact-content/image-renderer"
export {
  MarkdownArtifactRenderer,
  type MarkdownArtifactRendererProps,
} from "./artifact-content/markdown-artifact-renderer"
export {
  HtmlArtifactRenderer,
  type HtmlArtifactRendererProps,
} from "./artifact-content/html-artifact-renderer"
export {
  PreviewSourceShell,
  type PreviewSourceShellProps,
  type PreviewSourceMode,
} from "./artifact-content/preview-source-shell"
export {
  resolveArtifactRenderer,
  isMarkdownPath,
  isHtmlPath,
} from "./artifact-content/resolve-renderer"
export type { Artifact, ArtifactType } from "./artifact-types"
