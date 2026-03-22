(function () {
  function isBadApiUrl(url) {
    if (!url || !String(url).trim()) return true;
    var u = String(url).toLowerCase();
    return (
      u.indexOf("example.com") !== -1 ||
      u.indexOf("admin.shopify.com") !== -1
    );
  }

  function isDesignMode() {
    try {
      return Boolean(
        window.Shopify && window.Shopify.designMode,
      );
    } catch (e) {
      return false;
    }
  }

  function initBundle(root) {
    if (root.getAttribute("data-bundle-init") === "1") return;
    root.setAttribute("data-bundle-init", "1");

    var defaultMainVariantId = root.getAttribute("data-main-product-id");
    var apiBase = (root.getAttribute("data-api-base-url") || "").trim();
    var shopDomain = root.getAttribute("data-shop") || "";

    var container = root.querySelector("[data-bundle-products]");
    var button = root.querySelector("[data-bundle-add-btn]");
    var section = root.closest(".shopify-section") || root.closest("section");
    var productForm =
      (section && section.querySelector('form[action*="/cart/add"]')) ||
      document.querySelector("product-form form[action*='/cart/add']") ||
      document.querySelector('form[action*="/cart/add"]');

    function showMerchantMessage(html) {
      root.style.display = "";
      if (container) container.innerHTML = html;
      if (button) button.style.display = "none";
    }

    function showLiveOrHide(html) {
      if (
        isDesignMode() ||
        root.getAttribute("data-show-live-errors") === "true"
      ) {
        showMerchantMessage(html);
      } else {
        root.style.display = "none";
      }
    }

    if (!defaultMainVariantId || !shopDomain) {
      root.style.display = "none";
      return;
    }

    if (isBadApiUrl(apiBase)) {
      showMerchantMessage(
        '<p class="bundle-widget__alert"><strong>Bundle setup:</strong> Open theme editor → select this block → set <strong>App API base URL</strong> to your app URL from <code>shopify app dev</code> (tunnel like <code>https://….trycloudflare.com</code>). Not the Admin URL.</p>',
      );
      return;
    }

    var bundleProducts = [];
    var selectedIds = new Set();
    var isSubmitting = false;

    function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function variantIdForCart(p) {
      if (p.legacyResourceId != null) return String(p.legacyResourceId);
      var m = String(p.id || "").match(/ProductVariant\/(\d+)/);
      return m ? m[1] : String(p.id);
    }

    function getCurrentMainVariantId() {
      if (!productForm) return defaultMainVariantId;
      var idInput = productForm.querySelector('input[name="id"]');
      return (idInput && idInput.value) || defaultMainVariantId;
    }

    function getMainQuantity() {
      if (!productForm) return 1;
      var qtyInput = productForm.querySelector('input[name="quantity"]');
      if (!qtyInput) return 1;
      var q = parseInt(qtyInput.value, 10);
      return Number.isFinite(q) && q > 0 ? q : 1;
    }

    function setSubmittingState(disabled) {
      if (button) button.disabled = disabled;
      if (!productForm) return;
      var submitButton =
        productForm.querySelector('button[type="submit"]') ||
        productForm.querySelector('[name="add"]');
      if (submitButton) submitButton.disabled = disabled;
    }

    function render() {
      if (!bundleProducts.length) {
        root.style.display = "none";
        return;
      }

      root.style.display = "";
      if (button) button.style.display = "";

      var list = bundleProducts
        .map(function (p) {
          var vid = variantIdForCart(p);
          var checked = selectedIds.has(vid) ? "checked" : "";
          var price = p.price ? escapeHtml(p.price) : "";
          var title = escapeHtml(p.title || "Bundled item");
          var variantTitle = escapeHtml(p.variantTitle || "");
          var imageUrl = escapeHtml(
            p.imageUrl ||
              "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_small.png",
          );
          var imageAlt = escapeHtml(p.imageAlt || p.title || "Product image");
          return (
            '<label class="bundle-widget__row">' +
            '<input class="bundle-widget__checkbox" type="checkbox" data-id="' +
            vid +
            '" ' +
            checked +
            " />" +
            '<img class="bundle-widget__image" src="' +
            imageUrl +
            '" alt="' +
            imageAlt +
            '" loading="lazy" />' +
            '<span class="bundle-widget__meta">' +
            '<p class="bundle-widget__name">' +
            title +
            "</p>" +
            (variantTitle && variantTitle !== "Default Title"
              ? '<p class="bundle-widget__variant">' + variantTitle + "</p>"
              : "") +
            (price ? '<p class="bundle-widget__price">' + price + "</p>" : "") +
            "</span>" +
            "</label>"
          );
        })
        .join("");

      if (container) container.innerHTML = list;

      if (container) {
        container
          .querySelectorAll('input[type="checkbox"][data-id]')
          .forEach(function (input) {
            input.addEventListener("change", function () {
              var id = this.getAttribute("data-id");
              if (!id) return;
              if (this.checked) {
                selectedIds.add(id);
              } else {
                selectedIds.delete(id);
              }
            });
          });
      }

      if (button) button.disabled = false;
    }

    function loadBundle() {
      var url =
        apiBase.replace(/\/$/, "") +
        "/api/bundle/" +
        encodeURIComponent(getCurrentMainVariantId()) +
        "?shop=" +
        encodeURIComponent(shopDomain);

      fetch(url, { mode: "cors", credentials: "omit" })
        .then(function (res) {
          if (!res.ok) throw new Error("Bundle fetch failed");
          return res.json();
        })
        .then(function (data) {
          if (data.error) {
            var hint =
              data.message ||
              "Open the app once in Shopify Admin for this store, or check your App API base URL (HTTPS).";
            showLiveOrHide(
              '<p class="bundle-widget__alert"><strong>Bundle unavailable.</strong> ' +
                escapeHtml(hint) +
                "</p>",
            );
            return;
          }
          if (!data.bundle) {
            root.style.display = "none";
            return;
          }
          var products = data.products || [];
          bundleProducts = products;
          selectedIds = new Set(products.map(variantIdForCart));
          render();
        })
        .catch(function () {
          showLiveOrHide(
            '<p class="bundle-widget__alert"><strong>Could not reach your app.</strong> Use an <strong>HTTPS</strong> App API URL in this block, keep <code>shopify app dev</code> running (or deploy your app), click <strong>Save</strong> on the theme, and view the same theme you edited (published or preview).</p>',
          );
        });
    }

    function addBundleToCart() {
      if (isSubmitting) return Promise.resolve();
      isSubmitting = true;
      setSubmittingState(true);

      var mainVariantId = getCurrentMainVariantId();
      var mainQty = getMainQuantity();
      var ids = [mainVariantId].concat(Array.from(selectedIds));
      if (!ids.length) return;

      var items = ids.map(function (id, index) {
        return { id: id, quantity: index === 0 ? mainQty : 1 };
      });

      return fetch("/cart/add.js", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ items: items }),
      })
        .then(function (res) {
          if (!res.ok) return res.json().then(Promise.reject);
          return res.json();
        })
        .then(function () {
          window.location.href = "/cart";
        })
        .catch(function () {
          alert("Could not add bundle to cart.");
        })
        .finally(function () {
          isSubmitting = false;
          setSubmittingState(false);
        });
    }

    if (button) {
      button.addEventListener("click", addBundleToCart);
    }

    if (productForm) {
      productForm.addEventListener("submit", function (event) {
        if (!bundleProducts.length || isSubmitting) return;
        event.preventDefault();
        addBundleToCart();
      });
    }

    document.addEventListener("change", function (event) {
      var target = event.target;
      if (!target) return;
      if (
        target.name === "id" ||
        (target.closest && target.closest("variant-selects")) ||
        (target.closest && target.closest("variant-radios"))
      ) {
        loadBundle();
      }
    });

    loadBundle();
  }

  document.querySelectorAll("[data-bundle-block-root]").forEach(initBundle);
})();
