// Property Service: /properties/*
import { apiBaseUrls } from '../config'
import type { ListResponse, PagedResponse } from '../types/api'
import type {
  AvailabilityBlock,
  BlockDatesRequest,
  GetAvailabilityRequest,
  UnblockDatesRequest,
  UnblockDatesResponse,
} from '../types/availability'
import type {
  CreatePropertyRequest,
  DeletePropertyRequest,
  DeletePropertyResponse,
  GetPropertyRequest,
  Property,
  PropertySearchResult,
  PropertyWithSaved,
  SavePropertyRequest,
  SavePropertyResponse,
  SearchPropertiesRequest,
  UpdatePropertyRequest,
} from '../types/property'
import { post } from './client'

const base = apiBaseUrls.properties

export const createProperty = (body: CreatePropertyRequest) => post<Property>(base, '/properties/create', body)
export const getProperty = (body: GetPropertyRequest) => post<PropertyWithSaved>(base, '/properties/get', body)
export const updateProperty = (body: UpdatePropertyRequest) => post<Property>(base, '/properties/update', body)
export const deleteProperty = (body: DeletePropertyRequest) =>
  post<DeletePropertyResponse>(base, '/properties/delete', body)
export const searchProperties = (body: SearchPropertiesRequest) =>
  post<PagedResponse<PropertySearchResult>>(base, '/properties/search', body)
export const saveProperty = (body: SavePropertyRequest) => post<SavePropertyResponse>(base, '/properties/save', body)
export const getAvailability = (body: GetAvailabilityRequest) =>
  post<ListResponse<AvailabilityBlock>>(base, '/properties/availability', body)
// Same endpoint with action "block" / "unblock" (host only).
export const blockDates = (body: Omit<BlockDatesRequest, 'action'>) =>
  post<AvailabilityBlock>(base, '/properties/availability', { ...body, action: 'block' })
export const unblockDates = (body: Omit<UnblockDatesRequest, 'action'>) =>
  post<UnblockDatesResponse>(base, '/properties/availability', { ...body, action: 'unblock' })
