// Common English words.
//
// This exists because of a specific failure. Importing 938 GitHub topics added
// `support`, `first`, `state`, `order` and `value` to the vocabulary -- every one
// a real topic page, and every one a word that appears in ordinary prose. The
// tagger promptly put "support" on 204 stories and "first" on 127.
//
// A blocklist of the words that had gone wrong would have worked until the next
// import. The actual question is "is this an ordinary English word", so the
// actual answer is a list of ordinary English words: roughly the six hundred
// most frequent, which is where the overlap with product names lives. Beyond
// that the frequency curve flattens and real technologies start appearing
// (`rust`, `swift`, `arrow`, `beam`), so a longer list would cost recall
// without buying precision.
//
// Nothing here is excluded from the vocabulary. It is excluded from being
// claimed by a lowercase match in a headline, which is a different thing.

export const COMMON_ENGLISH = new Set([
  // articles, pronouns, prepositions, conjunctions
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'while',
  'for', 'of', 'to', 'in', 'on', 'at', 'by', 'from', 'with', 'without', 'about',
  'into', 'onto', 'over', 'under', 'above', 'below', 'between', 'through',
  'during', 'before', 'after', 'again', 'once', 'here', 'there', 'where', 'why',
  'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'only', 'own', 'same', 'than', 'too', 'very', 'can', 'will', 'just',
  'should', 'now', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him',
  'his', 'she', 'her', 'it', 'its', 'they', 'them', 'their', 'this', 'that',
  'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'doing', 'would', 'could', 'may',
  'might', 'must', 'shall', 'not', 'no', 'nor', 'so', 'up', 'down', 'out', 'off',
  'as', 'because', 'until', 'against', 'among', 'per', 'via', 'upon',

  // ordinals, quantities, time
  'first', 'second', 'third', 'fourth', 'fifth', 'last', 'next', 'previous',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years', 'time',
  'times', 'today', 'tomorrow', 'yesterday', 'hour', 'hours', 'minute', 'now',
  'early', 'late', 'later', 'soon', 'never', 'always', 'often', 'ever',

  // the ordinary verbs and nouns of a headline
  'support', 'supports', 'supported', 'help', 'helps', 'need', 'needs', 'want',
  'use', 'uses', 'used', 'using', 'make', 'makes', 'made', 'making', 'get',
  'gets', 'got', 'give', 'gives', 'take', 'takes', 'taken', 'come', 'comes',
  'go', 'goes', 'going', 'gone', 'know', 'knows', 'known', 'think', 'thinks',
  'see', 'sees', 'seen', 'look', 'looks', 'find', 'finds', 'found', 'work',
  'works', 'working', 'worked', 'call', 'calls', 'called', 'try', 'tries',
  'ask', 'asks', 'asked', 'seem', 'seems', 'feel', 'feels', 'leave', 'leaves',
  'put', 'puts', 'mean', 'means', 'keep', 'keeps', 'let', 'lets', 'begin',
  'begins', 'start', 'starts', 'started', 'stop', 'stops', 'end', 'ends',
  'show', 'shows', 'shown', 'run', 'runs', 'running', 'move', 'moves', 'moved',
  'live', 'lives', 'believe', 'hold', 'holds', 'bring', 'brings', 'happen',
  'happens', 'write', 'writes', 'written', 'read', 'reads', 'sit', 'stand',
  'lose', 'loses', 'lost', 'pay', 'pays', 'meet', 'meets', 'include',
  'includes', 'continue', 'set', 'sets', 'learn', 'learns', 'change', 'changes',
  'changed', 'lead', 'leads', 'watch', 'watches', 'follow', 'follows', 'create',
  'creates', 'speak', 'speaks', 'allow', 'allows', 'add', 'adds', 'added',
  'spend', 'grow', 'grows', 'open', 'opens', 'opened', 'walk', 'win', 'wins',
  'offer', 'offers', 'remember', 'love', 'loves', 'consider', 'appear',
  'appears', 'buy', 'buys', 'wait', 'waits', 'serve', 'serves', 'die', 'send',
  'sends', 'sent', 'build', 'builds', 'built', 'stay', 'fall', 'falls', 'cut',
  'cuts', 'reach', 'kill', 'raise', 'pass', 'passes', 'sell', 'sells', 'decide',
  'return', 'returns', 'explain', 'hope', 'develop', 'carry', 'break', 'breaks',
  'receive', 'agree', 'report', 'reports', 'drop', 'drops', 'push', 'pull',
  'fix', 'fixes', 'fixed', 'ship', 'ships', 'shipped', 'launch', 'launches',

  'man', 'woman', 'child', 'people', 'person', 'thing', 'things', 'way', 'ways',
  'life', 'hand', 'part', 'parts', 'place', 'places', 'case', 'cases', 'point',
  'points', 'group', 'groups', 'problem', 'problems', 'fact', 'facts', 'name',
  'names', 'world', 'school', 'state', 'states', 'family', 'student', 'country',
  'countries', 'job', 'jobs', 'word', 'words', 'business', 'issue', 'issues',
  'side', 'sides', 'kind', 'kinds', 'head', 'house', 'service', 'services',
  'friend', 'father', 'mother', 'power', 'hour', 'line', 'lines', 'end', 'member',
  'members', 'law', 'laws', 'car', 'city', 'community', 'level', 'levels',
  'office', 'door', 'health', 'person', 'art', 'war', 'history', 'party',
  'result', 'results', 'change', 'morning', 'reason', 'reasons', 'research',
  'moment', 'air', 'teacher', 'force', 'education', 'foot', 'boy', 'age',
  'policy', 'process', 'music', 'market', 'sense', 'nation', 'plan', 'plans',
  'college', 'interest', 'death', 'experience', 'effect', 'effects', 'use',
  'class', 'control', 'care', 'field', 'fields', 'development', 'role', 'roles',
  'effort', 'rule', 'rules', 'area', 'areas', 'money', 'story', 'stories',
  'fact', 'month', 'lot', 'right', 'rights', 'study', 'book', 'eye', 'job',
  'word', 'guy', 'number', 'numbers', 'value', 'values', 'order', 'orders',
  'size', 'sizes', 'type', 'types', 'form', 'forms', 'view', 'views', 'note',
  'notes', 'list', 'item', 'items', 'step', 'steps', 'top', 'bottom', 'back',
  'front', 'center', 'left', 'space', 'team', 'teams', 'user', 'users',

  // adjectives that turn up as project names
  'good', 'better', 'best', 'bad', 'worse', 'worst', 'new', 'old', 'great',
  'high', 'low', 'small', 'large', 'big', 'little', 'long', 'short', 'young',
  'important', 'public', 'private', 'able', 'free', 'full', 'sure', 'real',
  'early', 'possible', 'human', 'local', 'hard', 'easy', 'major', 'minor',
  'clear', 'recent', 'strong', 'true', 'false', 'simple', 'complex', 'common',
  'general', 'special', 'similar', 'different', 'available', 'ready', 'live',
  'fast', 'slow', 'safe', 'clean', 'light', 'dark', 'deep', 'wide', 'close',
  'final', 'single', 'double', 'multiple', 'native', 'modern', 'basic', 'core',

  // Words the GitHub topic index turned into aliases, every one of which is
  // ordinary prose in a technology headline.
  'code', 'coding', 'source', 'sources', 'resource', 'resources', 'project',
  'projects', 'program', 'programs', 'software', 'hardware', 'system',
  'systems', 'platform', 'platforms', 'tool', 'tools', 'framework', 'library',
  'package', 'module', 'component', 'components', 'service', 'services',
  'feature', 'features', 'version', 'versions', 'release', 'releases',
  'update', 'updates', 'support', 'documentation', 'example', 'examples',
]);

/** True when a token is ordinary prose rather than plausibly a name. */
export function isCommonWord(token: string): boolean {
  return COMMON_ENGLISH.has(token.toLowerCase().trim());
}
