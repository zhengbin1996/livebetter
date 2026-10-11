function isReadableKind(kind) {
  return kind === 'book' || kind === 'doc'
}

function readableDocs(essentials) {
  return ((essentials && essentials.docs) || []).filter((entry) => entry.kind === 'doc')
}

function readableHits(hits, essentials) {
  const docs = readableDocs(essentials)
  const readable = (hits || []).filter((hit) => !hit.kind || hit.kind === 'item' || (hit.kind === 'doc' && (hit.docKind === 'doc' || (!hit.docKind && docs.some((entry) => entry.sid === hit.sid)))))
  return readable.filter((hit) => hit.kind !== 'doc').concat(readable.filter((hit) => hit.kind === 'doc'))
}

module.exports = { isReadableKind, readableDocs, readableHits }
