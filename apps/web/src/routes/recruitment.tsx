import { createFileRoute } from "@tanstack/react-router"
import { RecruitmentPage } from "@/components/employee/recruitment-page"
import { AppTitlebar } from "@/components/chat/shell/app-titlebar"

export const Route = createFileRoute("/recruitment")({
  component: RecruitmentPageRoute,
})

function RecruitmentPageRoute() {
  return (
    <div className="flex h-svh flex-col overflow-hidden">
      {/* <AppTitlebar /> */}
      <RecruitmentPage />
    </div >
  )
}