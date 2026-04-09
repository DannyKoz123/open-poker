import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  return new Response('PHH export is not implemented yet.\n', {
    status: 501,
    headers: {
      'content-type': 'text/plain; charset=utf-8'
    }
  });
};
