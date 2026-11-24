// Messaging Service: /threads/* and /messages/*
import { apiBaseUrls } from '../config'
import type { ListResponse } from '../types/api'
import type {
  GetThreadRequest,
  ListMessagesRequest,
  Message,
  OpenThreadRequest,
  SendMessageRequest,
  ThreadsByUserRequest,
  ThreadSummary,
} from '../types/message'
import { post } from './client'

const base = apiBaseUrls.messaging

export const openThread = (body: OpenThreadRequest) => post<ThreadSummary>(base, '/threads/open', body)
export const getThread = (body: GetThreadRequest) => post<ThreadSummary>(base, '/threads/get', body)
export const threadsByUser = (body: ThreadsByUserRequest) => post<ListResponse<ThreadSummary>>(base, '/threads/byUser', body)
export const listMessages = (body: ListMessagesRequest) => post<ListResponse<Message>>(base, '/messages/list', body)
export const sendMessage = (body: SendMessageRequest) => post<Message>(base, '/messages/send', body)

// Pages that change read state fire this so the header's unread badge refreshes right away.
export const MESSAGES_CHANGED_EVENT = 'messages-changed'
export const announceMessagesChanged = () => window.dispatchEvent(new Event(MESSAGES_CHANGED_EVENT))
