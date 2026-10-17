import { beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ save: vi.fn(), flush: vi.fn(), schedule: vi.fn(), close: vi.fn(), set: vi.fn() }))
vi.mock('@/stores/codeStudio', () => ({ useCodeStudioStore: { getState: () => ({ documents: [{ dirty: true, document: { id: 'dirty-file' } }], saveDocument: api.save }) } }))
vi.mock('./storeSave', () => ({ flushPendingSaves: api.flush }))
vi.mock('../../bindings/adomnia/app', () => ({ ScheduleUpdateOnExit: api.schedule }))
vi.mock('@/stores/updater', () => ({ useUpdaterStore: { setState: api.set } }))
vi.mock('@wailsio/runtime', () => ({ Window: { Close: api.close } }))
import { restartForUpdate } from './updateRestart'
beforeEach(() => { vi.clearAllMocks(); api.save.mockResolvedValue(true); api.flush.mockResolvedValue(undefined); api.schedule.mockResolvedValue({ scheduled: true }); api.close.mockResolvedValue(undefined) })
describe('update restart', () => {
  it('saves dirty files and flushes persistent writes before guarded native close', async () => {
    await restartForUpdate()
    expect(api.save).toHaveBeenCalledWith('dirty-file')
    expect(api.flush).toHaveBeenCalledWith(true)
    expect(api.save.mock.invocationCallOrder[0]).toBeLessThan(api.flush.mock.invocationCallOrder[0])
    expect(api.flush.mock.invocationCallOrder[0]).toBeLessThan(api.close.mock.invocationCallOrder[0])
  })
  it('does not close or schedule when an editor save fails', async () => {
    api.save.mockResolvedValue(false)
    await expect(restartForUpdate()).rejects.toThrow('Could not save')
    expect(api.schedule).not.toHaveBeenCalled(); expect(api.close).not.toHaveBeenCalled()
  })
  it('does not close or schedule on failed persistent writes', async () => {
    api.flush.mockRejectedValue(new Error('disk full'))
    await expect(restartForUpdate()).rejects.toThrow('disk full')
    expect(api.schedule).not.toHaveBeenCalled(); expect(api.close).not.toHaveBeenCalled()
  })
})
