# Local LLM chat

Code Studio's AI hub includes **Local LLM** for OpenAI-compatible loopback servers such as LM Studio or Ollama. Configure the endpoint, list models and select a model. Enable image input only for a model that supports it. Endpoint credentials stay in memory.

The Wails sidecar carries streaming requests to loopback HTTP/HTTPS endpoints, requires its session token and does not follow redirects. The browser does not contact inference servers directly. No model weights are downloaded by adOmnia.

Project tools can list files, read files, search symbols and propose an exact text replacement. Project AI policy and context exclusions apply. Proposals require an explicit Apply action and update an unsaved editor buffer only when its original content still matches. The model cannot save files or execute shell commands through these tools.

Visible text history is retained locally per project, with bounded context sent to the model. Images and generated edit proposals are not persisted. Stop cancels the streaming network request.

Verification on 2026-10-29: focused transport, policy, edit and conversation tests passed; browser fixtures exercised model discovery, tool reads, proposed edits, image payloads and cancellation. Local Ollama responded but its registered chat models referenced missing weights, so actual model inference was not verified. Native desktop acceptance remains open.
