import { createServer } from 'node:http';
import { appendFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
export interface ShopOptions { addBook?: 'no-op'; asynchronousStartup?: boolean; asynchronousAdd?: boolean; afterStartFailure?: string; closeFailure?: string; quantity?: 'unimplemented'; observedQuantities?: number[]; nextReceipt?: string; denyStart?: boolean }
export function options(): ShopOptions { return JSON.parse(readFileSync('shop-options.json', 'utf8')); }
const wait = () => new Promise(resolve => setTimeout(resolve, 30));
export async function startShop() {
  const settings = options(), id = randomUUID(), available = new Set<string>(), basket = new Map<string, number>(), receipts = new Map<string, string>();
  const record = (event: string, data: object = {}) => appendFileSync('shop-events.jsonl', JSON.stringify({ id, event, ...data }) + '\n');
  if (settings.denyStart) { record('forbidden-start'); throw Error('Runtime started during generation'); }
  let observations = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://localhost'), title = url.searchParams.get('title') ?? '';
    response.setHeader('Content-Type', 'application/json');
    switch (url.pathname) {
      case '/available': available.add(title); record('available', { title }); break;
      case '/empty': basket.clear(); record('empty'); break;
      case '/add':
        if (settings.asynchronousAdd) await wait();
        if (!available.has(title)) { response.statusCode = 400; response.end(JSON.stringify('Unavailable book')); return; }
        if (settings.addBook !== 'no-op') basket.set(title, (basket.get(title) ?? 0) + 1);
        record('added', { title, quantity: basket.get(title) ?? 0 }); break;
      case '/quantity': {
        const actual = basket.get(title) ?? 0, value = settings.observedQuantities?.at(observations++) ?? actual;
        record('observed', { title, actual, returned: value }); response.end(JSON.stringify(value)); return;
      }
      case '/purchase': { const receipt = settings.nextReceipt ?? 'r-42'; receipts.set(receipt, title); record('purchased', { receipt, title }); response.end(JSON.stringify(receipt)); return; }
      case '/receipt': { const receipt = url.searchParams.get('receipt')!; record('receipt-read', { receipt }); response.end(JSON.stringify(receipts.get(receipt))); return; }
      default: response.statusCode = 404;
    }
    response.end('null');
  });
  if (settings.asynchronousStartup) await wait();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Expected actual listening TCP server');
  record('started', { port: address.port });
  return {
    url: 'http://127.0.0.1:' + address.port,
    async prepareCatalog() { if (settings.afterStartFailure) throw Error(settings.afterStartFailure); },
    async close() {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      record('closed', { listening: server.listening, contents: [...basket] });
      if (settings.closeFailure) throw Error(settings.closeFailure);
    },
  };
}
