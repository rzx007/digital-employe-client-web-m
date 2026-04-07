export type ArtifactType = "text" | "code" | "sheet" | "image"

export interface Artifact {
  id: string
  type: ArtifactType
  title: string
  content: string
  language?: string
  metadata?: Record<string, any>
}

export interface ArtifactMetadata {
  artifactToolCallId: string
  artifact: Artifact
}
