// User Service: sign-up and login. Both return a token and who it belongs to.
import { apiBaseUrls } from '../config'
import type { AuthResponse, LoginRequest, SignupRequest } from '../types/auth'
import { post } from './client'

const base = apiBaseUrls.users

export const signup = (body: SignupRequest) => post<AuthResponse>(base, '/auth/signup', body)
export const login = (body: LoginRequest) => post<AuthResponse>(base, '/auth/login', body)
