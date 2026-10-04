import { test as baseTest } from 'vitest';
import { Shopping } from './shopping.js';
import { HttpShoppingDriver } from '../driver/http-shopping.js';
import { startShop } from '../../src/shop.js';
// Resources finish acquisition before fallible domain preparation begins.
export const test = baseTest
  .extend('shop', async ({}, { onCleanup }) => {
    const server = await startShop();
    onCleanup(() => server.close());
    return server;
  })
  .extend('shopping', async ({ shop }) => {
    await shop.prepareCatalog();
    return new Shopping(new HttpShoppingDriver(shop.url));
  });
