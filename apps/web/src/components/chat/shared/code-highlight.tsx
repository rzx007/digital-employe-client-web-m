"use client"

import { useEffect, useState } from "react"
import { highlightCode } from "@workspace/ui/lib/highlight-code"
import { cn } from "@workspace/ui/lib/utils"

const EXT_LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  html: "html",
  css: "css",
  scss: "scss",
  less: "less",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  xml: "xml",
  vue: "vue",
  svelte: "svelte",
  dockerfile: "dockerfile",
  toml: "toml",
  ini: "ini",
  graphql: "graphql",
  gql: "graphql",
}

export function detectLanguage(
  filePath: string | undefined | null
): string | undefined {
  if (!filePath) return undefined
  const segments = filePath.split(/[/\\]/)
  const filename = segments[segments.length - 1] ?? ""
  if (filename.toLowerCase() === "dockerfile") return "dockerfile"
  const dotIndex = filename.lastIndexOf(".")
  if (dotIndex < 0) return undefined
  const ext = filename.slice(dotIndex + 1).toLowerCase()
  return EXT_LANG_MAP[ext] ?? ext
}

interface CodeHighlightProps {
  code: string
  language?: string
  className?: string
  /** 流式写入时跳过异步高亮，避免每个 delta 都跑 highlightCode */
  streaming?: boolean
}

export function CodeHighlight({
  code,
  language,
  className,
  streaming = false,
}: CodeHighlightProps) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    if (streaming) {
      setHtml(null)
      return
    }
    let cancelled = false
    highlightCode(code, language)
      .then((result) => {
        if (!cancelled) setHtml(result)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [code, language, streaming])

  if (html) {
    return (
      <div
        className={cn(
          "[&_code]:font-mono [&_code]:text-xs",
          "[&_pre]:m-0 [&_pre]:bg-transparent [&_pre]:p-2.5",
          "[&_pre]:max-w-full [&_pre]:overflow-x-auto",
          className
        )}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  return (
    <pre
      className={cn(
        "m-0 p-2.5 font-mono text-xs whitespace-pre-wrap text-muted-foreground/70",
        className
      )}
    >
      {code}
    </pre>
  )
}
