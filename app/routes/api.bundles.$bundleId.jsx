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

export const action = async ({ request, params }) => {
  if (request.method !== "DELETE") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let bundleId = params.bundleId;
  if (!bundleId) {
    return json({ error: "Missing bundle id" }, { status: 400 });
  }
  try {
    bundleId = decodeURIComponent(bundleId);
  } catch {
    // use raw param
  }

  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const existing = await prisma.bundle.findFirst({
    where: { id: bundleId, shop },
  });

  if (!existing) {
    return json({ error: "Bundle not found" }, { status: 404 });
  }

  await prisma.bundle.delete({ where: { id: bundleId } });

  return json({ ok: true });
};
