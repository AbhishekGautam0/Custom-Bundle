/**
 * Sticky add-to-cart (Dawn-friendly). Updates in real time when the main product variant changes.
 * Storefront styling is Polaris-inspired (React Polaris is admin-only).
 */
(function () {
  function isDesignMode() {
    try {
      return Boolean(window.Shopify && window.Shopify.designMode);
    } catch (e) {
      return false;
    }
  }

  function qs(root, sel) {
    return (root || document).querySelector(sel);
  }

  function findProductForm(section) {
    var selectors = [
      'form[action*="/cart/add"]',
      "form[action='/cart/add']",
    ];
    if (section) {
      for (var i = 0; i < selectors.length; i++) {
        var f = section.querySelector(selectors[i]);
        if (f) return f;
      }
    }
    var pf = qs(document, "product-form");
    if (pf) {
      for (var j = 0; j < selectors.length; j++) {
        var inner = pf.querySelector(selectors[j]);
        if (inner) return inner;
      }
    }
    for (var k = 0; k < selectors.length; k++) {
      var docForm = qs(document, selectors[k]);
      if (docForm) return docForm;
    }
    return null;
  }

  function findRealAddButton(form) {
    if (!form) return null;
    return (
      form.querySelector('button[name="add"]') ||
      form.querySelector("button.product-form__submit") ||
      form.querySelector("[data-add-to-cart]") ||
      form.querySelector('button[type="submit"]') ||
      form.querySelector('input[type="submit"]') ||
      form.querySelector("[type=\"submit\"]")
    );
  }

  function parseVariantsJson(scriptEl) {
    if (!scriptEl || !scriptEl.textContent) return [];
    try {
      var data = JSON.parse(scriptEl.textContent);
      return data.variants || [];
    } catch (e) {
      return [];
    }
  }

  function parseProductTitle(scriptEl) {
    if (!scriptEl || !scriptEl.textContent) return "";
    try {
      return JSON.parse(scriptEl.textContent).productTitle || "";
    } catch (e) {
      return "";
    }
  }

  function findPriceInForm(form) {
    if (!form) return null;
    var section = form.closest(".shopify-section") || form.closest("section") || document;
    var priceEl =
      section.querySelector(".price .price-item--sale") ||
      section.querySelector(".price .price-item--regular") ||
      section.querySelector(".price-item--regular") ||
      section.querySelector("[data-product-price]") ||
      section.querySelector(".price");
    return priceEl ? priceEl.textContent.trim() : null;
  }

  /** Dawn / OS2 often updates the hidden variant input via JS without a bubbling change event. */
  function getVariantIdFromForm(form) {
    if (!form) return null;
    var input = form.querySelector('input[name="id"]');
    if (input && input.value) return String(input.value);
    var pf = form.closest("product-form") || document.querySelector("product-form");
    if (pf) {
      var inner = pf.querySelector('input[name="id"]');
      if (inner && inner.value) return String(inner.value);
    }
    return null;
  }

  function init(root) {
    if (root.getAttribute("data-sticky-atc-init") === "1") return;
    root.setAttribute("data-sticky-atc-init", "1");

    var blockId = root.getAttribute("data-block-id");
    if (!blockId) return;

    var alwaysMode = root.getAttribute("data-sticky-mode") === "always";

    var sectionForForm =
      root.closest(".shopify-section") ||
      root.closest("section");
    if (!isDesignMode() && root.parentNode) {
      document.body.appendChild(root);
    }

    var section = sectionForForm;
    var form = findProductForm(section);
    if (!section && form) {
      section =
        form.closest(".shopify-section") ||
        form.closest("section");
    }
    var watchRoot = section || form || document.documentElement;
    var realButton = findRealAddButton(form);
    var dataScript = document.getElementById("StickyAtcData-" + blockId);
    var variants = parseVariantsJson(dataScript);
    var productTitle = parseProductTitle(dataScript);

    var imgEl = root.querySelector(".sticky-atc__img");
    var productTitleEl = root.querySelector(".sticky-atc__product");
    var variantTitleEl = root.querySelector(".sticky-atc__variant");
    var skuEl = root.querySelector(".sticky-atc__sku");
    var priceEl = root.querySelector(".sticky-atc__price");
    var stickyBtn = root.querySelector(".sticky-atc__btn");
    var setupEl = root.querySelector(".sticky-atc__setup");

    var lastVariantId = null;
    var pollTimer = null;

    function showSetup(msg) {
      if (setupEl) {
        setupEl.textContent = msg;
        setupEl.hidden = false;
      }
    }

    if (!form || !realButton || !stickyBtn) {
      showSetup(
        "Could not find the product Add to cart form. Place this block on the product template near the main product section (Dawn: main product).",
      );
      root.removeAttribute("hidden");
      root.classList.add("sticky-atc--visible");
      root.setAttribute("aria-hidden", "false");
      if (stickyBtn) stickyBtn.disabled = true;
      return;
    }

    function variantById(id) {
      var sid = String(id);
      for (var i = 0; i < variants.length; i++) {
        if (String(variants[i].id) === sid) return variants[i];
      }
      return null;
    }

    function getVariantId() {
      return getVariantIdFromForm(form);
    }

    function escapeHtml(s) {
      return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function updateFromVariant() {
      var vid = getVariantId();
      lastVariantId = vid;
      var v = variantById(vid);
      if (setupEl) {
        setupEl.hidden = true;
        setupEl.textContent = "";
      }
      if (productTitleEl) {
        productTitleEl.textContent =
          root.getAttribute("data-show-product-title") === "true" ? productTitle : "";
        productTitleEl.style.display =
          root.getAttribute("data-show-product-title") === "true" && productTitle
            ? ""
            : "none";
      }
      if (variantTitleEl) {
        variantTitleEl.textContent = v ? v.title || "" : "";
      }
      if (skuEl) {
        if (v && v.sku) {
          skuEl.textContent = "SKU: " + v.sku;
          skuEl.hidden = false;
        } else {
          skuEl.textContent = "";
          skuEl.hidden = true;
        }
      }
      if (imgEl) {
        if (v && v.image) {
          imgEl.src = v.image;
          imgEl.alt =
            (productTitle ? productTitle + " — " : "") + (v.title || "");
          imgEl.style.display = "";
        } else {
          imgEl.style.display = "none";
        }
      }
      var domPrice = findPriceInForm(form);
      if (priceEl) {
        if (domPrice) {
          priceEl.textContent = domPrice;
        } else if (v) {
          var p = v.price || "";
          if (v.compare_at && v.compare_at !== "null") {
            priceEl.innerHTML =
              '<span class="sticky-atc__compare">' +
              escapeHtml(v.compare_at) +
              "</span> " +
              escapeHtml(p);
          } else {
            priceEl.textContent = p;
          }
        } else {
          priceEl.textContent = "";
        }
      }

      if (stickyBtn && v) {
        stickyBtn.disabled = v.available === false;
      } else if (stickyBtn) {
        stickyBtn.disabled = false;
      }
    }

    function setVisible(show) {
      if (show) {
        root.removeAttribute("hidden");
        root.classList.add("sticky-atc--visible");
        root.setAttribute("aria-hidden", "false");
        updateFromVariant();
        startPoll();
      } else {
        root.classList.remove("sticky-atc--visible");
        root.setAttribute("hidden", "");
        root.setAttribute("aria-hidden", "true");
        stopPoll();
      }
    }

    function startPoll() {
      stopPoll();
      pollTimer = window.setInterval(function () {
        var now = getVariantId();
        if (now !== lastVariantId) {
          updateFromVariant();
        }
      }, 150);
    }

    function stopPoll() {
      if (pollTimer) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function bindObserver() {
      var observer = new IntersectionObserver(
        function (entries) {
          var entry = entries[0];
          if (!entry) return;
          var showSticky = !entry.isIntersecting;
          setVisible(showSticky);
        },
        {
          root: null,
          rootMargin: "0px",
          threshold: 0,
        },
      );
      observer.observe(realButton);
    }

    function onVariantInteraction() {
      window.requestAnimationFrame(updateFromVariant);
    }

    /* Capture phase: catches events from inside shadow DOM hosts in some themes */
    ["change", "input", "click"].forEach(function (evtName) {
      document.addEventListener(
        evtName,
        function (e) {
          var t = e.target;
          if (!t || !watchRoot.contains(t)) return;
          if (
            t.name === "id" ||
            (t.name && String(t.name).indexOf("option") === 0) ||
            (t.closest && t.closest("variant-selects")) ||
            (t.closest && t.closest("variant-radios")) ||
            (t.closest && t.closest("product-form"))
          ) {
            onVariantInteraction();
          }
        },
        true,
      );
    });

    /* Common theme custom events */
    ["variant:change", "variant_change", "shopify:variant:change"].forEach(function (name) {
      document.addEventListener(name, onVariantInteraction, true);
    });

    /* Price / DOM updates without input events (debounced) */
    var moDebounce = null;
    if (section) {
      try {
        var priceMo = new MutationObserver(function () {
          if (moDebounce) window.clearTimeout(moDebounce);
          moDebounce = window.setTimeout(function () {
            moDebounce = null;
            onVariantInteraction();
          }, 60);
        });
        priceMo.observe(section, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      } catch (e) {}
    }

    if (alwaysMode) {
      updateFromVariant();
      setVisible(true);
    } else {
      bindObserver();
      updateFromVariant();
      setVisible(false);
    }

    document.addEventListener("shopify:section:load", function () {
      requestAnimationFrame(updateFromVariant);
    });

    stickyBtn.addEventListener("click", function () {
      updateFromVariant();
      if (realButton.disabled) return;
      if (typeof form.requestSubmit === "function") {
        try {
          form.requestSubmit(realButton);
          return;
        } catch (err) {}
      }
      realButton.click();
    });
  }

  document.querySelectorAll("[data-sticky-atc]").forEach(init);
})();
