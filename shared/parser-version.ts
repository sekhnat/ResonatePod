/**
 * Which version of the feed parser (shared/feed.ts) read a show. Raise it whenever the parser starts reading something
 * new from feeds: a show read by an older one is then fetched in full once, without the validators that would let the
 * server answer "not modified", so what the parser now reads reaches shows that were subscribed before.
 *
 * 1: before this was recorded (a show without `parser`). 2: Podcasting 2.0 people, numbering, funding, soundbites,
 * location, license and GUID.
 */
export const PARSER_VERSION = 2;
