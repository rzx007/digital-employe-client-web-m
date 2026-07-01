export type PetState =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review"

export const PET_STATES: PetState[] = [
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review",
]

export const PET_FRAMES_PER_ROW: Record<PetState, number> = {
  idle: 6,
  "running-right": 8,
  "running-left": 8,
  waving: 4,
  jumping: 5,
  failed: 8,
  waiting: 6,
  running: 6,
  review: 6,
}

export const PET_DURATIONS: Record<PetState, number[]> = {
  idle: [280, 110, 110, 140, 140, 320],
  "running-right": [120, 120, 120, 120, 120, 120, 120, 220],
  "running-left": [120, 120, 120, 120, 120, 120, 120, 220],
  waving: [140, 140, 140, 280],
  jumping: [140, 140, 140, 140, 280],
  failed: [140, 140, 140, 140, 140, 140, 140, 240],
  waiting: [150, 150, 150, 150, 150, 260],
  running: [120, 120, 120, 120, 120, 220],
  review: [150, 150, 150, 150, 150, 280],
}

export const PET_STATE_LABELS: Record<PetState, string> = {
  idle: "待命中",
  "running-right": "执行中",
  "running-left": "执行中",
  waving: "互动中",
  jumping: "已完成",
  failed: "出错了",
  waiting: "思考中",
  running: "运行中",
  review: "审查中",
}

export const PET_SHEET_COLS = 8
export const PET_SHEET_FRAME_W = 192
export const PET_SHEET_FRAME_H = 208
export const PET_SHEET_W = 1536
export const PET_SHEET_H = 1872
