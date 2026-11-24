// AI Agent Service: /ai/*  (the live stream is in src/realtime/aiStream.ts)
import { apiBaseUrls } from '../config'
import type {
  AiResult,
  ApproveAiRequest,
  CreateAiRequest,
  CreateAiResponse,
  GetAiTaskResponse,
  RejectAiRequest,
} from '../types/ai'
import { get, post } from './client'

const base = apiBaseUrls.ai

export const createAiRequest = (body: CreateAiRequest) => post<CreateAiResponse>(base, '/ai/requests', body)
export const getAiTask = (taskId: string) => get<GetAiTaskResponse>(base, `/ai/tasks/${encodeURIComponent(taskId)}`)
export const getAiResult = (taskId: string) => get<AiResult>(base, `/ai/results/${encodeURIComponent(taskId)}`)
export const approveAiResult = (taskId: string, body: ApproveAiRequest) =>
  post<AiResult>(base, `/ai/tasks/${encodeURIComponent(taskId)}/approve`, body)
export const rejectAiResult = (taskId: string, body: RejectAiRequest) =>
  post<AiResult>(base, `/ai/tasks/${encodeURIComponent(taskId)}/reject`, body)
