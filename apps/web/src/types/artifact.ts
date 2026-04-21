export type ArtifactType = "text" | "code" | "sheet" | "image" | "skill-draft"

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

export interface ResourceEntry {
  name: string
  path: string
  entry_type: "file" | "directory"
  artifact_type: ArtifactType | null
  size: number
  modified_at: number | null
  children: ResourceEntry[] | null
}

export interface ResourceList {
  artifacts: ResourceEntry[]
  skills_draft: ResourceEntry[]
}

export interface ResourceContent {
  path: string
  content: string
  artifact_type: ArtifactType
  language: string | null
}
