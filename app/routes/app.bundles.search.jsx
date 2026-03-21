import { authenticate } from "../shopify.server";

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

export const action = async ({ request }) => {
  const formData = await request.formData();
  const q = (formData.get("q") ?? "").toString().trim();

  if (!q || q.length < 1) {
    return json({ products: [], error: null });
  }

  const { admin } = await authenticate.admin(request);

  const searchQuery = q ? `status:ACTIVE AND title:*${q}*` : "status:ACTIVE";

  const query = `#graphql
    query SearchProducts($query: String!) {
      products(first: 20, query: $query) {
        edges {
          node {
            id
            title
            status
            featuredImage {
              url
              altText
            }
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                  availableForSale
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await admin.graphql(query, {
    variables: { query: searchQuery },
  });
  const jsonResp = await response.json();

  if (jsonResp.errors?.length) {
    const message = jsonResp.errors.map((e) => e.message).join("; ");
    return json({ products: [], error: message });
  }

  const edges = jsonResp.data?.products?.edges ?? [];
  const products = edges.map((edge) => {
    const n = edge.node;
    return {
      id: n.id,
      title: n.title,
      featuredImage: n.featuredImage,
      variants: (n.variants?.edges?.map((e) => e.node) ?? []).filter(v => v.availableForSale),
    };
  }).filter(p => p.variants.length > 0);

  return json({ products, error: null });
};

