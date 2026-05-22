import type { RequestItem, ResponseData, ScriptRunResult } from '@/lib/types'

export type ScriptPhase = 'pre' | 'post' | 'tests'

export interface ScriptRuntimeContext {
  request: RequestItem
  vars: Record<string, string>
  response?: ResponseData
  phase: ScriptPhase
}

export interface ScriptRuntimeResult extends ScriptRunResult {
  mutations: Record<string, string | null>
}

const DEFAULT_TIMEOUT_MS = 2000

export async function runRequestScript(
  code: string | undefined,
  context: ScriptRuntimeContext,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ScriptRuntimeResult | null> {
  if (!code?.trim()) return null

  const workerUrl = URL.createObjectURL(new Blob([workerSource()], { type: 'application/javascript' }))
  const worker = new Worker(workerUrl)

  return new Promise((resolve) => {
    const started = performance.now()
    let settled = false

    const finish = (result: Omit<ScriptRuntimeResult, 'durationMs'>) => {
      if (settled) return
      settled = true
      worker.terminate()
      URL.revokeObjectURL(workerUrl)
      resolve({ ...result, durationMs: Math.round(performance.now() - started) })
    }

    const timer = window.setTimeout(() => {
      finish({
        phase: context.phase,
        passed: false,
        tests: [],
        logs: [],
        mutations: {},
        error: `Script timed out after ${timeoutMs} ms`,
      })
    }, timeoutMs)

    worker.onmessage = (event: MessageEvent<Omit<ScriptRuntimeResult, 'durationMs'>>) => {
      window.clearTimeout(timer)
      finish(event.data)
    }

    worker.onerror = (event) => {
      window.clearTimeout(timer)
      finish({
        phase: context.phase,
        passed: false,
        tests: [],
        logs: [],
        mutations: {},
        error: event.message || 'Script failed',
      })
    }

    worker.postMessage({
      code,
      phase: context.phase,
      vars: context.vars,
      request: toScriptRequest(context.request),
      response: context.response ? toScriptResponse(context.response) : undefined,
    })
  })
}

function toScriptRequest(request: RequestItem) {
  const headers: Record<string, string> = {}
  request.headers?.forEach((h) => {
    if (h.enabled && h.key) headers[h.key] = h.value
  })

  const activeBody = request.bodies?.[request.activeBodyIdx] ?? request.bodies?.[0]
  return {
    id: request.id,
    name: request.name,
    method: request.method,
    url: request.url,
    headers,
    body: activeBody?.raw ?? '',
  }
}

function toScriptResponse(response: ResponseData) {
  return {
    code: response.status,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body: response.body,
    responseTime: response.ms,
    size: response.size,
  }
}

function workerSource(): string {
  return `
    self.onmessage = async (event) => {
      const { code, phase, vars, request, response } = event.data;
      const mutations = {};
      const tests = [];
      const logs = [];
      const env = { ...vars };

      const recordSet = (key, value) => {
        const k = String(key);
        const v = value == null ? '' : String(value);
        env[k] = v;
        mutations[k] = v;
      };

      const recordUnset = (key) => {
        const k = String(key);
        delete env[k];
        mutations[k] = null;
      };

      const fail = (message) => { throw new Error(message); };
      const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const makeExpect = (actual) => {
        const api = {
          to: {},
          not: {},
        };
        const assertEqual = (expected) => {
          if (actual !== expected) fail('expected ' + JSON.stringify(actual) + ' to equal ' + JSON.stringify(expected));
        };
        const assertDeepEqual = (expected) => {
          if (!deepEqual(actual, expected)) fail('expected ' + JSON.stringify(actual) + ' to deeply equal ' + JSON.stringify(expected));
        };
        const assertInclude = (expected) => {
          if (typeof actual === 'string') {
            if (!actual.includes(String(expected))) fail('expected ' + JSON.stringify(actual) + ' to include ' + JSON.stringify(expected));
            return;
          }
          if (Array.isArray(actual)) {
            if (!actual.includes(expected)) fail('expected array to include ' + JSON.stringify(expected));
            return;
          }
          fail('include assertion requires a string or array');
        };
        const assertMatch = (pattern) => {
          const re = pattern instanceof RegExp ? pattern : new RegExp(String(pattern));
          if (!re.test(String(actual))) fail('expected ' + JSON.stringify(actual) + ' to match ' + re);
        };
        const assertAbove = (expected) => {
          if (!(Number(actual) > Number(expected))) fail('expected ' + actual + ' to be above ' + expected);
        };
        const assertBelow = (expected) => {
          if (!(Number(actual) < Number(expected))) fail('expected ' + actual + ' to be below ' + expected);
        };
        const assertExists = () => {
          if (actual === undefined || actual === null) fail('expected value to exist');
        };
        api.to.equal = assertEqual;
        api.to.eql = assertDeepEqual;
        api.to.deep = { equal: assertDeepEqual };
        api.to.include = assertInclude;
        api.to.match = assertMatch;
        api.to.be = {
          above: assertAbove,
          below: assertBelow,
          true: () => { if (actual !== true) fail('expected value to be true'); },
          false: () => { if (actual !== false) fail('expected value to be false'); },
          ok: () => { if (!actual) fail('expected value to be truthy'); },
        };
        api.to.exist = assertExists;
        api.not.to = {
          equal: (expected) => { if (actual === expected) fail('expected ' + JSON.stringify(actual) + ' not to equal ' + JSON.stringify(expected)); },
          include: (expected) => {
            if (typeof actual === 'string' && actual.includes(String(expected))) fail('expected string not to include ' + JSON.stringify(expected));
            if (Array.isArray(actual) && actual.includes(expected)) fail('expected array not to include ' + JSON.stringify(expected));
          },
        };
        return api;
      };

      const pm = {
        request,
        response: response ? {
          ...response,
          text: () => response.body || '',
          json: () => JSON.parse(response.body || 'null'),
          headers: {
            all: () => Object.entries(response.headers || {}).map(([key, value]) => ({ key, value })),
            get: (key) => {
              const found = Object.keys(response.headers || {}).find((h) => h.toLowerCase() === String(key).toLowerCase());
              return found ? response.headers[found] : undefined;
            },
          },
          to: { have: { status: (status) => makeExpect(response.status).to.equal(status) } },
        } : undefined,
        environment: {
          get: (key) => env[String(key)],
          set: recordSet,
          unset: recordUnset,
          toObject: () => ({ ...env }),
        },
        variables: {
          get: (key) => env[String(key)],
          set: recordSet,
          unset: recordUnset,
          toObject: () => ({ ...env }),
        },
        test: (name, fn) => {
          try {
            fn();
            tests.push({ name: String(name), passed: true });
          } catch (error) {
            tests.push({ name: String(name), passed: false, error: error instanceof Error ? error.message : String(error) });
          }
        },
        expect: makeExpect,
      };

      const console = {
        log: (...args) => logs.push(args.map((v) => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')),
        warn: (...args) => logs.push('warn: ' + args.map(String).join(' ')),
        error: (...args) => logs.push('error: ' + args.map(String).join(' ')),
      };

      try {
        await new Function('pm', 'console', '"use strict"; return (async () => {\\n' + code + '\\n})()')(pm, console);
        self.postMessage({ phase, passed: tests.every((test) => test.passed), tests, logs, mutations });
      } catch (error) {
        self.postMessage({
          phase,
          passed: false,
          tests,
          logs,
          mutations,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
  `
}
