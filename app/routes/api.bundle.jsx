import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { mainProductId, bundledProductIds } = payload || {};

  if (!mainProductId || !Array.isArray(bundledProductIds)) {
    return json({ error: "Missing fields" }, { status: 400 });
  }

  const bundledJson = JSON.stringify(bundledProductIds);

  const bundle = await prisma.bundle.upsert({
    where: {
      id: `${shop}_${mainProductId}`,
    },
    update: {
      bundledProductIds: bundledJson,
    },
    create: {
      id: `${shop}_${mainProductId}`,
      shop,
      mainProductId,
      bundledProductIds: bundledJson,
    },
  });

  return json({ bundle });
};

