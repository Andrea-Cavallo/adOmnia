# adOmnia vs IntelliJ IDEA: opening the adOmnia repository (2026-11-02)

Both tools open the same folder, `adOmnia-workspace\adOmnia`, five times each.
Raw numbers: [vs-intellij-2026-11-02.json](vs-intellij-2026-11-02.json).

## Setup

| | |
|---|---|
| Machine | Intel i7-14700KF (28 threads), 64 GB RAM, Windows 11 Pro |
| Project | adOmnia repository: **45,958 files** in 3,409 folders, 3.3 GB on disk. 3,803 files tracked by Git (1,458 `.go`, 1,836 `.ts`/`.tsx`), 27,980 files in `frontend/node_modules` |
| adOmnia | Release build for Windows (151 MB exe), isolated profile with the project restored in Code Studio (adOmnia does not take a folder on the command line) |
| IntelliJ IDEA | 2026.2.4 (build 262.11879.100), user profile, project already trusted and indexed, folder passed as argument |
| End state | Project open, file tree visible, **no file open** (checked on a screenshot of every run) |

## Method

The same PowerShell script measures both tools. It does one warm-up launch (12 s for adOmnia, 60 s for IntelliJ), then five measured launches. Every value covers the whole process tree (adOmnia + WebView2 + gopls; IntelliJ + its child processes), sampled every 100 ms.

- **Window**: from launch to the first visible window of the tree. For IntelliJ this can be the splash screen.
- **Ready**: tree CPU below 5 % of one core for 1 s in a row (that 1 s is included).
- **CPU**: CPU time consumed up to ready.
- **RAM**: private working set (≈ USS) of the tree at ready.
- **Idle**: average CPU over the 10 s after ready.
- **Close**: from `WM_CLOSE` on the main window to process exit.

## Results (median of 5)

| Metric | adOmnia | IntelliJ IDEA | Difference |
|---|---:|---:|---|
| Window visible | **477 ms** | 608 ms | adOmnia 1.3× faster |
| Ready | **8.3 s** | 19.9 s | adOmnia 2.4× faster |
| CPU up to ready | **5.7 s** | 51.5 s | adOmnia uses 9× less |
| RAM (USS, whole tree) | **477 MB** | 1,999 MB | adOmnia uses 4.2× less |
| Idle CPU | **1.8 %** | 4.3 % | |
| Close | **63 ms** | 3,136 ms | adOmnia 50× faster |

### Per run

adOmnia:

| Run | Window | Ready | CPU | RAM | Idle | Close |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 554 ms | 8,292 ms | 5.67 s | 570 MB | 2.0 % | 68 ms |
| 2 | 477 ms | 9,338 ms | 5.98 s | 475 MB | 2.3 % | 64 ms |
| 3 | 456 ms | 8,112 ms | 5.84 s | 477 MB | 1.8 % | 63 ms |
| 4 | 471 ms | 8,764 ms | 5.53 s | 569 MB | 1.5 % | 62 ms |
| 5 | 488 ms | 8,302 ms | 5.64 s | 472 MB | 1.5 % | 60 ms |

IntelliJ IDEA 2026.2.4:

| Run | Window | Ready | CPU | RAM | Idle | Close |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 569 ms | 24,357 ms | 215.09 s | 3,541 MB | 4.3 % | 3,378 ms |
| 2 | 625 ms | 20,438 ms | 52.00 s | 1,906 MB | 4.9 % | 3,145 ms |
| 3 | 604 ms | 14,831 ms | 48.08 s | 1,924 MB | 2.9 % | 3,129 ms |
| 4 | 618 ms | 13,379 ms | 51.47 s | 2,118 MB | 6.3 % | 3,130 ms |
| 5 | 608 ms | 19,929 ms | 50.64 s | 1,999 MB | 4.1 % | 3,136 ms |

## Notes

- **IntelliJ run 1 is an outlier** (215 s of CPU, 3.5 GB): it was still finishing background work started by the warm-up. The medians do not depend on it; without it IntelliJ is 50–52 s of CPU and 1.9–2.1 GB.
- **adOmnia RAM is in two groups** (≈475 MB or ≈570 MB), depending on whether gopls has loaded the packages by the time the tree goes quiet.
- **"Ready" is a CPU criterion, not "the IDE has finished everything".** IntelliJ keeps working after it (idle 2.9–6.3 %), so its real cost is higher than the table shows. Neither tool had a file open: opening one starts the language server's full analysis in adOmnia and highlighting/inspections in IntelliJ, a different scenario not measured here.
- The two tools do not do the same work. IntelliJ indexes the whole project (including `node_modules`, marked as a library root) for search and refactoring across Go and TypeScript. adOmnia relies on gopls and the TypeScript language server on demand. The numbers measure what the user waits for and pays in CPU and RAM to get a project ready, not equivalent features.
