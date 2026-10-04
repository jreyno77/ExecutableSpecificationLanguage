import { options } from '../../src/shop.js';
export class HttpShoppingDriver {
  constructor(private readonly serverUrl: string) {}
  private async request(path: string, values: Record<string, string> = {}): Promise<unknown> {
    const response = await fetch(this.serverUrl + path + '?' + new URLSearchParams(values));
    if (!response.ok) throw Error('Shop request failed: ' + response.status);
    return response.json();
  }
  async bookIsAvailable(title: string): Promise<void> { await this.request('/available', { title }); }
  async startWithEmptyBasket(): Promise<void> { await this.request('/empty'); }
  async addBook(title: string): Promise<void> { await this.request('/add', { title }); }
  async bookQuantity(title: string): Promise<number> {
    if (options().quantity === 'unimplemented') throw Error('Not implemented: shopping.bookQuantity');
    const value = await this.request('/quantity', { title }); if (typeof value !== 'number') throw Error('Invalid actual quantity'); return value;
  }
  async purchase(title: string): Promise<string> { const value = await this.request('/purchase', { title }); if (typeof value !== 'string') throw Error('Invalid receipt'); return value; }
  async receiptTitle(receipt: string): Promise<string> { const value = await this.request('/receipt', { receipt }); if (typeof value !== 'string') throw Error('Invalid receipt title'); return value; }
}
