import { formatToml, type TomlFormatOptions } from './tomlFormat'

self.onmessage = (event: MessageEvent<{ source: string; options: TomlFormatOptions }>) => {
  void formatToml(event.data.source, event.data.options).then(
    text => self.postMessage({ text }),
    error => self.postMessage({ error: error instanceof Error ? error.message : String(error) }),
  )
}
