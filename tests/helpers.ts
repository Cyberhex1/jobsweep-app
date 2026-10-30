import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Db } from '../src/main/db'

export const plainCipher = { encrypt: (s: string) => 'x:' + Buffer.from(s).toString('base64'), decrypt: (s: string) => Buffer.from(s.slice(2), 'base64').toString() }

export function tempDb(): Db {
  return new Db(join(mkdtempSync(join(tmpdir(), 'jsdb-')), 'test.db'), plainCipher)
}
