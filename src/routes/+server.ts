import { astroHomepageHtml } from '$lib/server/generated/astro-homepage';

export const prerender = false;

export function GET() {
  return new Response(astroHomepageHtml, {
    headers: {
      'cache-control': 'public, max-age=0, must-revalidate',
      'content-type': 'text/html; charset=utf-8'
    }
  });
}
