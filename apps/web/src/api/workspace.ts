import { request } from "@/lib/request"

interface WorkspaceData {
  id: number
  name: string
  root_path: string
  user_id: string | null
}

export async function getMyWorkspace(
  userId: string,
  username: string,
): Promise<WorkspaceData> {
  const res = await request<{ data: WorkspaceData }>("/workspaces/my", {
    method: "POST",
    body: { user_id: userId, username },
  })
  return res.data
}
