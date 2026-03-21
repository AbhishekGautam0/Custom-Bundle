import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  EmptyState,
  InlineStack,
  Layout,
  Modal,
  Page,
  Select,
  Spinner,
  Tabs,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const bundles = await prisma.bundle.findMany({
    where: { shop },
    orderBy: { updatedAt: "desc" },
  });

  const allIds = new Set();
  for (const b of bundles) {
    allIds.add(b.mainProductId);
    try {
      const parsed = JSON.parse(b.bundledProductIds || "[]");
      if (Array.isArray(parsed)) {
        parsed.forEach((id) => allIds.add(id));
      }
    } catch {
      // ignore invalid JSON
    }
  }

  const ids = Array.from(allIds).filter(Boolean);
  let titleById = {};

  if (ids.length) {
    const r = await admin.graphql(
      `#graphql
        query BundleTitleNodes($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              title
              product {
                title
              }
            }
          }
        }
      `,
      { variables: { ids } },
    );
    const j = await r.json();
    for (const node of j.data?.nodes ?? []) {
      if (node?.id) {
        const pt = node.product?.title;
        const vt = node.title;
        titleById[node.id] = pt
          ? `${pt}${vt && vt !== "Default Title" ? ` – ${vt}` : ""}`
          : vt || node.id;
      }
    }
  }

  return { bundles, titleById };
};

