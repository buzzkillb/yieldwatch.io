import { buildSitemap } from '../lib/site';

export const GET = () => {
  return new Response(buildSitemap(), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
