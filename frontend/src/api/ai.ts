// AI Agent Service: /ai/*  (the live stream is in src/realtime/aiStream.ts)
import { apiBaseUrls } from '../config'
import type {
  AiResult,
  ApproveAiRequest,
  CreateAiRequest,
  CreateAiResponse,
  FeedbackItem,
  GetAiTaskResponse,
  RejectAiRequest,
  VersionsResponse,
} from '../types/ai'
import type { ListResponse } from '../types/api'
import { get, post } from './client'

const base = apiBaseUrls.ai

export const createAiRequest = (body: CreateAiRequest) => post<CreateAiResponse>(base, '/ai/requests', body)
export const getAiTask = (taskId: string) => get<GetAiTaskResponse>(base, `/ai/tasks/${encodeURIComponent(taskId)}`)
export const getAiResult = (taskId: string) => get<AiResult>(base, `/ai/results/${encodeURIComponent(taskId)}`)
export const approveAiResult = (taskId: string, body: ApproveAiRequest) =>
  post<AiResult>(base, `/ai/tasks/${encodeURIComponent(taskId)}/approve`, body)
export const rejectAiResult = (taskId: string, body: RejectAiRequest) =>
  post<AiResult>(base, `/ai/tasks/${encodeURIComponent(taskId)}/reject`, body)

// Self-improvement (spec 7.5.4), admin only.
export const getAiFeedback = () => get<ListResponse<FeedbackItem>>(base, '/ai/feedback')
export const getMatcherVersions = () => get<VersionsResponse>(base, '/ai/versions')
export const promoteMatcherVersion = (versionId: string) =>
  post<VersionsResponse>(base, `/ai/versions/${encodeURIComponent(versionId)}/promote`, {})
export const rollbackMatcherVersion = (versionId: string) =>
  post<VersionsResponse>(base, `/ai/versions/${encodeURIComponent(versionId)}/rollback`, {})
