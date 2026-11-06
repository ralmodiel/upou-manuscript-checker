// The topic planner moved to its own site, so its old tab (#topic) forwards there. Its plans and
// the helper's "fetched" mark sit in this origin's storage, which that site shares: they move to
// its key names first (kept where it already has its own).
;(function () {
  try {
    for (var k of [
      'upou-topic-plans',
      'upou-topic-plan',
      'upou-topic-ai',
      'upou-topic-ai-probe',
      'upou-topic-ai-verified',
    ]) {
      var v = localStorage.getItem(k)
      var to = k.slice('upou-'.length)
      if (v !== null && localStorage.getItem(to) === null) {
        localStorage.setItem(to, v)
        localStorage.removeItem(k)
      }
    }
  } catch {
    // No storage, or no room: the old keys stay for the next visit.
  }
  if (location.hash === '#topic')
    location.replace('https://ralmodiel.github.io/concept-topic-planner/')
})()
