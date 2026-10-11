// Intercept /blog?page=N and 301 to /blog/N/.
// Cloudflare _redirects cannot match query strings in the source path, so the
// old pagination URLs are handled here. run_worker_first in wrangler.jsonc
// limits this worker to exactly /blog; every other request is served straight
// from static assets without invoking this script.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/blog") {
      const page = Number(url.searchParams.get("page"));
      if (Number.isInteger(page) && page >= 2 && page < 100000) {
        return Response.redirect(new URL(`/blog/${page}/`, url).toString(), 301);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
