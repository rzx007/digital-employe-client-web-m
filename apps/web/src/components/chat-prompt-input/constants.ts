export const ACCEPTED_FILE_TYPES =
  ".txt,.md,.csv,.tsv,.json,.xml,.yaml,.yml,.toml,.ini,.cfg,.conf,.log,.env," +
  ".py,.js,.ts,.tsx,.jsx,.html,.css,.scss,.less,.vue,.svelte," +
  ".java,.go,.rs,.c,.cpp,.h,.hpp,.cs,.rb,.php,.swift,.kt,.scala," +
  ".sh,.bash,.zsh,.sql,.r,.m," +
  ".png,.jpg,.jpeg,.gif,.svg,.webp," +
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx," +
  ".geojson,.jsonl,.ndjson"

export const MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024

/** 与 ACCEPTED_FILE_TYPES 中的图片后缀一致 */
export const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
])
