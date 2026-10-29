import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/ThankYou.jsx' {
  const shopify: import('@shopify/ui-extensions/purchase.thank-you.header.render-after').Api;
  const globalThis: { shopify: typeof shopify };
}
