export type PetState =
  | "idle"
  | "listening"
  | "thinking"
  | "acting"
  | "speaking"
  | "error"

export const petStateLabels: Record<PetState, string> = {
  idle: "待命中",
  listening: "聆听中",
  thinking: "思考中",
  acting: "执行中",
  speaking: "说话中",
  error: "出错了",
}
