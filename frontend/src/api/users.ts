// User Service: /guests/* and /hosts/*
import { apiBaseUrls } from '../config'
import type { PagedResponse } from '../types/api'
import type {
  CreateGuestRequest,
  DeleteGuestRequest,
  DeleteGuestResponse,
  GetGuestRequest,
  Guest,
  SearchGuestsRequest,
  UpdateGuestRequest,
} from '../types/guest'
import type { CreateHostRequest, GetHostRequest, Host, UpdateHostRequest } from '../types/host'
import { post } from './client'

const base = apiBaseUrls.users

export const createGuest = (body: CreateGuestRequest) => post<Guest>(base, '/guests/create', body)
export const getGuest = (body: GetGuestRequest) => post<Guest>(base, '/guests/get', body)
export const updateGuest = (body: UpdateGuestRequest) => post<Guest>(base, '/guests/update', body)
export const deleteGuest = (body: DeleteGuestRequest) => post<DeleteGuestResponse>(base, '/guests/delete', body)
export const searchGuests = (body: SearchGuestsRequest) => post<PagedResponse<Guest>>(base, '/guests/search', body)

export const createHost = (body: CreateHostRequest) => post<Host>(base, '/hosts/create', body)
export const getHost = (body: GetHostRequest) => post<Host>(base, '/hosts/get', body)
export const updateHost = (body: UpdateHostRequest) => post<Host>(base, '/hosts/update', body)
