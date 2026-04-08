import { createFileRoute } from "@tanstack/react-router"
import { RecruitmentPage } from "@/components/employee/recruitment-page"

export const Route = createFileRoute("/recruitment")({
  component: RecruitmentPage,
})
