// Reporter di adOmnia per `node --test`: una riga JSON per ogni test concluso.
// I reporter integrati (tap, junit, spec) non dicono in quale file è un test passato; l'evento sì.
import path from 'node:path';

const PREFIX = 'ADOMNIA-NODE-TEST ';

const messageOf = (error) => String(error?.cause?.message ?? error?.message ?? '');
const stackOf = (error) => String(error?.cause?.stack ?? error?.stack ?? '');

export default async function* adomniaReporter(source) {
  const names = [];
  for await (const { type, data } of source) {
    if (type === 'test:start') {
      names[data.nesting] = data.name;
      continue;
    }
    if (type !== 'test:pass' && type !== 'test:fail') continue;
    const failed = type === 'test:fail';
    const error = failed ? data.details?.error : undefined;
    // Una suite fallita perché lo sono i suoi test non va contata due volte; una che fallisce da sola (hook) sì.
    if (data.details?.type === 'suite' && (!failed || error?.failureType === 'subtestsFailed')) continue;
    if (!data.file) continue;
    const fileLevel = data.nesting === 0 && path.resolve(process.cwd(), data.name) === data.file;
    const record = {
      file: data.file,
      path: fileLevel ? [] : [...names.slice(0, data.nesting), data.name],
      status: failed ? 'fail' : data.skip !== undefined || data.todo !== undefined ? 'skip' : 'pass',
      ms: data.details?.duration_ms ?? 0,
      line: data.line ?? 0,
    };
    if (failed) {
      record.message = messageOf(error);
      record.stack = stackOf(error);
    }
    yield PREFIX + JSON.stringify(record) + '\n';
  }
}
