export namespace browser {
	
	export class BreakpointInfo {
	    id: string;
	    scriptUrl: string;
	    scriptId?: string;
	    lineNumber: number;
	    columnNumber: number;
	    condition?: string;
	
	    static createFrom(source: any = {}) {
	        return new BreakpointInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.scriptUrl = source["scriptUrl"];
	        this.scriptId = source["scriptId"];
	        this.lineNumber = source["lineNumber"];
	        this.columnNumber = source["columnNumber"];
	        this.condition = source["condition"];
	    }
	}
	export class CallFrame {
	    id: string;
	    functionName: string;
	    url: string;
	    scriptId: string;
	    lineNumber: number;
	    columnNumber: number;
	
	    static createFrom(source: any = {}) {
	        return new CallFrame(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.functionName = source["functionName"];
	        this.url = source["url"];
	        this.scriptId = source["scriptId"];
	        this.lineNumber = source["lineNumber"];
	        this.columnNumber = source["columnNumber"];
	    }
	}
	export class ConsoleEntry {
	    id: string;
	    type: string;
	    text: string;
	    timestamp: number;
	
	    static createFrom(source: any = {}) {
	        return new ConsoleEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.type = source["type"];
	        this.text = source["text"];
	        this.timestamp = source["timestamp"];
	    }
	}
	export class CookieEntry {
	    name: string;
	    value: string;
	    domain: string;
	    path: string;
	    expires: number;
	    size: number;
	    httpOnly: boolean;
	    secure: boolean;
	    sameSite: string;
	
	    static createFrom(source: any = {}) {
	        return new CookieEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.value = source["value"];
	        this.domain = source["domain"];
	        this.path = source["path"];
	        this.expires = source["expires"];
	        this.size = source["size"];
	        this.httpOnly = source["httpOnly"];
	        this.secure = source["secure"];
	        this.sameSite = source["sameSite"];
	    }
	}
	export class DOMBreakpointInfo {
	    nodeId: number;
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new DOMBreakpointInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nodeId = source["nodeId"];
	        this.type = source["type"];
	    }
	}
	export class DOMNode {
	    nodeId: number;
	    nodeType: number;
	    nodeName: string;
	    localName: string;
	    nodeValue: string;
	    attributes: string[];
	    childCount: number;
	    children?: DOMNode[];
	
