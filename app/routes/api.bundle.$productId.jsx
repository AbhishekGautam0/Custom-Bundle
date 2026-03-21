import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

/** Match storefront numeric variant IDs to Admin GraphQL GIDs stored in DB. */
function normalizeVariantGid(raw) {
  const s = decodeURIComponent(String(raw || ""));
  if (s.startsWith("gid://shopify/ProductVariant/")) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/ProductVariant/${s}`;
  return s;
}

const corsJsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export const loader = async ({ request, params }) => {
  const productId = params.productId;
  if (!productId) {
    return json({ error: "Missing productId" }, { status: 400 });
  }

  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");

  let admin;
  let shop;

  if (shopParam) {
    try {
      const ctx = await unauthenticated.admin(shopParam);
      admin = ctx.admin;
      shop = ctx.session.shop;
    } catch {
      return new Response(JSON.stringify({ bundle: null, error: "Invalid shop" }), {
        status: 200,
        headers: corsJsonHeaders,
      });
    }
  } else {
    try {
      const ctx = await authenticate.admin(request);
      admin = ctx.admin;
      shop = ctx.session.shop;
    } catch {
      return json(
        { error: "Missing ?shop=your-store.myshopify.com for storefront requests" },
        { status: 401 },
      );
    }
  }

  const mainVariantGid = normalizeVariantGid(productId);

  const bundle = await prisma.bundle.findFirst({
    where: { shop, mainProductId: mainVariantGid },
  });

  if (!bundle) {
    return new Response(JSON.stringify({ bundle: null, products: [] }), {
      status: 200,
      headers: corsJsonHeaders,
    });
  }

  let ids = [];
  try {
    ids = JSON.parse(bundle.bundledProductIds || "[]");
  } catch {
    ids = [];
  }

  if (!Array.isArray(ids) || !ids.length) {
    return new Response(JSON.stringify({ bundle, products: [] }), {
      status: 200,
      headers: corsJsonHeaders,
    });
  }

  const query = `#graphql
    query BundleProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          legacyResourceId
          title
          image {
            url
            altText
          }
          product {
            title
            handle
            onlineStoreUrl
            featuredImage {
              url
              altText
            }
          }
          price
        }
      }
    }
  `;

  const response = await admin.graphql(query, { variables: { ids } });
  const jsonResp = await response.json();

  const products =
    jsonResp.data?.nodes?.filter(Boolean).map((node) => ({
      id: node.id,
      /** Use this with /cart/add.js (numeric variant id). */
      legacyResourceId: node.legacyResourceId,
      title: node.product?.title ?? node.title,
      variantTitle: node.title,
      handle: node.product?.handle,
      url:
        node.product?.onlineStoreUrl ??
        (node.product?.handle ? `/products/${node.product.handle}` : "#"),
      price: node.price,
      imageUrl: node.image?.url ?? node.product?.featuredImage?.url ?? null,
      imageAlt:
        node.image?.altText ??
        node.product?.featuredImage?.altText ??
        node.product?.title ??
        node.title,
    })) ?? [];

  return new Response(JSON.stringify({ bundle, products }), {
    status: 200,
    headers: corsJsonHeaders,
  });
};
