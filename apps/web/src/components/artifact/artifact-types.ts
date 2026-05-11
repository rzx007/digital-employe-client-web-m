export type ArtifactType = "text" | "code" | "sheet" | "image" | "skill-draft" | "document"

export interface Artifact {
  id: string
  type: ArtifactType
  title: string
  content: string
  language?: string
  metadata?: Record<string, any>
}
