export function ExportCollectionToFolder(folderPath: string, collectionJSON: string): Promise<void> {
  return window['go']['main']['CollectionFS']['ExportCollectionToFolder'](folderPath, collectionJSON)
}

export function ImportCollectionFromFolder(folderPath: string): Promise<string> {
  return window['go']['main']['CollectionFS']['ImportCollectionFromFolder'](folderPath)
}

export function InspectCollectionFolder(folderPath: string, collectionJSON: string): Promise<string> {
  return window['go']['main']['CollectionFS']['InspectCollectionFolder'](folderPath, collectionJSON)
}
