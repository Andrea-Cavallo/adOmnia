/** Native file and folder pickers of the desktop app; outside it (browser preview) they return '' and the field stays editable. */
import { SelectFile, SelectFolder } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/app'

/** A file path, or '' when the user cancels or there is no desktop runtime. */
export async function pickFile(title: string, filterLabel = '', pattern = ''): Promise<string> {
  try {
    return (await SelectFile(title, filterLabel, pattern)) ?? ''
  } catch {
    return ''
  }
}

/** A folder path, or '' when the user cancels or there is no desktop runtime. */
export async function pickFolder(title: string): Promise<string> {
  try {
    return (await SelectFolder(title)) ?? ''
  } catch {
    return ''
  }
}
