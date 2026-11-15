import { notices } from '../notices'

/** `toast` of the original UI kit, routed to the Design Mode notices. */
export const toast = {
  error: (title: string, options?: { description?: string }) => notices.error(title, options?.description),
  info: (title: string, options?: { description?: string }) => notices.info(title, options?.description),
  success: (title: string, options?: { description?: string }) => notices.info(title, options?.description),
}
