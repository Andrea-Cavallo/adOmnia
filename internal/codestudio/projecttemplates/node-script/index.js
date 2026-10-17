import { greet } from './greet.js'

console.log(greet(process.argv[2] ?? 'world'))
