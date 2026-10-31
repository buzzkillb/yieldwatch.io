import { buildRssFeed, SUMMARIES, postHeadline, truncateWords } from '../lib/site';

const RSS_EXCERPT_LIMIT = 300;

export const GET = () => {
  const posts = [...SUMMARIES]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 200)
    .map(s => ({
      date: s.date,
      title: postHeadline(s.date),
      excerpt: truncateWords(s.summary || s.blogSummary || '', RSS_EXCERPT_LIMIT),
    }));
  return new Response(buildRssFeed(posts), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};
