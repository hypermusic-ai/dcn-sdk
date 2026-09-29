export const ADDR = '0x1111111111111111111111111111111111111111';
export const FORMAT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const HASH = `0x${'c'.repeat(64)}`;
export const TX = `0x${'d'.repeat(64)}`;

export function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
