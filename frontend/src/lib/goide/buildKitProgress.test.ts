import { describe, expect, it } from 'vitest'
import { buildKitProgress } from './buildKitProgress'
describe('BuildKit progress', () => {
  it('keeps real cached, completed and failed stage state across interleaved output', () => {
    expect(buildKitProgress('#1 [internal] load Dockerfile\n#2 [builder 1/2] COPY . .\n#1 DONE 0.2s\n#2 CACHED\n#3 [builder 2/2] RUN go build\n#3 0.1 compiler output\n#3 ERROR compiler failed')).toEqual([
      {id:'1',title:'[internal] load Dockerfile',state:'done',duration:'0.2s'},
      {id:'2',title:'[builder 1/2] COPY . .',state:'cached',duration:undefined},
      {id:'3',title:'[builder 2/2] RUN go build',state:'error',duration:'compiler failed'},
    ])
  })
  it('does not mistake application output for Docker steps', () => { expect(buildKitProgress('2026 INFO worker started\n#2 user data')).toEqual([]) })
})
