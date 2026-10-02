import * as GoIDEBindings from '../../bindings/adomnia/goide'
import type { CoverageReport, TestResult, TestRunRequest, TestRunSnapshot, TestSummary } from '../../bindings/adomnia/internal/goide/models'

export type GoIDETestRunRequest = TestRunRequest
export type GoIDETestRun = TestRunSnapshot
export type GoIDETestResult = TestResult
export type GoIDETestSummary = TestSummary
export type GoIDECoverageReport = CoverageReport

export async function startGoIDETests(request: TestRunRequest): Promise<TestRunSnapshot> {
  return GoIDEBindings.StartTests(request)
}

export async function getGoIDETestRun(runId: string): Promise<TestRunSnapshot> {
  return GoIDEBindings.GetTestRun(runId)
}

export async function getGoIDETestOutput(runId: string, nodeId: string): Promise<string> {
  return GoIDEBindings.GetTestOutput(runId, nodeId)
}

export async function listGoIDETestRuns(sessionId: string): Promise<TestRunSnapshot[]> {
  return GoIDEBindings.ListTestRuns(sessionId)
}

/** Aggiunge ai package (pattern relativi al modulo) quelli che li importano, anche solo nei test. */
export async function affectedGoIDETestPackages(sessionId: string, moduleDirectory: string, packages: string[]): Promise<string[]> {
  return GoIDEBindings.AffectedTestPackages(sessionId, moduleDirectory, packages)
}
