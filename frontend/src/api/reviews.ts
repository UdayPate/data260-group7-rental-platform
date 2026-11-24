// Review Service: /reviews/*
import { apiBaseUrls } from '../config'
import type { ListResponse, PagedResponse } from '../types/api'
import type {
  CreateReviewRequest,
  GetReviewRequest,
  RespondToReviewRequest,
  Review,
  ReviewsByGuestRequest,
  ReviewsByPropertyRequest,
} from '../types/review'
import { post } from './client'

const base = apiBaseUrls.reviews

export const createReview = (body: CreateReviewRequest) => post<Review>(base, '/reviews/create', body)
export const getReview = (body: GetReviewRequest) => post<Review>(base, '/reviews/get', body)
export const reviewsByProperty = (body: ReviewsByPropertyRequest) =>
  post<PagedResponse<Review>>(base, '/reviews/byProperty', body)
export const reviewsByGuest = (body: ReviewsByGuestRequest) => post<ListResponse<Review>>(base, '/reviews/byGuest', body)
export const respondToReview = (body: RespondToReviewRequest) => post<Review>(base, '/reviews/respond', body)
