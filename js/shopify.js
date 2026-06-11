// Thin wrapper around the Shopify Storefront API (products + cart).
(function () {
  const { domain, storefrontAccessToken, apiVersion } = window.SHOPIFY_CONFIG;
  const ENDPOINT = `https://${domain}/api/${apiVersion}/graphql.json`;
  const CART_ID_KEY = 'raspberry_cart_id';

  const RIYAL_SVG = `<svg class="riyal" viewBox="0 0 1124.14 1256.39" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z"/><path d="M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.42l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.49,52.34-33.45,52.34-64.66v-183.79l132.25-28.11v183.4c0,21.27,18.96,37.55,39.78,34.14,3.86-.63,7.59-1.36,11.34-2.5l350.86-74.59v-135.2l-330.68,70.27v-135.2l295.28-62.78Z"/></svg>`;

  async function shopifyFetch(query, variables = {}) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': storefrontAccessToken,
      },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors) {
      console.error('Shopify API error:', json.errors);
      throw new Error(json.errors[0]?.message || 'Shopify API error');
    }
    return json.data;
  }

  const PRODUCTS_QUERY = `
    query Products($first: Int!) {
      products(first: $first, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            title
            handle
            description
            availableForSale
            featuredImage { url altText }
            images(first: 10) {
              edges { node { url altText } }
            }
            priceRange { minVariantPrice { amount currencyCode } }
            variants(first: 25) {
              edges {
                node {
                  id
                  title
                  availableForSale
                  price { amount currencyCode }
                  selectedOptions { name value }
                }
              }
            }
          }
        }
      }
    }
  `;

  const CART_FRAGMENT = `
    fragment CartFields on Cart {
      id
      checkoutUrl
      totalQuantity
      cost {
        subtotalAmount { amount currencyCode }
      }
      lines(first: 100) {
        edges {
          node {
            id
            quantity
            merchandise {
              ... on ProductVariant {
                id
                title
                price { amount currencyCode }
                product {
                  title
                  handle
                  featuredImage { url altText }
                }
              }
            }
          }
        }
      }
    }
  `;

  const CART_CREATE_MUTATION = `
    ${CART_FRAGMENT}
    mutation CartCreate($lines: [CartLineInput!]) {
      cartCreate(input: { lines: $lines }) {
        cart { ...CartFields }
        userErrors { field message }
      }
    }
  `;

  const CART_QUERY = `
    ${CART_FRAGMENT}
    query GetCart($cartId: ID!) {
      cart(id: $cartId) { ...CartFields }
    }
  `;

  const CART_LINES_ADD_MUTATION = `
    ${CART_FRAGMENT}
    mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart { ...CartFields }
        userErrors { field message }
      }
    }
  `;

  const CART_LINES_UPDATE_MUTATION = `
    ${CART_FRAGMENT}
    mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
      cartLinesUpdate(cartId: $cartId, lines: $lines) {
        cart { ...CartFields }
        userErrors { field message }
      }
    }
  `;

  const CART_LINES_REMOVE_MUTATION = `
    ${CART_FRAGMENT}
    mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
      cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
        cart { ...CartFields }
        userErrors { field message }
      }
    }
  `;

  async function fetchProducts(first = 24) {
    const data = await shopifyFetch(PRODUCTS_QUERY, { first });
    return data.products.edges.map((e) => e.node);
  }

  async function getOrCreateCart() {
    const existingId = localStorage.getItem(CART_ID_KEY);
    if (existingId) {
      try {
        const data = await shopifyFetch(CART_QUERY, { cartId: existingId });
        if (data.cart) return data.cart;
      } catch (e) {
        // fall through and create a fresh cart
      }
    }
    const data = await shopifyFetch(CART_CREATE_MUTATION, { lines: [] });
    const cart = data.cartCreate.cart;
    localStorage.setItem(CART_ID_KEY, cart.id);
    return cart;
  }

  async function addToCart(variantId, quantity = 1) {
    const cart = await getOrCreateCart();
    const data = await shopifyFetch(CART_LINES_ADD_MUTATION, {
      cartId: cart.id,
      lines: [{ merchandiseId: variantId, quantity }],
    });
    if (data.cartLinesAdd.userErrors?.length) {
      throw new Error(data.cartLinesAdd.userErrors[0].message);
    }
    return data.cartLinesAdd.cart;
  }

  async function updateCartLine(cartId, lineId, quantity) {
    const data = await shopifyFetch(CART_LINES_UPDATE_MUTATION, {
      cartId,
      lines: [{ id: lineId, quantity }],
    });
    if (data.cartLinesUpdate.userErrors?.length) {
      throw new Error(data.cartLinesUpdate.userErrors[0].message);
    }
    return data.cartLinesUpdate.cart;
  }

  async function removeCartLines(cartId, lineIds) {
    const data = await shopifyFetch(CART_LINES_REMOVE_MUTATION, { cartId, lineIds });
    if (data.cartLinesRemove.userErrors?.length) {
      throw new Error(data.cartLinesRemove.userErrors[0].message);
    }
    return data.cartLinesRemove.cart;
  }

  function formatPrice(amount, currencyCode) {
    const value = Math.round(parseFloat(amount));
    if (currencyCode === 'SAR') {
      return `${RIYAL_SVG} ${value}`;
    }
    return `${value} ${currencyCode}`;
  }

  window.ShopifyAPI = {
    fetchProducts,
    getOrCreateCart,
    addToCart,
    updateCartLine,
    removeCartLines,
    formatPrice,
    RIYAL_SVG,
  };
})();
