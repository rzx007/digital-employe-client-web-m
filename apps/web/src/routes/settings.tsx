import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { SettingsPage } from "@/components/settings"

const settingsSearchSchema = z.object({
  tab: z
    .enum([
      "account",
      "general",
      "shortcuts",
      "models",
      "pet",
      "extensions",
      "about",
    ])
    .optional(),
})

export const Route = createFileRoute("/settings")({
  validateSearch: (search) => settingsSearchSchema.parse(search),
  component: SettingsPage,
})