	    static createFrom(source: any = {}) {
	        return new DOMNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nodeId = source["nodeId"];
	        this.nodeType = source["nodeType"];
	        this.nodeName = source["nodeName"];
	        this.localName = source["localName"];
	        this.nodeValue = source["nodeValue"];
	        this.attributes = source["attributes"];
	        this.childCount = source["childCount"];
	        this.children = this.convertValues(source["children"], DOMNode);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DebugTarget {
	    id: string;
	    type: string;
	    title: string;
	    url: string;
	    webSocketDebuggerUrl: string;
	    devtoolsFrontendUrl: string;
	    faviconUrl: string;
	    attached: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DebugTarget(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.type = source["type"];
	        this.title = source["title"];
	        this.url = source["url"];
	        this.webSocketDebuggerUrl = source["webSocketDebuggerUrl"];
	        this.devtoolsFrontendUrl = source["devtoolsFrontendUrl"];
	        this.faviconUrl = source["faviconUrl"];
	        this.attached = source["attached"];
	    }
	}
	export class DebugEndpoint {
	    port: number;
	    host: string;
	    browserName: string;
	    version: string;
	    targets: DebugTarget[];
	
	    static createFrom(source: any = {}) {
	        return new DebugEndpoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.port = source["port"];
	        this.host = source["host"];
	        this.browserName = source["browserName"];
	        this.version = source["version"];
	        this.targets = this.convertValues(source["targets"], DebugTarget);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DebugNetworkEntry {
	    id: string;
	    url: string;
	    method: string;
	    status: number;
	    statusText: string;
	    mimeType: string;
	    requestHeaders: Record<string, string>;
	    responseHeaders: Record<string, string>;
	    timestamp: number;
	    duration: number;
	    size: number;
	    completed: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DebugNetworkEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.url = source["url"];
	        this.method = source["method"];
	        this.status = source["status"];
	        this.statusText = source["statusText"];
	        this.mimeType = source["mimeType"];
	        this.requestHeaders = source["requestHeaders"];
	        this.responseHeaders = source["responseHeaders"];
	        this.timestamp = source["timestamp"];
	        this.duration = source["duration"];
	        this.size = source["size"];
	        this.completed = source["completed"];
	    }
	}
	export class DebugStatus {
	    connected: boolean;
	    port: number;
	    profileDir: string;
	    browserPid: number;
	
	    static createFrom(source: any = {}) {
	        return new DebugStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connected = source["connected"];
	        this.port = source["port"];
	        this.profileDir = source["profileDir"];
	        this.browserPid = source["browserPid"];
	    }
	}
	
	export class PausedState {
	    paused: boolean;
	    reason: string;
	    callFrames: CallFrame[];
	    scriptUrl: string;
	    scriptId: string;
	    lineNumber: number;
	
	    static createFrom(source: any = {}) {
	        return new PausedState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.paused = source["paused"];
	        this.reason = source["reason"];
	        this.callFrames = this.convertValues(source["callFrames"], CallFrame);
	        this.scriptUrl = source["scriptUrl"];
	        this.scriptId = source["scriptId"];
	        this.lineNumber = source["lineNumber"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ScriptInfo {
	    scriptId: string;
	    url: string;
	    startLine: number;
	    endLine: number;
	    executionContextId: number;
	    hash: string;
	
	    static createFrom(source: any = {}) {
	        return new ScriptInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.scriptId = source["scriptId"];
	        this.url = source["url"];
	        this.startLine = source["startLine"];
	        this.endLine = source["endLine"];
	        this.executionContextId = source["executionContextId"];
	        this.hash = source["hash"];
	    }
	}
	export class SourceFileInfo {
	    id: string;
	    url: string;
	    type: string;
	    mimeType: string;
	    scriptId?: string;
	    frameId?: string;
	    startLine: number;
	    endLine: number;
	    canSetBreakpoint: boolean;
	    fromDebugger: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SourceFileInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.url = source["url"];
	        this.type = source["type"];
	        this.mimeType = source["mimeType"];
	        this.scriptId = source["scriptId"];
	        this.frameId = source["frameId"];
	        this.startLine = source["startLine"];
	        this.endLine = source["endLine"];
	        this.canSetBreakpoint = source["canSetBreakpoint"];
	        this.fromDebugger = source["fromDebugger"];
	    }
	}
	export class StorageItem {
	    key: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new StorageItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.value = source["value"];
	    }
	}
	export class ThrottleProfile {
	    name: string;
	    downloadKbps: number;
	    uploadKbps: number;
	    latencyMs: number;
	
	    static createFrom(source: any = {}) {
	        return new ThrottleProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.downloadKbps = source["downloadKbps"];
	        this.uploadKbps = source["uploadKbps"];
	        this.latencyMs = source["latencyMs"];
	    }
	}

}

export namespace docker {
	
	export class ContainerStatus {
	    id: string;
	    name: string;
	    image: string;
	    state: string;
	    status: string;
	    ports: string;
	    running: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ContainerStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.image = source["image"];
	        this.state = source["state"];
	        this.status = source["status"];
	        this.ports = source["ports"];
	        this.running = source["running"];
	    }
	}
	export class HealthCheck {
	    test: string[];
	    interval: string;
	    timeout: string;
	    retries: number;
	
	    static createFrom(source: any = {}) {
	        return new HealthCheck(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.test = source["test"];
	        this.interval = source["interval"];
	        this.timeout = source["timeout"];
	        this.retries = source["retries"];
	    }
	}
	export class DockerService {
	    image: string;
	    ports: string[];
	    environment?: Record<string, string>;
	    volumes?: string[];
	    command?: string;
	    dependsOn?: string[];
	    restart?: string;
	    healthCheck?: HealthCheck;
	    networks?: string[];
	
	    static createFrom(source: any = {}) {
	        return new DockerService(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.image = source["image"];
	        this.ports = source["ports"];
	        this.environment = source["environment"];
	        this.volumes = source["volumes"];
	        this.command = source["command"];
	        this.dependsOn = source["dependsOn"];
	        this.restart = source["restart"];
	        this.healthCheck = this.convertValues(source["healthCheck"], HealthCheck);
	        this.networks = source["networks"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class LabInfo {
	    projectName: string;
	    status: string;
	    configFiles: string;
	
	    static createFrom(source: any = {}) {
	        return new LabInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.projectName = source["projectName"];
	        this.status = source["status"];
	        this.configFiles = source["configFiles"];
	    }
	}
	export class LabOutput {
	    composeContent: string;
	    envContent: string;
	    readmeContent: string;
	
	    static createFrom(source: any = {}) {
	        return new LabOutput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.composeContent = source["composeContent"];
	        this.envContent = source["envContent"];
	        this.readmeContent = source["readmeContent"];
	    }
	}
	export class LabRunResult {
	    projectName: string;
	    dir: string;
	    ids: string[];
	    output: string;
	
	    static createFrom(source: any = {}) {
	        return new LabRunResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.projectName = source["projectName"];
	        this.dir = source["dir"];
	        this.ids = source["ids"];
	        this.output = source["output"];
	    }
	}
	export class PresetDef {
	    id: string;
	    name: string;
	    description: string;
	    tag: string;
	    services: Record<string, DockerService>;
	    volumes?: string[];
	    networks?: string[];
	    envVars: Record<string, string>;
	    readmeIntro: string;
	    readmeSteps: string[];
	
	    static createFrom(source: any = {}) {
	        return new PresetDef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.tag = source["tag"];
	        this.services = this.convertValues(source["services"], DockerService, true);
	        this.volumes = source["volumes"];
	        this.networks = source["networks"];
	        this.envVars = source["envVars"];
	        this.readmeIntro = source["readmeIntro"];
	        this.readmeSteps = source["readmeSteps"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class LogFileEntry {
	    name: string;
	    size: number;
	    modTime: string;
	
	    static createFrom(source: any = {}) {
	        return new LogFileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.size = source["size"];
	        this.modTime = source["modTime"];
	    }
	}
	export class MarkdownFileEntry {
	    name: string;
	    path: string;
	    relPath: string;
	    dir: string;
	    size: number;
	    modifiedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new MarkdownFileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.relPath = source["relPath"];
	        this.dir = source["dir"];
	        this.size = source["size"];
	        this.modifiedAt = source["modifiedAt"];
	    }
	}
	export class MarkdownWorkspaceInfo {
	    root: string;
	    name: string;
	    files: number;
	
	    static createFrom(source: any = {}) {
	        return new MarkdownWorkspaceInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.root = source["root"];
	        this.name = source["name"];
	        this.files = source["files"];
	    }
	}
	export class StorageEntry {
	    bucket: string;
	    key: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new StorageEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.bucket = source["bucket"];
	        this.key = source["key"];
	        this.value = source["value"];
	    }
	}

}

export namespace plugins {
	
	export class ExecRequest {
	    pluginId: string;
	    function: string;
	    args: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new ExecRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pluginId = source["pluginId"];
	        this.function = source["function"];
	        this.args = source["args"];
	    }
	}
	export class ExecResult {
	    success: boolean;
	    data?: Record<string, any>;
	    error?: string;
	    memUsed: number;
	    timeMs: number;
	
	    static createFrom(source: any = {}) {
	        return new ExecResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.data = source["data"];
	        this.error = source["error"];
	        this.memUsed = source["memUsed"];
	        this.timeMs = source["timeMs"];
	    }
	}
	export class HookResult {
	    modified: boolean;
	    data?: Record<string, any>;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new HookResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.modified = source["modified"];
	        this.data = source["data"];
	        this.error = source["error"];
	    }
	}
	export class PluginAction {
	    id: string;
	    name: string;
	    description: string;
	    streaming: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PluginAction(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.streaming = source["streaming"];
	    }
	}
	export class PluginEvent {
	    type: string;
	    payload: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new PluginEvent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.payload = source["payload"];
	    }
	}
	export class PluginHook {
	    event: string;
	    handler: string;
	
	    static createFrom(source: any = {}) {
	        return new PluginHook(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.event = source["event"];
	        this.handler = source["handler"];
	    }
	}
	export class PluginSetting {
	    key: string;
	    label: string;
	    type: string;
	    default: string;
	    options?: string[];
	    description: string;
	
	    static createFrom(source: any = {}) {
	        return new PluginSetting(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.label = source["label"];
	        this.type = source["type"];
	        this.default = source["default"];
	        this.options = source["options"];
	        this.description = source["description"];
	    }
	}
	export class PluginManifest {
	    id: string;
	    name: string;
	    version: string;
	    author: string;
	    description: string;
	    homepage: string;
	    license: string;
	    minAppVersion: string;
	    runtime: string;
	    permissions: string[];
	    hooks: PluginHook[];
	    settings: PluginSetting[];
	    entryPoint: string;
	    icon: string;
	    ui_slots?: string[];
	    actions?: PluginAction[];
	
	    static createFrom(source: any = {}) {
	        return new PluginManifest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.version = source["version"];
	        this.author = source["author"];
	        this.description = source["description"];
	        this.homepage = source["homepage"];
	        this.license = source["license"];
	        this.minAppVersion = source["minAppVersion"];
	        this.runtime = source["runtime"];
	        this.permissions = source["permissions"];
	        this.hooks = this.convertValues(source["hooks"], PluginHook);
	        this.settings = this.convertValues(source["settings"], PluginSetting);
	        this.entryPoint = source["entryPoint"];
	        this.icon = source["icon"];
	        this.ui_slots = source["ui_slots"];
	        this.actions = this.convertValues(source["actions"], PluginAction);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PluginInstance {
	    manifest: PluginManifest;
	    enabled: boolean;
	    settings: Record<string, string>;
	    installDir: string;
	    installedAt: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new PluginInstance(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.manifest = this.convertValues(source["manifest"], PluginManifest);
	        this.enabled = source["enabled"];
	        this.settings = source["settings"];
	        this.installDir = source["installDir"];
	        this.installedAt = source["installedAt"];
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class PluginSandbox {
	    pluginId: string;
	    memory: number;
	    maxMemory: number;
	    running: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PluginSandbox(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pluginId = source["pluginId"];
	        this.memory = source["memory"];
	        this.maxMemory = source["maxMemory"];
	        this.running = source["running"];
	    }
	}

}

export namespace templates {
	
	export class Template {
	    id: string;
	    name: string;
	    description: string;
	    author: string;
	    version: string;
	    category: string;
	    tags: string[];
	    content: string;
	    icon: string;
	    downloads: number;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Template(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.author = source["author"];
	        this.version = source["version"];
	        this.category = source["category"];
	        this.tags = source["tags"];
	        this.content = source["content"];
	        this.icon = source["icon"];
	        this.downloads = source["downloads"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class TemplateCategory {
	    id: string;
	    name: string;
	    icon: string;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new TemplateCategory(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.icon = source["icon"];
	        this.count = source["count"];
	    }
	}

}

export namespace themes {
	
	export class ContrastResult {
	    pair: string;
	    ratio: number;
	    aaNormal: boolean;
	    aaLarge: boolean;
	    aaaNormal: boolean;
	    level: string;
	
	    static createFrom(source: any = {}) {
	        return new ContrastResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pair = source["pair"];
	        this.ratio = source["ratio"];
	        this.aaNormal = source["aaNormal"];
	        this.aaLarge = source["aaLarge"];
	        this.aaaNormal = source["aaaNormal"];
	        this.level = source["level"];
	    }
	}
	export class ThemeFonts {
	    sans: string;
	    mono: string;
	    serif: string;
	
	    static createFrom(source: any = {}) {
	        return new ThemeFonts(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sans = source["sans"];
	        this.mono = source["mono"];
	        this.serif = source["serif"];
	    }
	}
	export class Theme {
	    id: string;
	    name: string;
	    author: string;
	    version: string;
	    description: string;
	    colors: Record<string, string>;
	    fonts: ThemeFonts;
	    spacing: Record<string, string>;
	    radii: Record<string, string>;
	    shadows: Record<string, string>;
	    meta: Record<string, string>;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Theme(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.author = source["author"];
	        this.version = source["version"];
	        this.description = source["description"];
	        this.colors = source["colors"];
	        this.fonts = this.convertValues(source["fonts"], ThemeFonts);
	        this.spacing = source["spacing"];
	        this.radii = source["radii"];
	        this.shadows = source["shadows"];
	        this.meta = source["meta"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ThemeValidationResult {
	    valid: boolean;
	    errors: string[];
	    warnings: string[];
	
	    static createFrom(source: any = {}) {
	        return new ThemeValidationResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.valid = source["valid"];
	        this.errors = source["errors"];
	        this.warnings = source["warnings"];
	    }
	}

}

