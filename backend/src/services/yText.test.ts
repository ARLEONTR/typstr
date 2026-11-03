import test from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { replaceYText } from './yText.js'

function replaced(current: string, content: string): string {
  const document = new Y.Doc()
  const text = document.getText('content')
  text.insert(0, current)
  document.transact(() => replaceYText(text, content))

  // Through an encoded update, as collaborators and the database receive it.
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(document))
  return copy.getText('content').toString()
}

test('replaces text exactly, including emoji next to the change', () => {
  const cases: Array<[string, string]> = [
    ['hello world', 'hello brave world'],
    ['abc', ''],
    ['', 'abc'],
    ['same', 'same'],
    ['a😀b', 'a😁b'],
    ['😀😀', '😀'],
    ['x😀', 'x😀😀'],
    ['🇹🇷 flag', '🇹🇷🇹🇷 flag'],
    ['ünïcödé', 'ünïcode'],
  ]
  for (const [current, content] of cases) {
    assert.equal(replaced(current, content), content, `${current} -> ${content}`)
  }
})

test('keeps a concurrent edit elsewhere in place', () => {
  const server = new Y.Doc()
  const serverText = server.getText('content')
  serverText.insert(0, 'first line\nsecond line\nthird line\n')
  const client = new Y.Doc()
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server))

  // The client types at the end while the server replaces the first line.
  client.getText('content').insert(client.getText('content').length, 'typed\n')
  server.transact(() => replaceYText(serverText, 'FIRST line\nsecond line\nthird line\n'))

  Y.applyUpdate(server, Y.encodeStateAsUpdate(client))
  assert.equal(serverText.toString(), 'FIRST line\nsecond line\nthird line\ntyped\n')
})
