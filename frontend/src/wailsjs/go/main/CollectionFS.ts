export function ExportCollectionToFolder(folderPath: string, collectionJSON: string, environmentsJSON: string): Promise<void> {
  return window['go']['main']['CollectionFS']['ExportCollectionToFolder'](folderPath, collectionJSON, environmentsJSON)
}

export function ImportCollectionFromFolder(folderPath: string): Promise<string> {
  return window['go']['main']['CollectionFS']['ImportCollectionFromFolder'](folderPath)
}

export function InspectCollectionFolder(folderPath: string, collectionJSON: string): Promise<string> {
  return window['go']['main']['CollectionFS']['InspectCollectionFolder'](folderPath, collectionJSON)
}

export function ExportRequestToFolder(folderPath: string, requestJSON: string): Promise<string> {
  return window['go']['main']['CollectionFS']['ExportRequestToFolder'](folderPath, requestJSON)
}
