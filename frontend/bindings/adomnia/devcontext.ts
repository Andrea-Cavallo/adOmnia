// Hand-written until `wails3 generate bindings` runs in this environment.
// IDs are FNV-1a 32-bit of "main.DevContext.<Method>", the same scheme the
// generator uses (checked against main.OASLint.Lint = 325496117).

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: Unused imports
import { Call as $Call, CancellablePromise as $CancellablePromise } from "@wailsio/runtime";

export function GetContext(sessionID: string): $CancellablePromise<any> {
    return $Call.ByID(276047489, sessionID);
}

export function RescanContext(sessionID: string): $CancellablePromise<any> {
    return $Call.ByID(1975717609, sessionID);
}

export function CheckStale(sessionID: string): $CancellablePromise<boolean> {
    return $Call.ByID(2169833367, sessionID);
}

export function ReadContextFile(sessionID: string, relPath: string): $CancellablePromise<string> {
    return $Call.ByID(1346169035, sessionID, relPath);
}
