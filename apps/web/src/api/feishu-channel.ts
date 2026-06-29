import { request } from "@/lib/request"
import type { ApiResponse } from "./types"

export interface QrcodeResp {
  qrcode_img: string
  poll_token: string
}

export interface PollResp {
  status: "waiting" | "success" | "expired" | "fail"
  credentials: {
    app_id?: string
    app_secret?: string
    open_id?: string
    fail_reason?: string
  }
}

export async function fetchQrcode(channel = "feishu"): Promise<QrcodeResp> {
  const res = await request<ApiResponse<QrcodeResp>>(
    `/channels/${channel}/qrcode`,
    { retry: 0 }
  )
  return res.data
}

export async function pollQrcodeStatus(
  token: string,
  channel = "feishu"
): Promise<PollResp> {
  const res = await request<ApiResponse<PollResp>>(
    `/channels/${channel}/qrcode/status`,
    { params: { token }, retry: 0 }
  )
  return res.data
}

export interface TestResp {
  ok: boolean
  message: string
}

export async function testChannelCredentials(
  appId: string,
  appSecret: string,
  channel = "feishu"
): Promise<TestResp> {
  const res = await request<ApiResponse<TestResp>>(
    `/channels/${channel}/test`,
    {
      method: "POST",
      body: { app_id: appId, app_secret: appSecret },
      retry: 0,
    }
  )
  return res.data
}