export default function BundlesPage() {
  const { bundles, titleById } = useLoaderData();
  const revalidator = useRevalidator();
  const searchFetcher = useFetcher();

  const [selectedTab, setSelectedTab] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBundleId, setEditingBundleId] = useState(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVariantByProduct, setSelectedVariantByProduct] = useState({});

  /** Main line item: storefront uses variant GID */
  const [main, setMain] = useState(null);
  /** Bundled variant lines */
  const [bundledItems, setBundledItems] = useState([]);

  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const debounceRef = useRef(null);

  const searchResults = useMemo(
    () => searchFetcher.data?.products ?? [],
    [searchFetcher.data],
  );
  const searchError = searchFetcher.data?.error ?? null;
  const searchLoading = searchFetcher.state !== "idle";

  const runSearch = useCallback(() => {
    const q = searchQuery.trim();
    if (!q) return;
    const fd = new FormData();
    fd.set("q", q);
    searchFetcher.submit(fd, {
      method: "post",
      action: "/app/bundles/search",
    });
  }, [searchQuery, searchFetcher]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = searchQuery.trim();
    if (q.length < 2) return;
    debounceRef.current = setTimeout(() => {
      const fd = new FormData();
      fd.set("q", q);
      searchFetcher.submit(fd, {
        method: "post",
        action: "/app/bundles/search",
      });
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, searchFetcher]);

  const resetModal = useCallback(() => {
    setEditingBundleId(null);
    setMain(null);
    setBundledItems([]);
    setSearchQuery("");
    setSelectedVariantByProduct({});
    setSaveError(null);
  }, []);

  const openCreateModal = useCallback(() => {
    resetModal();
    setModalOpen(true);
  }, [resetModal]);

  const openEditModal = useCallback(
    (bundle) => {
      setEditingBundleId(bundle.id);
      setSaveError(null);
      setSearchQuery("");
      const mainTitle =
        titleById[bundle.mainProductId] || bundle.mainProductId;
      setMain({
        variantId: bundle.mainProductId,
        productTitle: mainTitle,
        image: null,
      });
      let parsed = [];
      try {
        parsed = JSON.parse(bundle.bundledProductIds || "[]");
      } catch {
        parsed = [];
      }
      if (!Array.isArray(parsed)) parsed = [];
      setBundledItems(
        parsed.map((vid) => ({
          variantId: vid,
          productTitle: titleById[vid] || vid,
        })),
      );
      setModalOpen(true);
    },
    [titleById],
  );

  const variantIdForProduct = useCallback(
    (product) => {
      const variants = product.variants || [];
      if (!variants.length) return null;
      const picked = selectedVariantByProduct[product.id];
      if (picked && variants.some((v) => v.id === picked)) return picked;
      return variants[0].id;
    },
    [selectedVariantByProduct],
  );

  const handleSetMain = useCallback((product) => {
    const vid = variantIdForProduct(product);
    if (!vid) return;
    setMain({
      variantId: vid,
      productTitle: product.title,
      image: product.featuredImage?.url ?? null,
    });
    setBundledItems((prev) => prev.filter((b) => b.variantId !== vid));
  }, [variantIdForProduct]);

  const toggleBundled = useCallback(
    (product, checked) => {
      const vid = variantIdForProduct(product);
      if (!vid) return;
      if (main?.variantId === vid) return;

      if (checked) {
        setBundledItems((prev) => {
          if (prev.some((b) => b.variantId === vid)) return prev;
          return [
            ...prev,
            {
              variantId: vid,
              productTitle: product.title,
            },
          ];
        });
      } else {
        setBundledItems((prev) => prev.filter((b) => b.variantId !== vid));
      }
    },
    [main?.variantId, variantIdForProduct],
  );

  const removeBundledLine = useCallback((variantId) => {
    setBundledItems((prev) => prev.filter((b) => b.variantId !== variantId));
  }, []);

  const handleSaveBundle = useCallback(async () => {
    if (!main?.variantId) {
      setSaveError("Select a main product.");
      return;
    }
    if (bundledItems.length < 1) {
      setSaveError("Add at least one product to the bundle.");
      return;
    }

    setSaveLoading(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mainProductId: main.variantId,
          bundledProductIds: bundledItems.map((b) => b.variantId),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || "Could not save bundle.");
        return;
      }
      setModalOpen(false);
      resetModal();
      revalidator.revalidate();
    } catch {
      setSaveError("Network error. Try again.");
    } finally {
      setSaveLoading(false);
    }
  }, [main, bundledItems, revalidator, resetModal]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/bundles/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setDeleteTarget(null);
        revalidator.revalidate();
      }
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, revalidator]);

  const tabs = [
    { id: "create", content: "Create bundle" },
    { id: "manage", content: "Your bundles" },
  ];

  const bundledCountFor = (bundle) => {
    try {
      const p = JSON.parse(bundle.bundledProductIds || "[]");
      return Array.isArray(p) ? p.length : 0;
    } catch {
      return 0;
    }
  };

  return (
    <Page
      title="Product bundles"
      subtitle="Group products sold together on the product page"
      primaryAction={{
        content: "Create bundle",
        onAction: openCreateModal,
      }}
    >
      <Layout>
        <Layout.Section>
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            <Box paddingBlockStart="400">
              {selectedTab === 0 && (
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      Build a bundle
                    </Text>
                    <Text as="p" tone="subdued">
                      Search products, open the builder, choose one{" "}
                      <Badge tone="success">main product</Badge>, then add other
                      products as bundle items. Customers only see the bundle
                      block when a bundle exists for that product.
                    </Text>
                    <Button variant="primary" onClick={openCreateModal}>
                      Open bundle builder
                    </Button>
                  </BlockStack>
                </Card>
              )}

              {selectedTab === 1 && (
                <BlockStack gap="400">
                  {bundles.length === 0 ? (
                    <Card>
                      <EmptyState
                        heading="No bundles yet"
                        action={{
                          content: "Create bundle",
                          onAction: () => {
                            setSelectedTab(0);
                            openCreateModal();
                          },
                        }}
                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                      >
                        <p>
                          Bundles you create will appear here. You can edit or
                          delete them anytime.
                        </p>
                      </EmptyState>
                    </Card>
                  ) : (
                    bundles.map((bundle) => (
                      <Card key={bundle.id}>
                        <InlineStack align="space-between" blockAlign="start">
                          <BlockStack gap="200">
                            <Text as="h3" variant="headingMd">
                              {titleById[bundle.mainProductId] ||
                                "Main product"}
                            </Text>
                            <Text as="p" tone="subdued">
                              {bundledCountFor(bundle)} bundled product
                              {bundledCountFor(bundle) === 1 ? "" : "s"} ·
                              Updated{" "}
                              {new Date(bundle.updatedAt).toLocaleString()}
                            </Text>
                          </BlockStack>
                          <InlineStack gap="200">
                            <Button onClick={() => openEditModal(bundle)}>
                              Edit
                            </Button>
                            <Button
                              tone="critical"
                              variant="plain"
                              onClick={() => setDeleteTarget(bundle)}
                            >
                              Delete
                            </Button>
                          </InlineStack>
                        </InlineStack>
                      </Card>
                    ))
                  )}
                </BlockStack>
              )}
            </Box>
          </Tabs>
        </Layout.Section>
      </Layout>

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          resetModal();
        }}
        title={editingBundleId ? "Edit bundle" : "Create bundle"}
        size="large"
        primaryAction={{
          content: editingBundleId ? "Save changes" : "Save bundle",
          onAction: handleSaveBundle,
          loading: saveLoading,
          disabled: saveLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setModalOpen(false);
              resetModal();
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="500">
            {saveError && (
              <Banner tone="critical" onDismiss={() => setSaveError(null)}>
                <p>{saveError}</p>
              </Banner>
            )}

            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Search products
              </Text>
              <Text as="p" tone="subdued">
                Type at least 2 characters — results update automatically. You
                can also press Search.
              </Text>
              <InlineStack gap="200" wrap={false} blockAlign="end">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TextField
                    label="Search"
                    labelHidden
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search by product name, SKU…"
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => setSearchQuery("")}
                  />
                </div>
                <Button onClick={runSearch}>Search</Button>
              </InlineStack>
              {searchLoading && (
                <InlineStack gap="200" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="span" tone="subdued">
                    Searching…
                  </Text>
                </InlineStack>
              )}
              {searchError && (
                <Banner tone="critical">
                  <p>{searchError}</p>
                </Banner>
              )}
            </BlockStack>

            <Divider />

            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Main product
              </Text>
              {main ? (
                <Card padding="300">
                  <InlineStack gap="300" blockAlign="center">
                    {main.image ? (
                      <Thumbnail
                        source={main.image}
                        alt={main.productTitle}
                        size="small"
                      />
                    ) : null}
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {main.productTitle}
                      </Text>
                      <Badge tone="success">Sold as the primary item</Badge>
                    </BlockStack>
                  </InlineStack>
                </Card>
              ) : (
                <Banner tone="info">
                  <p>
                    Pick a product below and click{" "}
                    <strong>Set as main product</strong>.
                  </p>
                </Banner>
              )}
            </BlockStack>

            <Divider />

            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Bundle items ({bundledItems.length})
              </Text>
              {bundledItems.length === 0 ? (
                <Text as="p" tone="subdued">
                  Use <strong>Add to bundle</strong> on products in the search
                  results (not the main product).
                </Text>
              ) : (
                <BlockStack gap="200">
                  {bundledItems.map((b) => (
                    <Card key={b.variantId} padding="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span">{b.productTitle}</Text>
                        <Button
                          variant="plain"
                          tone="critical"
                          onClick={() => removeBundledLine(b.variantId)}
                        >
                          Remove
                        </Button>
                      </InlineStack>
                    </Card>
                  ))}
                </BlockStack>
              )}
            </BlockStack>

            <Divider />

            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                Search results
              </Text>
              {searchResults.length === 0 && !searchLoading && searchQuery.trim().length >= 2 ? (
                <Text as="p" tone="subdued">
                  No products match your search. Try different keywords.
                </Text>
              ) : null}
              <BlockStack gap="300">
                {searchResults.map((product) => {
                  const vid = variantIdForProduct(product);
                  const variants = product.variants || [];
                  const isMain = main?.variantId === vid;
                  const isBundled = bundledItems.some(
                    (b) => b.variantId === vid,
                  );

                  return (
                    <Card key={product.id} padding="400">
                      <BlockStack gap="300">
                        <InlineStack gap="400" blockAlign="start">
                          <Thumbnail
                            source={
                              product.featuredImage?.url ||
                              "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_small.png"
                            }
                            alt={product.title}
                            size="medium"
                          />
                          <BlockStack gap="200">
                            <Text
                              as="h4"
                              variant="headingSm"
                              fontWeight="semibold"
                            >
                              {product.title}
                            </Text>
                            {variants.length > 1 && vid ? (
                              <Select
                                label="Variant"
                                options={variants.map((v) => ({
                                  label: v.title || "Default",
                                  value: v.id,
                                }))}
                                value={
                                  selectedVariantByProduct[product.id] ??
                                  variants[0]?.id
                                }
                                onChange={(value) =>
                                  setSelectedVariantByProduct((prev) => ({
                                    ...prev,
                                    [product.id]: value,
                                  }))
                                }
                              />
                            ) : null}
                            <InlineStack gap="200" wrap>
                              <Button
                                variant={isMain ? "primary" : "secondary"}
                                disabled={!vid}
                                onClick={() => handleSetMain(product)}
                              >
                                {isMain ? "Main product" : "Set as main product"}
                              </Button>
                              <Checkbox
                                label="Add to bundle"
                                checked={isBundled}
                                disabled={!vid || isMain}
                                onChange={(checked) =>
                                  toggleBundled(product, checked)
                                }
                              />
                            </InlineStack>
                          </BlockStack>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  );
                })}
              </BlockStack>
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete bundle"
        primaryAction={{
          content: "Delete bundle",
          destructive: true,
          loading: deleteLoading,
          onAction: handleConfirmDelete,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setDeleteTarget(null),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Remove this bundle? The product page will no longer show these
            bundled items for the main product.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
