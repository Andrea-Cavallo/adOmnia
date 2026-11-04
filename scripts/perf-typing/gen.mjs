// Generates the load project: a typing file, a log flood, slow tests, a debug loop and 150 packages with type errors.
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const root = join(process.env.PERF_WORK ?? join(tmpdir(), 'adomnia-perf-typing'), 'project')
const write = (path, text) => { const f = join(root, path); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text) }

write('go.mod', 'module perfload\n\ngo 1.24\n')
let medium = 'package main\n\nimport "fmt"\n\nfunc main() {}\n\n'
for (let i = 0; i < 555; i++) medium += `// Medium${i} adds its arguments and prints the result.\nfunc Medium${i}(a, b int) int {\n\ttotal := a + b\n\tif total > ${i} {\n\t\tfmt.Println("large", total)\n\t}\n\treturn total\n}\n\n`
write('medium.go', medium)
write('flood/main.go', 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfor i := 0; ; i++ {\n\t\tfmt.Println("INFO request handled path=/api/v1/items id=", i, "status=200 duration=12ms")\n\t}\n}\n')
write('slowtests/s_test.go', 'package slowtests\n\nimport (\n\t"fmt"\n\t"testing"\n\t"time"\n)\n\nfunc TestMany(t *testing.T) {\n\tfor i := 0; i < 6000; i++ {\n\t\tt.Run(fmt.Sprintf("case_%d", i), func(t *testing.T) {\n\t\t\tt.Log("working on it")\n\t\t\ttime.Sleep(5 * time.Millisecond)\n\t\t})\n\t}\n}\n')
write('debugloop/main.go', 'package main\n\nimport (\n\t"fmt"\n\t"time"\n)\n\nfunc main() {\n\tfor i := 0; ; i++ {\n\t\tfmt.Println("tick", i)\n\t\ttime.Sleep(5 * time.Millisecond)\n\t}\n}\n')
for (let i = 0; i < 150; i++) {
  let file = `package p${i}\n\n`
  for (let j = 0; j < 40; j++) file += `func F${j}() int { var s string = ${j}; return missing${j} + s }\n`
  write(`pkgs/p${i}/f.go`, file)
}
