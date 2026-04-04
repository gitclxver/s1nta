"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import emailjs from "@emailjs/browser";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { S1NTA_VISUAL_LINKS_TEMPLATE } from "@/lib/s1ntaVisualLinks";

const MIN_INITIAL_SPLASH_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CATEGORY_ORDER = ["SHIRTS", "BOTTOMS", "OUTWEAR", "ACCESSORIES"];

/** Size options — chosen only in cart, not on shop cards. */
const DEFAULT_SIZES = ["S", "M", "L", "XL", "XXL"];

function normalizeCartSize(raw) {
  const u = String(raw || "").trim().toUpperCase();
  return DEFAULT_SIZES.includes(u) ? u : DEFAULT_SIZES[0];
}

/** Per-line `sizes` length must match `quantity`. */
function cartSizesArray(item) {
  const qty = Math.max(1, Number(item?.quantity || 1));
  let arr = Array.isArray(item?.sizes)
    ? item.sizes.map((s) => normalizeCartSize(s))
    : [];
  if (arr.length === 0 && item?.size != null && item.size !== "") {
    arr = Array(qty).fill(normalizeCartSize(item.size));
  }
  while (arr.length < qty) arr.push(DEFAULT_SIZES[0]);
  return arr.slice(0, qty);
}

function formatLineSizesSummary(item) {
  const qty = Math.max(1, Number(item?.quantity || 1));
  const arr = cartSizesArray(item);
  const counts = {};
  for (let i = 0; i < qty; i++) {
    const s = normalizeCartSize(arr[i]);
    counts[s] = (counts[s] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([s, n]) => (n > 1 ? `${s}×${n}` : s))
    .join(", ");
}

function migrateCartItemsForSize(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const qty = Math.max(1, Number(item.quantity || 1));
    const sizes = cartSizesArray({ ...item, quantity: qty });
    const { size: _legacy, ...rest } = item;
    return { ...rest, quantity: qty, sizes };
  });
}

function formatOrderSizesField(items) {
  if (!Array.isArray(items)) return "";
  return items
    .map((i) => {
      const qty = Math.max(1, Number(i.quantity || 1));
      return `${i.name || "Item"} (${i.color || "—"}): ${formatLineSizesSummary(i)} · qty ${qty}`;
    })
    .join(" · ");
}

function categoryRank(category) {
  const idx = CATEGORY_ORDER.indexOf(category);
  return idx === -1 ? CATEGORY_ORDER.length : idx;
}

/** New arrivals first, then category order, then name. */
function sortProductsForCatalog(a, b) {
  const na = a.newArrival === true ? 1 : 0;
  const nb = b.newArrival === true ? 1 : 0;
  if (nb !== na) return nb - na;
  const categoryA = (a.category || "UNCATEGORIZED").toUpperCase();
  const categoryB = (b.category || "UNCATEGORIZED").toUpperCase();
  const categoryDiff = categoryRank(categoryA) - categoryRank(categoryB);
  if (categoryDiff !== 0) return categoryDiff;
  return String(a.name || "").localeCompare(String(b.name || ""));
}

function formatItemsForEmail(items) {
  if (!Array.isArray(items)) return "";
  return items
    .map((i) => {
      const qty = Math.max(1, Number(i.quantity || 1));
      const summary = formatLineSizesSummary(i);
      return `${i.name || "Item"} (${i.color || "—"}) sizes ${summary} · qty ${qty} — N$${(Number(i.price || 0) * qty).toFixed(2)}`;
    })
    .join("\n");
}

function CartSizeChipRow({ value, onChange, dense }) {
  return (
    <div
      className={`flex flex-wrap justify-center gap-1 ${dense ? "max-w-[9rem]" : ""}`}
      role="group"
      aria-label="Size"
    >
      {DEFAULT_SIZES.map((sz) => (
        <button
          key={sz}
          type="button"
          onClick={() => onChange(sz)}
          className={`min-h-8 min-w-[1.75rem] rounded-lg border px-1.5 text-[8px] font-bold uppercase leading-none transition ${
            value === sz
              ? "border-[--accent] bg-[--accent]/15 text-[--accent]"
              : "border-white/15 text-zinc-400 hover:border-white/35 hover:text-zinc-200"
          }`}
        >
          {sz}
        </button>
      ))}
    </div>
  );
}

const cartReadSizeBadge =
  "inline-flex min-h-8 min-w-[2.75rem] items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-zinc-900/70 px-2.5 shadow-sm backdrop-blur-sm";

/** Read-only size summary shown above the selector in cart. */
function CartSizeDisplay({ sizes, qty }) {
  const list = sizes.slice(0, qty);
  if (qty <= 1) {
    const sz = list[0] ?? DEFAULT_SIZES[0];
    return (
      <div className="flex w-full flex-col items-center gap-1.5">
        <span className="text-[7px] font-bold uppercase tracking-[0.22em] text-zinc-500">
          Size
        </span>
        <span
          className={`${cartReadSizeBadge} border-[--accent]/35 bg-[--accent]/10`}
        >
          <span className="text-xs font-bold tabular-nums tracking-wide text-[--accent]">
            {sz}
          </span>
        </span>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-col items-center gap-1.5">
      <span className="text-[7px] font-bold uppercase tracking-[0.22em] text-zinc-500">
        Sizes
      </span>
      <div className="flex w-full flex-wrap items-center justify-center gap-2">
        {list.map((sz, i) => (
          <span key={i} className={cartReadSizeBadge}>
            <span className="text-[8px] font-bold tabular-nums text-zinc-500">
              #{i + 1}
            </span>
            <span className="text-xs font-bold tabular-nums tracking-wide text-[--accent]">
              {sz}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function orderCreatedAtMs(data) {
  const ts = data?.createdAt;
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return 0;
}

function formatEmailJsError(e) {
  const raw = e?.text ?? e?.message ?? "";
  if (typeof raw === "string" && raw.trim()) {
    const t = raw.trim();
    try {
      const parsed = JSON.parse(t);
      const msg = parsed?.message ?? parsed?.error ?? parsed?.txt;
      if (msg != null && String(msg).trim())
        return String(msg).trim().slice(0, 280);
    } catch {
      /* plain text */
    }
    return t.slice(0, 280);
  }
  if (e?.message) return String(e.message).slice(0, 280);
  return "Send failed";
}

function normalizeDisplayUsername(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ");
}

function isValidDisplayUsername(s) {
  const t = normalizeDisplayUsername(s);
  if (t.length < 2 || t.length > 32) return false;
  return /^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u.test(t);
}

/** Input hint: legacy profiles used phone as username — treat as unset for the display-name field. */
function displayNameFieldValue(profile) {
  if (!profile?.username) return "";
  const phone = profile.phone || "";
  if (phone && profile.username === phone) return "";
  return profile.username;
}

function orderDisplayUsername(profile, checkoutDraft) {
  const draft = normalizeDisplayUsername(checkoutDraft);
  if (isValidDisplayUsername(draft)) return draft;
  const stored = profile?.username;
  const phone = profile?.phone || "";
  if (stored && phone && stored !== phone) return stored;
  if (stored && !phone) return stored;
  return phone || "Customer";
}

function reviewDisplayUsername(profile) {
  const v = displayNameFieldValue(profile);
  const n = normalizeDisplayUsername(v);
  if (isValidDisplayUsername(n)) return n;
  return "Anonymous";
}

export default function Home({ forcedRoute = "home" }) {
  const [routeName, setRouteName] = useState(forcedRoute);
  const [isLoaded, setIsLoaded] = useState(false);
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState(() => {
    if (typeof window === "undefined") return [];
    const saved = window.localStorage.getItem("s1nta_cart");
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return migrateCartItemsForSize(Array.isArray(parsed) ? parsed : []);
    } catch {
      return [];
    }
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [userOrders, setUserOrders] = useState([]);
  const [userOrdersError, setUserOrdersError] = useState(null);
  const [userOrdersLoading, setUserOrdersLoading] = useState(false);
  const [orderPlacing, setOrderPlacing] = useState(false);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState("ALL");
  const [authTab, setAuthTab] = useState("login");
  const [authPaneMode, setAuthPaneMode] = useState("main");
  const [authPhone, setAuthPhone] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [accountDisplayName, setAccountDisplayName] = useState("");
  const [accountSaving, setAccountSaving] = useState(false);
  const [checkoutDisplayName, setCheckoutDisplayName] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [userProfile, setUserProfile] = useState(null);
  const [checkoutNotes, setCheckoutNotes] = useState("");
  const [orders, setOrders] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewInput, setReviewInput] = useState("");
  const [adminProductName, setAdminProductName] = useState("");
  const [adminProductPrice, setAdminProductPrice] = useState("");
  const [adminProductCategory, setAdminProductCategory] = useState("SHIRTS");
  const [adminProductNewArrival, setAdminProductNewArrival] = useState(false);
  const [adminColorRows, setAdminColorRows] = useState([
    { color: "", url: "" },
  ]);
  const [showPassword, setShowPassword] = useState(false);
  const [adminPane, setAdminPane] = useState("inventory");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [selectedColorIndexByProduct, setSelectedColorIndexByProduct] =
    useState({});
  const [switchingColorByProduct, setSwitchingColorByProduct] = useState({});
  const [visualLinks, setVisualLinks] = useState(S1NTA_VISUAL_LINKS_TEMPLATE);
  const [routeLoading, setRouteLoading] = useState(false);
  const routeTimerRef = useRef(null);
  const prevRouteNameForCheckoutRef = useRef(routeName);
  const [editingProductId, setEditingProductId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editCategory, setEditCategory] = useState("SHIRTS");
  const [editVisible, setEditVisible] = useState(true);
  const [editNewArrival, setEditNewArrival] = useState(false);
  const [editColorRows, setEditColorRows] = useState([{ color: "", url: "" }]);

  const normalizeNamPhone = (raw) => {
    const digits = String(raw || "")
      .replace(/\D/g, "")
      .trim();
    const noCountry = digits.startsWith("264") ? digits.slice(3) : digits;
    return noCountry.slice(0, 9);
  };

  const showToast = useCallback((type, message) => {
    setToast({ type, message });
  }, []);

  const isEmailJsConfigured = () =>
    Boolean(
      process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY?.trim() &&
        process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID?.trim() &&
        process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID?.trim(),
    );

  const loadUserOrders = useCallback(async () => {
    if (!db || !userProfile?.uid) {
      setUserOrders([]);
      setUserOrdersError(null);
      setUserOrdersLoading(false);
      return;
    }
    const uid = userProfile.uid;
    const mapSnap = (snap) =>
      snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const sortDesc = (rows) =>
      [...rows].sort((a, b) => orderCreatedAtMs(b) - orderCreatedAtMs(a));

    setUserOrdersLoading(true);
    setUserOrdersError(null);
    try {
      const q = query(
        collection(db, "s1ntaorders"),
        where("uid", "==", uid),
        orderBy("createdAt", "desc"),
      );
      const snap = await getDocs(q);
      setUserOrders(sortDesc(mapSnap(snap)));
    } catch {
      try {
        const qSimple = query(
          collection(db, "s1ntaorders"),
          where("uid", "==", uid),
        );
        const snap = await getDocs(qSimple);
        setUserOrders(sortDesc(mapSnap(snap)));
      } catch (err) {
        setUserOrders([]);
        const code = err?.code || "";
        if (code === "permission-denied") {
          setUserOrdersError(
            "Could not load orders (permission denied). Try signing in again.",
          );
        } else {
          setUserOrdersError(
            "Could not load orders. Check your connection, or deploy the Firestore index for s1ntaorders (uid + createdAt).",
          );
        }
      }
    } finally {
      setUserOrdersLoading(false);
    }
  }, [userProfile?.uid]);

  const openCartPane = useCallback(() => {
    setOrdersOpen(false);
    setCartOpen(true);
  }, []);

  const openOrdersPane = useCallback(() => {
    setCartOpen(false);
    setOrdersOpen(true);
  }, []);

  const navigateTo = useCallback(
    (nextRoute, options) => {
      if (nextRoute === routeName) return;
      const instant = options?.instant === true;
      if (instant) {
        if (routeTimerRef.current) clearTimeout(routeTimerRef.current);
        routeTimerRef.current = null;
        setRouteLoading(false);
        setRouteName(nextRoute);
        setMobileMenuOpen(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      setRouteLoading(true);
      if (routeTimerRef.current) clearTimeout(routeTimerRef.current);
      routeTimerRef.current = setTimeout(() => {
        setRouteName(nextRoute);
        setMobileMenuOpen(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
        setRouteLoading(false);
      }, 3000);
    },
    [routeName],
  );

  const normalizeImageUrl = (url) => {
    if (!url) return "/demo/assets/skully.png";
    const value = String(url).trim();
    if (value.includes("firebasestorage.googleapis.com")) {
      return value.replace(/ /g, "%20");
    }
    return value;
  };

  const getFriendlyAuthError = (err) => {
    const code = err?.code || "";
    if (code.includes("auth/invalid-credential"))
      return "Invalid phone or password. Please try again.";
    if (code.includes("auth/invalid-email")) return "Invalid phone format.";
    if (code.includes("auth/user-not-found"))
      return "No account found for this number.";
    if (code.includes("auth/wrong-password")) return "Incorrect password.";
    if (code.includes("auth/email-already-in-use"))
      return "This number is already registered.";
    if (code.includes("auth/weak-password"))
      return "Password must be at least 6 characters.";
    if (code.includes("auth/too-many-requests"))
      return "Too many attempts. Please wait and try again.";
    return "Authentication failed. Please try again.";
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("s1nta_cart", JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    if (!userProfile?.uid) {
      setUserOrders([]);
      setUserOrdersError(null);
      setUserOrdersLoading(false);
      return;
    }
    loadUserOrders();
  }, [userProfile?.uid, loadUserOrders]);

  useEffect(() => {
    if (ordersOpen && userProfile?.uid) loadUserOrders();
  }, [ordersOpen, userProfile?.uid, loadUserOrders]);

  useEffect(() => {
    const onMove = (e) => {
      const xPercent = (e.clientX / window.innerWidth) * 100;
      const yPercent = (e.clientY / window.innerHeight) * 100;
      document.documentElement.style.setProperty("--x", `${xPercent}%`);
      document.documentElement.style.setProperty("--y", `${yPercent}%`);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  useEffect(() => {
    if (routeName !== "home") return;
    const nodes = Array.from(document.querySelectorAll(".reveal"));
    if (!nodes.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("active");
        });
      },
      { threshold: 0.1 },
    );
    nodes.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [routeName]);

  useEffect(() => {
    if (!isLoaded) return;
    const layer = document.getElementById("story-layer");
    if (!layer) return;
    if (routeName !== "home") {
      layer
        .querySelectorAll(".story-rect")
        .forEach((r) => r.classList.remove("story-scroll-active"));
      return;
    }

    const rects = Array.from(layer.querySelectorAll(".story-rect"));
    if (!rects.length) return;

    const mq = window.matchMedia("(max-width: 767px)");
    let rafId = 0;
    let lastIdx = -1;

    const setActiveIdx = (idx) => {
      if (idx === lastIdx) return;
      lastIdx = idx;
      rects.forEach((r, i) => {
        r.classList.toggle("story-scroll-active", i === idx);
      });
    };

    const update = () => {
      if (!mq.matches) {
        rects.forEach((r) => r.classList.remove("story-scroll-active"));
        return;
      }
      const doc = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const y = window.scrollY || window.pageYOffset;
      const t = Math.min(1, Math.max(0, y / doc));
      const idx = Math.min(rects.length - 1, Math.floor(t * rects.length));
      setActiveIdx(idx);
    };

    update();
    const onScroll = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      rects.forEach((r) => r.classList.remove("story-scroll-active"));
    };
  }, [routeName, isLoaded]);

  useEffect(() => {
    setRouteName(forcedRoute);
  }, [forcedRoute]);

  useEffect(() => {
    return () => {
      if (routeTimerRef.current) clearTimeout(routeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let unsub = () => {};
    const init = async () => {
      if (!db) {
        await sleep(MIN_INITIAL_SPLASH_MS);
        setIsLoaded(true);
        return;
      }
      try {
        await Promise.all([
          sleep(MIN_INITIAL_SPLASH_MS),
          (async () => {
            const [productsSnap, visualsSnap] = await Promise.all([
              getDocs(collection(db, "s1ntaproducts")),
              getDoc(doc(db, "s1ntavisuals", "default")),
            ]);
            setProducts(
              productsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
            );
            if (visualsSnap.exists()) {
              setVisualLinks((prev) => ({
                ...prev,
                ...visualsSnap.data(),
              }));
            }
          })(),
        ]);
      } catch {
        showToast("error", "Could not load catalog. Check connection.");
      }
      setIsLoaded(true);
    };
    init();
    if (auth && db) {
      unsub = onAuthStateChanged(auth, async (user) => {
        if (!user) return setUserProfile(null);
        const userDoc = await getDoc(doc(db, "s1ntausers", user.uid));
        setUserProfile({ uid: user.uid, ...(userDoc.data() || {}) });
      });
    }
    return () => unsub();
  }, [showToast]);

  useEffect(() => {
    if (!isLoaded || typeof window === "undefined") return;
    const urls = new Set();
    for (const p of products) {
      for (const img of p.images || []) {
        const u = normalizeImageUrl(img?.url);
        if (u) urls.add(u);
      }
    }
    for (const v of Object.values(visualLinks)) {
      if (typeof v === "string" && v.trim()) {
        urls.add(normalizeImageUrl(v));
      }
    }
    for (const u of urls) {
      const im = new Image();
      im.decoding = "async";
      im.src = u;
    }
  }, [isLoaded, products, visualLinks]);

  const total = useMemo(
    () =>
      cart.reduce(
        (sum, i) => sum + Number(i.price || 0) * Number(i.quantity || 0),
        0,
      ),
    [cart],
  );
  const cartCount = useMemo(
    () => cart.reduce((sum, i) => sum + i.quantity, 0),
    [cart],
  );
  const shopCategories = useMemo(() => {
    const base = products
      .filter((p) => p.visible !== false)
      .map((p) => (p.category || "UNCATEGORIZED").toUpperCase());
    return ["ALL", "NEW ARRIVALS", ...Array.from(new Set(base))];
  }, [products]);

  const visibleProducts = useMemo(() => {
    return products
      .filter((p) => {
        if (p.visible === false) return false;
        const matchesSearch = `${p.name || ""} ${p.description || ""}`
          .toLowerCase()
          .includes(searchQuery.toLowerCase());
        const category = (p.category || "UNCATEGORIZED").toUpperCase();
        const matchesCategory =
          activeCategoryFilter === "NEW ARRIVALS"
            ? p.newArrival === true
            : activeCategoryFilter === "ALL" || category === activeCategoryFilter;
        return matchesSearch && matchesCategory;
      })
      .sort(sortProductsForCatalog);
  }, [products, searchQuery, activeCategoryFilter]);

  const adminSortedProducts = useMemo(
    () => [...products].sort(sortProductsForCatalog),
    [products],
  );

  const addToCart = (product, variant) => {
    const variantColor = variant?.color || "default";
    setCart((prev) => {
      const idx = prev.findIndex(
        (x) => x.productId === product.id && x.color === variantColor,
      );
      if (idx > -1) {
        const next = [...prev];
        const cur = next[idx];
        const newQty = cur.quantity + 1;
        const prevSizes = cartSizesArray(cur);
        next[idx] = {
          ...cur,
          quantity: newQty,
          sizes: [...prevSizes, DEFAULT_SIZES[0]].slice(0, newQty),
        };
        delete next[idx].size;
        return next;
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          price: Number(product.price || 0),
          color: variantColor,
          quantity: 1,
          sizes: [DEFAULT_SIZES[0]],
          image: normalizeImageUrl(
            variant?.url ||
              product.images?.[0]?.url ||
              "/demo/assets/skully.png",
          ),
        },
      ];
    });
    openCartPane();
  };

  const cycleProductColor = (productId, direction, images) => {
    const imageCount = images?.length || 0;
    if (!imageCount) return;
    const current = selectedColorIndexByProduct[productId] ?? 0;
    const next =
      (((current + direction) % imageCount) + imageCount) % imageCount;
    const nextUrl = normalizeImageUrl(images[next]?.url);

    setSwitchingColorByProduct((prev) => ({ ...prev, [productId]: true }));
    const preload = new Image();
    const done = () => {
      setTimeout(() => {
        setSelectedColorIndexByProduct((prev) => ({
          ...prev,
          [productId]: next,
        }));
        setSwitchingColorByProduct((prev) => ({ ...prev, [productId]: false }));
      }, 140);
    };
    preload.onload = done;
    preload.onerror = done;
    preload.src = nextUrl;
  };

  const updateCartQuantity = (productId, color, delta) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.productId === productId && item.color === color) {
            const newQty = item.quantity + delta;
            if (newQty <= 0) return { ...item, quantity: 0 };
            let sizes = cartSizesArray(item);
            if (delta > 0) {
              sizes = [...sizes, DEFAULT_SIZES[0]].slice(0, newQty);
            } else {
              sizes = sizes.slice(0, newQty);
            }
            const nextItem = { ...item, quantity: newQty, sizes };
            delete nextItem.size;
            return nextItem;
          }
          return item;
        })
        .filter((item) => item.quantity > 0),
    );
  };

  const removeCartItem = (productId, color) => {
    setCart((prev) =>
      prev.filter(
        (item) => !(item.productId === productId && item.color === color),
      ),
    );
  };

  const setCartSlotSize = (productId, color, slotIndex, size) => {
    const sz = normalizeCartSize(size);
    setCart((prev) =>
      prev.map((item) => {
        if (item.productId !== productId || item.color !== color)
          return item;
        const qty = Math.max(1, item.quantity);
        const sizes = cartSizesArray(item);
        const nextSizes = sizes.slice();
        if (slotIndex >= 0 && slotIndex < qty) {
          nextSizes[slotIndex] = sz;
        }
        const nextItem = { ...item, sizes: nextSizes };
        delete nextItem.size;
        return nextItem;
      }),
    );
  };

  const applyAllCartSizes = (productId, color, size) => {
    const sz = normalizeCartSize(size);
    setCart((prev) =>
      prev.map((item) => {
        if (item.productId !== productId || item.color !== color)
          return item;
        const qty = Math.max(1, item.quantity);
        const nextItem = {
          ...item,
          sizes: Array(qty).fill(sz),
        };
        delete nextItem.size;
        return nextItem;
      }),
    );
  };

  const cartLineSizesValid = (item) => {
    const qty = Math.max(1, Number(item.quantity || 1));
    const arr = cartSizesArray(item);
    return (
      arr.length === qty &&
      arr.every((s) => DEFAULT_SIZES.includes(normalizeCartSize(s)))
    );
  };

  const handleAuthSubmit = async () => {
    if (!auth || !db) return setAuthMessage("Missing Firebase env.");
    try {
      setAuthMessage("");
      const local = normalizeNamPhone(authPhone);
      if (local.length !== 9) {
        setAuthMessage("Enter exactly 9 digits after +264.");
        return;
      }
      const phone = `+264${local}`;
      const email = `${phone.replace(/\D/g, "")}@app.local`;
      if (authTab === "signup") {
        const displayName = normalizeDisplayUsername(authDisplayName);
        if (!isValidDisplayUsername(displayName)) {
          setAuthMessage(
            "Choose a display name (2–32 characters: letters, numbers, spaces, - _ .).",
          );
          return;
        }
        const cred = await createUserWithEmailAndPassword(
          auth,
          email,
          authPassword,
        );
        const isAdmin = ADMIN_PHONES.includes(phone);
        await setDoc(doc(db, "s1ntausers", cred.user.uid), {
          username: displayName,
          phone,
          role: isAdmin ? "admin" : "user",
          createdAt: serverTimestamp(),
        });
        if (isAdmin) {
          await setDoc(
            doc(db, "s1ntaadmins", phone.replace(/\D/g, "")),
            {
              phone,
              active: true,
              linkedUid: cred.user.uid,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
      } else {
        await signInWithEmailAndPassword(auth, email, authPassword);
      }
      setAuthOpen(false);
      setAuthDisplayName("");
      showToast(
        "success",
        authTab === "signup"
          ? "Account created successfully."
          : "Logged in successfully.",
      );
    } catch (err) {
      const msg = getFriendlyAuthError(err);
      setAuthMessage(msg);
      showToast("error", msg);
    }
  };

  const handleResetPasswordSubmit = async () => {
    setAuthMessage("");
    const local = normalizeNamPhone(authPhone);
    if (local.length !== 9) {
      setAuthMessage("Enter exactly 9 digits after +264.");
      return;
    }
    if (resetNewPassword.length < 6) {
      setAuthMessage("Password must be at least 6 characters.");
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setAuthMessage("Passwords do not match.");
      return;
    }
    try {
      const res = await fetch("/api/auth/reset-by-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneLocal: local,
          newPassword: resetNewPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404 || data.error === "NOT_FOUND") {
          setAuthMessage("No account found for this number.");
        } else if (res.status === 503 || data.error === "SERVER_CONFIG") {
          setAuthMessage(
            data.message ||
              "Password reset is not configured on the server yet.",
          );
        } else if (data.error === "WEAK_PASSWORD") {
          setAuthMessage("Password must be at least 6 characters.");
        } else {
          setAuthMessage("Could not reset password. Try again.");
        }
        showToast("error", "Password reset failed.");
        return;
      }
      setResetNewPassword("");
      setResetConfirmPassword("");
      setAuthPassword("");
      setAuthPaneMode("main");
      showToast("success", "Password updated. You can log in now.");
    } catch {
      setAuthMessage("Network error. Try again.");
      showToast("error", "Network error.");
    }
  };

  const proceedCheckout = () => {
    if (!userProfile) {
      setAuthMessage("Login required to continue");
      setAuthOpen(true);
      showToast("error", "Login required to continue.");
      return;
    }
    if (cart.some((item) => !cartLineSizesValid(item))) {
      showToast(
        "error",
        "Set a size for each piece in your cart before checkout.",
      );
      return;
    }
    setCartOpen(false);
    setOrdersOpen(false);
    navigateTo("checkout");
  };

  const saveAccountDisplayName = async () => {
    if (!db || !userProfile) return;
    const next = normalizeDisplayUsername(accountDisplayName);
    if (!isValidDisplayUsername(next)) {
      showToast(
        "error",
        "Display name: 2–32 characters (letters, numbers, spaces, - _ .).",
      );
      return;
    }
    if (next === userProfile.username) {
      showToast("success", "Display name is already set.");
      return;
    }
    setAccountSaving(true);
    try {
      await updateDoc(doc(db, "s1ntausers", userProfile.uid), {
        username: next,
      });
      setUserProfile((p) => (p ? { ...p, username: next } : p));
      setAccountDisplayName(next);
      showToast("success", "Display name saved.");
    } catch {
      showToast("error", "Could not save display name.");
    }
    setAccountSaving(false);
  };

  const scrollToNextSection = () => {
    const el = document.getElementById("home-next-section");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const finalizeManifest = async () => {
    if (!db || !userProfile || cart.length === 0) return;
    if (orderPlacing) return;
    if (cart.some((item) => !cartLineSizesValid(item))) {
      showToast(
        "error",
        "Set a size for each piece in your cart before confirming.",
      );
      return;
    }
    setOrderPlacing(true);

    const draft = normalizeDisplayUsername(checkoutDisplayName);
    let profileForOrder = userProfile;
    if (isValidDisplayUsername(draft) && draft !== userProfile.username) {
      try {
        await updateDoc(doc(db, "s1ntausers", userProfile.uid), {
          username: draft,
        });
        profileForOrder = { ...userProfile, username: draft };
        setUserProfile(profileForOrder);
      } catch {
        showToast("error", "Could not save display name. Order not placed.");
        setOrderPlacing(false);
        return;
      }
    }

    const resolvedUsername = orderDisplayUsername(
      profileForOrder,
      checkoutDisplayName,
    );

    const cartLines = cart.map((item) => {
      const qty = Math.max(1, Number(item.quantity || 1));
      const sizes = cartSizesArray(item);
      const { size: _legacy, ...rest } = item;
      return { ...rest, quantity: qty, sizes };
    });
    const sizesSummary = formatOrderSizesField(cartLines);

    const orderPayload = {
      uid: userProfile.uid,
      username: resolvedUsername,
      phone:
        profileForOrder.phone || `+264${normalizeNamPhone(authPhone)}`,
      items: cartLines,
      sizes: sizesSummary,
      total,
      notes: checkoutNotes,
      status: "pending",
      createdAt: serverTimestamp(),
      emailStatus: "sending",
      emailError: null,
      emailSentAt: null,
      emailLastAttemptAt: serverTimestamp(),
    };

    let orderRef;
    try {
      orderRef = await addDoc(collection(db, "s1ntaorders"), orderPayload);
    } catch {
      showToast("error", "Could not save order.");
      setOrderPlacing(false);
      return;
    }

    if (!isEmailJsConfigured()) {
      try {
        await updateDoc(orderRef, {
          emailStatus: "failed",
          emailError: "Email service not configured (add EmailJS keys to .env).",
          emailLastAttemptAt: serverTimestamp(),
        });
      } catch {
        /* ignore */
      }
      showToast(
        "error",
        "Order saved. Add EmailJS credentials to send confirmation emails.",
      );
    } else {
      try {
        await emailjs.send(
          process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID,
          process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID,
          {
            order_id: orderRef.id,
            username: orderPayload.username,
            phone: orderPayload.phone,
            items: formatItemsForEmail(cartLines),
            sizes: sizesSummary,
            total: Number(orderPayload.total).toFixed(2),
            notes: orderPayload.notes || "",
          },
          { publicKey: process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY },
        );
        await updateDoc(orderRef, {
          emailStatus: "sent",
          emailSentAt: serverTimestamp(),
          emailError: null,
          emailLastAttemptAt: serverTimestamp(),
        });
        showToast("success", "Order confirmed.");
      } catch (e) {
        const detail = formatEmailJsError(e);
        try {
          await updateDoc(orderRef, {
            emailStatus: "failed",
            emailError: detail,
            emailLastAttemptAt: serverTimestamp(),
          });
        } catch {
          /* ignore */
        }
        showToast(
          "error",
          `Order saved. Email failed:\n${detail}\nResend from Orders.`,
        );
      }
    }

    setCart([]);
    setCheckoutNotes("");
    navigateTo("home", { instant: true });
    await loadUserOrders();
    setOrderPlacing(false);
  };

  const loadAdminData = useCallback(async () => {
    if (!db || userProfile?.role !== "admin") return;
    const [p, o, r] = await Promise.all([
      getDocs(collection(db, "s1ntaproducts")),
      getDocs(
        query(collection(db, "s1ntaorders"), orderBy("createdAt", "desc")),
      ),
      getDocs(
        query(collection(db, "s1ntareviews"), orderBy("createdAt", "desc")),
      ),
    ]);
    setProducts(p.docs.map((d) => ({ id: d.id, ...d.data() })));
    setOrders(o.docs.map((d) => ({ id: d.id, ...d.data() })));
    setReviews(r.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, [userProfile]);

  const formatOrderTimestamp = (ts) => {
    if (!ts) return "—";
    try {
      const d =
        typeof ts.toDate === "function"
          ? ts.toDate()
          : new Date(ts.seconds ? ts.seconds * 1000 : ts);
      return d.toLocaleString();
    } catch {
      return "—";
    }
  };

  const normalizeOrderItems = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const retryOrderConfirmationEmail = async (order) => {
    if (!db || !userProfile || order.uid !== userProfile.uid) return;
    if (order.emailStatus !== "failed") return;
    if (!isEmailJsConfigured()) {
      showToast("error", "Email is not configured.");
      return;
    }
    const orderRef = doc(db, "s1ntaorders", order.id);
    try {
      await updateDoc(orderRef, {
        emailStatus: "sending",
        emailError: null,
        emailLastAttemptAt: serverTimestamp(),
      });
      await loadUserOrders();
      const retryItems = normalizeOrderItems(order.items);
      const retrySizes = order.sizes || formatOrderSizesField(retryItems);
      await emailjs.send(
        process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID,
        process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID,
        {
          order_id: order.id,
          username: order.username || "",
          phone: order.phone || "",
          items: formatItemsForEmail(retryItems),
          sizes: retrySizes,
          total: Number(order.total || 0).toFixed(2),
          notes: order.notes || "",
        },
        { publicKey: process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY },
      );
      await updateDoc(orderRef, {
        emailStatus: "sent",
        emailSentAt: serverTimestamp(),
        emailError: null,
        emailLastAttemptAt: serverTimestamp(),
      });
      showToast("success", "Order confirmed.");
    } catch (e) {
      const detail = formatEmailJsError(e);
      try {
        await updateDoc(orderRef, {
          emailStatus: "failed",
          emailError: detail,
          emailLastAttemptAt: serverTimestamp(),
        });
      } catch {
        /* ignore */
      }
      showToast("error", `Email failed:\n${detail}`);
    }
    await loadUserOrders();
  };

  const markOrderFulfilled = async (orderId) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, "s1ntaorders", orderId), {
        status: "fulfilled",
        fulfilledAt: serverTimestamp(),
      });
      await loadAdminData();
      showToast("success", "Order marked fulfilled.");
    } catch {
      showToast("error", "Could not update order.");
    }
  };

  useEffect(() => {
    if (routeName === "admin" && userProfile?.role === "admin") {
      loadAdminData();
    }
  }, [routeName, userProfile, loadAdminData]);

  const createAdminProduct = async () => {
    if (!db || !adminProductName.trim()) return;
    const images = adminColorRows
      .map((r) => ({ color: r.color.trim().toUpperCase(), url: r.url.trim() }))
      .filter((r) => r.color && r.url);
    const finalImages = images.length
      ? images
      : [{ color: "default", url: "/demo/assets/skully.png" }];
    await addDoc(collection(db, "s1ntaproducts"), {
      name: adminProductName.trim(),
      price: Number(adminProductPrice || 0),
      images: finalImages,
      category: adminProductCategory,
      visible: true,
      newArrival: adminProductNewArrival,
      createdAt: serverTimestamp(),
    });
    setAdminProductName("");
    setAdminProductPrice("");
    setAdminProductCategory("SHIRTS");
    setAdminProductNewArrival(false);
    setAdminColorRows([{ color: "", url: "" }]);
    loadAdminData();
    showToast("success", "Product created.");
  };

  const toggleProductVisibility = async (productId, nextVisible) => {
    if (!db) return;
    await updateDoc(doc(db, "s1ntaproducts", productId), {
      visible: nextVisible,
    });
    await loadAdminData();
    showToast(
      "success",
      nextVisible ? "Product visible in shop." : "Product hidden from shop.",
    );
  };

  const toggleProductNewArrival = async (productId, nextNewArrival) => {
    if (!db) return;
    await updateDoc(doc(db, "s1ntaproducts", productId), {
      newArrival: nextNewArrival,
      updatedAt: serverTimestamp(),
    });
    await loadAdminData();
    showToast(
      "success",
      nextNewArrival
        ? "Marked as new arrival."
        : "Removed from new arrivals.",
    );
  };

  const deleteProduct = async (productId) => {
    if (!db) return;
    await deleteDoc(doc(db, "s1ntaproducts", productId));
    await loadAdminData();
    showToast("success", "Product deleted.");
  };

  const startEditProduct = (product) => {
    setEditingProductId(product.id);
    setEditName(product.name || "");
    setEditPrice(String(product.price ?? ""));
    setEditCategory(product.category || "SHIRTS");
    setEditVisible(product.visible !== false);
    setEditNewArrival(product.newArrival === true);
    setEditColorRows(
      product.images?.length
        ? product.images.map((img) => ({
            color: img.color || "",
            url: img.url || "",
          }))
        : [{ color: "", url: "" }],
    );
  };

  const cancelEditProduct = () => {
    setEditingProductId(null);
    setEditName("");
    setEditPrice("");
    setEditCategory("SHIRTS");
    setEditVisible(true);
    setEditNewArrival(false);
    setEditColorRows([{ color: "", url: "" }]);
  };

  const addEditColorRow = () => {
    setEditColorRows((prev) => [...prev, { color: "", url: "" }]);
  };

  const updateEditColorRow = (idx, key, value) => {
    setEditColorRows((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, [key]: value } : row)),
    );
  };

  const removeEditColorRow = (idx) => {
    setEditColorRows((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx),
    );
  };

  const saveEditedProduct = async () => {
    if (!db || !editingProductId || !editName.trim()) return;
    const images = editColorRows
      .map((r) => ({ color: r.color.trim().toUpperCase(), url: r.url.trim() }))
      .filter((r) => r.color && r.url);

    await updateDoc(doc(db, "s1ntaproducts", editingProductId), {
      name: editName.trim(),
      price: Number(editPrice || 0),
      category: editCategory,
      visible: editVisible,
      newArrival: editNewArrival,
      images: images.length
        ? images
        : [{ color: "DEFAULT", url: "/demo/assets/skully.png" }],
      updatedAt: serverTimestamp(),
    });
    await loadAdminData();
    cancelEditProduct();
    showToast("success", "Product updated.");
  };

  const addColorRow = () => {
    setAdminColorRows((prev) => [...prev, { color: "", url: "" }]);
  };

  const updateColorRow = (idx, key, value) => {
    setAdminColorRows((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, [key]: value } : row)),
    );
  };

  const removeColorRow = (idx) => {
    setAdminColorRows((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx),
    );
  };

  const submitReview = async () => {
    if (!db || !reviewInput.trim()) return;
    await addDoc(collection(db, "s1ntareviews"), {
      username: reviewDisplayUsername(userProfile),
      message: reviewInput.trim(),
      visible: true,
      createdAt: serverTimestamp(),
    });
    setReviewInput("");
    setReviewOpen(false);
    if (routeName === "admin") loadAdminData();
    showToast("success", "Review submitted.");
  };

  useEffect(() => {
    if (!toast) return;
    const ms = toast.type === "error" ? 12000 : 2800;
    const t = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(t);
  }, [toast]);

  const profileUidDep = userProfile?.uid ?? null;
  const profileUsernameDep = userProfile?.username ?? null;
  const profilePhoneDep = userProfile?.phone ?? null;

  /* Fixed-length deps: primitives + userProfile (never optional chaining inside the array)
     so React never sees a changing dependency count after Fast Refresh. */
  useEffect(() => {
    if (!authOpen) {
      setAuthPaneMode("main");
      setResetNewPassword("");
      setResetConfirmPassword("");
      setAuthMessage("");
      setAuthDisplayName("");
    } else if (userProfile) {
      setAccountDisplayName(displayNameFieldValue(userProfile));
    }
  }, [
    authOpen,
    profileUidDep,
    profileUsernameDep,
    profilePhoneDep,
    userProfile,
  ]);

  useEffect(() => {
    const from = prevRouteNameForCheckoutRef.current;
    prevRouteNameForCheckoutRef.current = routeName;
    if (routeName !== "checkout" || !userProfile) return;
    if (from !== "checkout") {
      setCheckoutDisplayName(displayNameFieldValue(userProfile));
    }
  }, [
    routeName,
    profileUidDep,
    profileUsernameDep,
    profilePhoneDep,
    userProfile,
  ]);

  if (!isLoaded) {
    return (
      <main className="min-h-screen grid place-items-center bg-black">
        <div className="flex flex-col items-center gap-4">
          <img
            src={normalizeImageUrl(visualLinks.logo)}
            alt="S1NTA loading"
            className="h-24 w-24 animate-pulse object-contain opacity-80"
          />
        </div>
      </main>
    );
  }

  return (
    <div>
      <div className="grain" />
      <div className="spotlight" id="spotlight" />
      <div id="story-layer">
        <div
          className="story-rect w-64 h-96 top-[12%] left-[5%]"
          style={{ transform: "rotate(-4deg)" }}
        >
          <img
            src={normalizeImageUrl(visualLinks.background_visual_01)}
            alt=""
          />
          <div className="story-content-fallback">Fragment_01</div>
        </div>
        <div
          className="story-rect w-72 top-[18%] right-[4%]"
          style={{ transform: "rotate(3deg)" }}
        >
          <img
            src={normalizeImageUrl(visualLinks.background_visual_02)}
            alt=""
          />
          <div className="story-content-fallback">Manifesto_Static</div>
        </div>
        <div
          className="story-rect w-72 h-72 bottom-[10%] left-[20%]"
          style={{ transform: "rotate(-2deg)" }}
        >
          <img
            src={normalizeImageUrl(visualLinks.background_visual_03)}
            alt=""
          />
          <div className="story-content-fallback">Subject_Beta</div>
        </div>
        <div
          className="story-rect w-64 h-80 top-[10%] left-[45%]"
          style={{ transform: "rotate(2deg)" }}
        >
          <img
            src={normalizeImageUrl(visualLinks.background_visual_04)}
            alt=""
          />
          <div className="story-content-fallback">Shop_04</div>
        </div>
        <div
          className="story-rect w-72 h-96 bottom-[8%] right-[25%]"
          style={{ transform: "rotate(1deg)" }}
        >
          <img
            src={normalizeImageUrl(visualLinks.background_visual_05)}
            alt=""
          />
          <div className="story-content-fallback">Shop_05</div>
        </div>
      </div>

      <nav className="fixed top-0 z-50 flex w-full items-center justify-between p-4 text-white md:p-10">
        <button
          onClick={() => navigateTo("home")}
          className="font-black text-xl tracking-tighter uppercase select-none md:text-2xl"
        >
          S1NTA
        </button>
        <div className="hidden flex-wrap items-center justify-end gap-x-8 gap-y-2 text-[10px] font-light uppercase tracking-[0.3em] md:flex">
          {routeName !== "admin" && (
            <>
              <button
                onClick={() => navigateTo("shop")}
                className="hover:text-[--accent]"
              >
                SHOP
              </button>
              <button
                onClick={() => openCartPane()}
                className="hover:text-[--accent]"
              >
                CART ({cartCount})
              </button>
              {userProfile ? (
                <button
                  type="button"
                  onClick={() => openOrdersPane()}
                  className="hover:text-[--accent]"
                >
                  ORDERS
                </button>
              ) : null}
            </>
          )}
          {!userProfile ? (
            <button
              onClick={() => setAuthOpen(true)}
              className="hover:text-[--accent]"
            >
              LOG IN
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setAuthOpen(true)}
              className="hover:text-[--accent]"
            >
              ACCOUNT
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen((s) => !s)}
          className="flex h-10 w-10 flex-col items-center justify-center gap-1.5 rounded border border-white/15 text-white transition hover:border-[--accent]/40 md:hidden"
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-menu-panel"
          aria-label="Toggle menu"
        >
          <span className="h-px w-5 bg-current" />
          <span className="h-px w-5 bg-current" />
          <span className="h-px w-5 bg-current" />
        </button>
      </nav>

      <div
        className={`fixed inset-0 z-55 md:hidden ${mobileMenuOpen ? "" : "pointer-events-none"}`}
      >
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className={`absolute inset-0 bg-black/70 transition-opacity ${mobileMenuOpen ? "opacity-100" : "opacity-0"}`}
          aria-label="Close menu backdrop"
        />
        <div
          id="mobile-menu-panel"
          className={`absolute right-0 top-0 flex h-full w-[min(100%,20rem)] flex-col border-l border-white/10 bg-[#050505] px-8 pb-10 pt-20 shadow-2xl transition-transform duration-300 ${mobileMenuOpen ? "translate-x-0" : "translate-x-full"}`}
        >
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="absolute right-6 top-6 text-[10px] uppercase tracking-widest text-zinc-500 hover:text-white"
          >
            Close [x]
          </button>
          <div className="flex flex-col gap-8 text-[10px] font-light uppercase tracking-[0.35em]">
            {routeName !== "admin" && (
              <>
                <button
                  onClick={() => {
                    navigateTo("shop");
                    setMobileMenuOpen(false);
                  }}
                  className="border-b border-white/5 pb-4 text-left transition-colors hover:text-[--accent]"
                >
                  SHOP
                </button>
                <button
                  onClick={() => {
                    openCartPane();
                    setMobileMenuOpen(false);
                  }}
                  className="border-b border-white/5 pb-4 text-left transition-colors hover:text-[--accent]"
                >
                  CART ({cartCount})
                </button>
                {userProfile ? (
                  <button
                    type="button"
                    onClick={() => {
                      openOrdersPane();
                      setMobileMenuOpen(false);
                    }}
                    className="border-b border-white/5 pb-4 text-left transition-colors hover:text-[--accent]"
                  >
                    ORDERS
                  </button>
                ) : null}
              </>
            )}
            {!userProfile ? (
              <button
                onClick={() => {
                  setAuthOpen(true);
                  setMobileMenuOpen(false);
                }}
                className="border-b border-white/5 pb-4 text-left transition-colors hover:text-[--accent]"
              >
                LOG IN
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAuthOpen(true);
                  setMobileMenuOpen(false);
                }}
                className="border-b border-white/5 pb-4 text-left transition-colors hover:text-[--accent]"
              >
                ACCOUNT
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="relative z-10">
        {routeName === "home" && (
          <>
            <section className="h-screen flex flex-col justify-center items-center px-5 max-md:min-h-dvh md:px-6">
              <div className="reveal active relative flex w-full flex-col items-center text-center">
                <img
                  src={normalizeImageUrl(visualLinks.logo)}
                  alt=""
                  className="hero-logo-bg"
                />
                <h1 className="w-full text-[11vw] font-black leading-none uppercase tracking-tighter mb-3 select-none md:mb-4 md:text-[14vw]">
                  S1N
                  <span
                    className="text-transparent"
                    style={{ WebkitTextStroke: "1px white" }}
                  >
                    TA
                  </span>
                </h1>
                <p className="max-w-md px-2 text-zinc-500 text-[10px] uppercase font-light leading-relaxed tracking-[0.28em] md:text-sm md:tracking-[0.35em]">
                  To the world
                </p>
                <button
                  type="button"
                  onClick={scrollToNextSection}
                  className="group mx-auto mt-10 flex w-max flex-col items-center gap-3 text-zinc-500 transition-colors hover:text-[--accent]"
                  aria-label="Scroll to next section"
                >
                  <span className="text-[8px] uppercase tracking-[0.35em]">
                    Scroll
                  </span>
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 transition group-hover:border-[--accent]/50">
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      aria-hidden="true"
                    >
                      <path
                        d="M6 9l6 6 6-6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </button>
              </div>
            </section>

            <section
              id="home-next-section"
              className="flex min-h-screen items-center scroll-mt-8 px-6 py-20 max-md:text-center md:px-12 md:py-32 lg:px-24"
            >
              <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-16 max-md:justify-items-center md:grid-cols-2 md:gap-24">
                <div className="reveal active max-md:flex max-md:flex-col max-md:items-center">
                  <span className="text-yellow-400 font-mono text-[9px] tracking-widest uppercase md:text-[10px]">
                    Appendix // 01
                  </span>
                  <p className="mt-5 mb-3 max-w-sm text-xl font-semibold uppercase leading-tight tracking-tight text-white max-md:mx-auto md:text-3xl">
                    <span className="brush-highlight">
                      Born from unity, movement and street love
                    </span>
                  </p>
                  <p className="mb-10 max-w-sm text-xs uppercase leading-relaxed tracking-wider text-zinc-500 max-md:mx-auto md:mb-12 md:text-sm">
                    Crafted for leaders
                    <br />
                    Designed for tomorrow
                    <br />
                    Not just fashion...a new code
                  </p>
                  <button
                    onClick={() => navigateTo("shop")}
                    className="border border-white/20 px-8 py-3 text-[9px] uppercase tracking-[0.45em] transition-all hover:bg-white hover:text-black"
                  >
                    View shop
                  </button>
                </div>
                <div className="reveal active relative flex w-full justify-center max-md:max-w-sm md:justify-end">
                  <div className="glow-hover w-full max-w-md border border-white/5 p-2 rotate-[-4deg] transition-transform duration-700 hover:-rotate-2">
                    <img
                      src={normalizeImageUrl(visualLinks.main_visual)}
                      alt=""
                      className="w-full h-auto"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="flex min-h-screen items-center px-6 py-20 max-md:text-center md:px-12 md:py-32 lg:px-24">
              <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-16 max-md:justify-items-center md:grid-cols-2 md:gap-24">
                <div className="reveal active order-2 flex justify-center max-md:order-2 max-md:max-w-sm md:order-1 md:justify-start">
                  <div className="glow-hover border border-white/5 p-2 rotate-[-3.5deg] transition-transform duration-700 hover:rotate-[-1.8deg]">
                    <img
                      src={normalizeImageUrl(visualLinks.beanie_visual)}
                      alt=""
                      className="w-full h-auto max-w-md"
                    />
                  </div>
                </div>
                <div className="reveal active order-1 max-md:flex max-md:flex-col max-md:items-center md:order-2">
                  <span className="text-yellow-400 font-mono text-[9px] tracking-widest uppercase md:text-[10px]">
                    Appendix // 02
                  </span>
                  <p className="mt-5 mb-3 max-w-sm text-xl font-semibold uppercase leading-tight tracking-tight text-white max-md:mx-auto md:text-3xl">
                    <span className="brush-highlight">
                      One piece, no rules.
                    </span>
                  </p>
                  <p className="mb-10 max-w-sm text-xs uppercase leading-relaxed tracking-wider text-zinc-500 max-md:mx-auto md:mb-12 md:text-sm">
                    Same beanie, four ways — it&apos;s really up to you.
                    <br />
                    Wear it however TF you want
                  </p>
                  <button
                    onClick={() => navigateTo("shop")}
                    className="border border-white/20 px-8 py-3 text-[9px] uppercase tracking-[0.45em] transition-all hover:bg-white hover:text-black"
                  >
                    View shop
                  </button>
                </div>
              </div>
            </section>

            <section className="flex min-h-screen items-center px-6 py-20 max-md:text-center md:px-12 md:py-32 lg:px-24">
              <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-16 max-md:justify-items-center md:grid-cols-2 md:gap-24">
                <div className="reveal active max-md:flex max-md:flex-col max-md:items-center">
                  <span className="text-yellow-400 font-mono text-[9px] tracking-widest uppercase md:text-[10px]">
                    Appendix // 03
                  </span>
                  <p className="mt-5 mb-3 max-w-sm text-xl font-semibold uppercase leading-tight tracking-tight text-white max-md:mx-auto md:text-3xl">
                    <span className="brush-highlight">
                      Seen from above, still locked in.
                    </span>
                  </p>
                  <p className="mb-10 max-w-sm text-xs uppercase leading-relaxed tracking-wider text-zinc-500 max-md:mx-auto md:mb-12 md:text-sm">
                    Two figures, one frame — placed with intent, not accident.
                    <br />
                    It&apos;s less about posing, more about how it sits
                    together.
                  </p>
                  <button
                    onClick={() => navigateTo("shop")}
                    className="border border-white/20 px-8 py-3 text-[9px] uppercase tracking-[0.45em] transition-all hover:bg-white hover:text-black"
                  >
                    View shop
                  </button>
                </div>
                <div className="reveal active relative flex w-full justify-center max-md:max-w-sm md:justify-end">
                  <div className="glow-hover w-full max-w-md border border-white/5 p-2 rotate-[-4.2deg] transition-transform duration-700 hover:rotate-[-2.2deg]">
                    <img
                      src={normalizeImageUrl(visualLinks.group_visual)}
                      alt=""
                      className="w-full h-auto"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="flex min-h-screen items-center px-6 py-20 max-md:text-center md:px-12 md:py-32 lg:px-24">
              <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-16 max-md:justify-items-center md:grid-cols-2 md:gap-24">
                <div className="reveal active order-2 flex justify-center max-md:order-2 max-md:max-w-sm md:order-1 md:justify-start">
                  <div className="glow-hover border border-white/5 p-2 -rotate-3 transition-transform duration-700 hover:rotate-[-1.5deg]">
                    <img
                      src={normalizeImageUrl(visualLinks.pink_visual)}
                      alt=""
                      className="w-full h-auto max-w-md"
                    />
                  </div>
                </div>
                <div className="reveal active order-1 max-md:flex max-md:flex-col max-md:items-center md:order-2">
                  <span className="text-yellow-400 font-mono text-[9px] tracking-widest uppercase md:text-[10px]">
                    Appendix // 04
                  </span>
                  <p className="mt-5 mb-3 max-w-sm text-xl font-semibold uppercase leading-tight tracking-tight text-white max-md:mx-auto md:text-3xl">
                    <span className="brush-highlight">
                      Close, but not all the way.
                    </span>
                  </p>
                  <p className="mb-10 max-w-sm text-xs uppercase leading-relaxed tracking-wider text-zinc-500 max-md:mx-auto md:mb-12 md:text-sm">
                    Just enough to catch the feel without saying too much.
                    <br />
                    Same energy, different frame.
                  </p>
                  <button
                    onClick={() => navigateTo("shop")}
                    className="border border-white/20 px-8 py-3 text-[9px] uppercase tracking-[0.45em] transition-all hover:bg-white hover:text-black"
                  >
                    View shop
                  </button>
                </div>
              </div>
            </section>

            <footer className="px-6 py-24 text-center md:py-60">
              <div className="reveal active">
                <h2 className="mb-8 text-[10px] uppercase tracking-[0.55em] text-zinc-500 md:mb-12 md:text-xs md:tracking-[0.8em]">
                  ON TO THE NEXT CHAPTER
                </h2>
                <button
                  onClick={() => navigateTo("shop")}
                  className="text-2xl font-light uppercase tracking-[0.4em] transition-colors hover:text-[--accent] md:text-3xl"
                >
                  EXPLORE SHOP
                </button>
                <div className="mx-auto mt-8 h-16 w-px bg-white/40" />
                <p className="mt-8 text-[9px] uppercase tracking-[0.35em] text-zinc-500">
                  © s1nta clothing 2026
                </p>
                <p className="mt-3 text-[9px] uppercase tracking-[0.35em] text-zinc-500">
                  designed by{" "}
                  <a
                    href="https://www.instagram.com/c1xver/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-yellow-400 transition-colors hover:text-yellow-300"
                  >
                    clxver
                  </a>
                </p>
              </div>
            </footer>
          </>
        )}

        {routeName === "shop" && (
          <section className="mx-auto max-w-[1320px] px-4 py-24 md:px-6 md:py-40">
            <div className="mb-8 flex flex-col gap-6 border-b border-white/5 pb-6 md:mb-10 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-[10px] uppercase tracking-[0.8em] text-zinc-500">
                  Shop / All_Arrivals
                </h2>
                <p className="mt-2 text-[9px] uppercase tracking-widest text-zinc-700">
                  {visibleProducts.length} entries
                </p>
              </div>
              <div className="w-full md:max-w-sm">
                <div className="relative">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                  </svg>
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    type="search"
                    placeholder="Filter by name, keyword..."
                    className="w-full border border-white/10 bg-transparent py-3 pl-10 pr-4 text-[10px] uppercase tracking-widest outline-none focus:border-[--accent]"
                  />
                </div>
              </div>
            </div>
            <div className="mb-8 flex flex-wrap items-center gap-2">
              {shopCategories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategoryFilter(category)}
                  className={`border px-3 py-2 text-[9px] uppercase tracking-widest transition ${
                    activeCategoryFilter === category
                      ? "border-[--accent] text-[--accent]"
                      : "border-white/20 text-zinc-400 hover:border-[--accent]/50 hover:text-white"
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-x-8 gap-y-14 md:grid-cols-3">
              {visibleProducts.map((p) => (
                <article
                  key={p.id}
                  className="group glow-hover border border-white/5 p-4 transition-all duration-700 md:p-6"
                >
                  <div className="relative mx-auto aspect-square w-full overflow-hidden bg-[#050505]">
                    {p.newArrival === true ? (
                      <span className="pointer-events-none absolute right-2 top-2 z-10 border border-[--accent]/50 bg-black/75 px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.2em] text-[--accent]">
                        New
                      </span>
                    ) : null}
                    {(() => {
                      const images = p.images?.length
                        ? p.images
                        : [
                            {
                              color: "DEFAULT",
                              url: "/demo/assets/skully.png",
                            },
                          ];
                      const currentIdx = selectedColorIndexByProduct[p.id] ?? 0;
                      const currentVariant = images[currentIdx] || images[0];
                      return (
                        <>
                          <img
                            src={normalizeImageUrl(currentVariant?.url)}
                            alt=""
                            onError={(e) => {
                              e.currentTarget.src = "/demo/assets/skully.png";
                            }}
                            className={`mx-auto h-full w-full object-contain p-4 transition duration-300 ${switchingColorByProduct[p.id] ? "opacity-60" : "opacity-100"}`}
                          />
                          {images.length > 1 && (
                            <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-between px-2">
                              <button
                                type="button"
                                onClick={() =>
                                  cycleProductColor(p.id, -1, images)
                                }
                                className="h-8 w-8 border border-white/20 bg-black/40 text-xs uppercase"
                              >
                                {"<"}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  cycleProductColor(p.id, 1, images)
                                }
                                className="h-8 w-8 border border-white/20 bg-black/40 text-xs uppercase"
                              >
                                {">"}
                              </button>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div className="mt-3 flex justify-center">
                    {(() => {
                      const images = p.images?.length
                        ? p.images
                        : [
                            {
                              color: "DEFAULT",
                              url: "/demo/assets/skully.png",
                            },
                          ];
                      const idx = selectedColorIndexByProduct[p.id] ?? 0;
                      const currentVariant = images[idx] || images[0];
                      return (
                        <button
                          type="button"
                          onClick={() => addToCart(p, currentVariant)}
                          className="bg-white px-10 py-3 text-[9px] font-bold uppercase tracking-widest text-black transition hover:bg-[--accent]"
                        >
                          Add +
                        </button>
                      );
                    })()}
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-4 border-t border-white/5 pt-4">
                    <h3 className="text-xs font-bold uppercase tracking-widest md:text-sm">
                      {(() => {
                        const images = p.images?.length
                          ? p.images
                          : [{ color: "DEFAULT" }];
                        const idx = selectedColorIndexByProduct[p.id] ?? 0;
                        const color =
                          (images[idx] || images[0])?.color || "DEFAULT";
                        return `${p.name} (${color})`;
                      })()}
                    </h3>
                    <span className="shrink-0 font-mono text-sm tabular-nums text-[--accent]">
                      N${Number(p.price || 0).toFixed(2)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {routeName === "checkout" && (
          <section className="mx-auto max-w-4xl px-4 py-24 sm:px-6 md:py-40">
            <div className="grid gap-10 md:grid-cols-2 md:gap-20">
              <div className="order-2 space-y-10 md:order-1 md:space-y-12">
                <div>
                  <label className="text-[9px] text-zinc-600 uppercase tracking-widest mb-4 block">
                    Display name
                  </label>
                  <input
                    value={checkoutDisplayName}
                    onChange={(e) => setCheckoutDisplayName(e.target.value)}
                    maxLength={32}
                    autoComplete="nickname"
                    placeholder="How you appear on orders & reviews"
                    className="w-full bg-transparent border-b border-white/10 py-4 text-[10px] uppercase tracking-widest outline-none placeholder:text-zinc-600"
                  />
                  <p className="mt-2 text-[9px] uppercase tracking-widest text-zinc-600">
                    For display only. We never ask for your email.
                  </p>
                </div>
                <div>
                  <label className="text-[9px] text-zinc-600 uppercase tracking-widest mb-4 block">
                    Phone
                  </label>
                  <input
                    value={userProfile?.phone || ""}
                    disabled
                    className="w-full bg-transparent border-b border-white/10 py-4 text-[10px] uppercase"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-zinc-600 uppercase tracking-widest mb-4 block">
                    Notes (optional)
                  </label>
                  <textarea
                    value={checkoutNotes}
                    onChange={(e) => setCheckoutNotes(e.target.value)}
                    className="w-full bg-transparent border-b border-white/10 py-4 text-[10px] uppercase"
                  />
                </div>
                <div className="space-y-2">
                  {cart.map((item) => (
                    <p
                      key={`${item.productId}-${item.color}`}
                      className="text-[10px] uppercase tracking-widest text-zinc-400"
                    >
                      {item.name} ({item.color}) —{" "}
                      {formatLineSizesSummary(item)} · qty {item.quantity}
                    </p>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={orderPlacing}
                  onClick={finalizeManifest}
                  className="w-full bg-white py-4 text-[10px] font-black uppercase tracking-[0.4em] text-black hover:bg-[--accent] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {orderPlacing ? "Confirming…" : "Confirm order"}
                </button>
              </div>
              <div className="order-1 h-fit w-full md:order-2 md:sticky md:top-28 lg:top-32">
                <div className="border border-white/5 bg-[#050505] p-5 sm:p-8 md:p-10">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="min-w-0 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                      Total price
                    </span>
                    <span className="shrink-0 text-right font-mono text-2xl font-black tabular-nums tracking-tight text-[--accent] sm:text-3xl">
                      N${total.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {routeName === "admin" && (
          <section className="mx-auto max-w-5xl px-4 py-32 md:px-6 md:py-40">
            {userProfile?.role === "admin" ? (
              <div className="space-y-10">
                <h2 className="uppercase tracking-[0.6em] text-zinc-500 text-xs">
                  ADMIN PANEL
                </h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setAdminPane("inventory")}
                    className={`px-3 py-2 text-[10px] uppercase tracking-widest border ${adminPane === "inventory" ? "border-[--accent] text-[--accent]" : "border-white/20"}`}
                  >
                    Inventory
                  </button>
                  <button
                    onClick={() => setAdminPane("orders")}
                    className={`px-3 py-2 text-[10px] uppercase tracking-widest border ${adminPane === "orders" ? "border-[--accent] text-[--accent]" : "border-white/20"}`}
                  >
                    Orders
                  </button>
                  <button
                    onClick={() => setAdminPane("reviews")}
                    className={`px-3 py-2 text-[10px] uppercase tracking-widest border ${adminPane === "reviews" ? "border-[--accent] text-[--accent]" : "border-white/20"}`}
                  >
                    Reviews
                  </button>
                </div>

                {adminPane === "inventory" && (
                  <div className="border border-white/10 p-4 space-y-3">
                    <h3 className="uppercase text-xs tracking-widest">
                      Inventory Management Pane
                    </h3>
                    <input
                      value={adminProductName}
                      onChange={(e) => setAdminProductName(e.target.value)}
                      placeholder="Product name"
                      className="w-full border border-white/10 bg-transparent px-3 py-2 text-xs uppercase"
                    />
                    <input
                      value={adminProductPrice}
                      onChange={(e) => setAdminProductPrice(e.target.value)}
                      placeholder="Price"
                      className="w-full border border-white/10 bg-transparent px-3 py-2 text-xs uppercase"
                    />
                    <select
                      value={adminProductCategory}
                      onChange={(e) => setAdminProductCategory(e.target.value)}
                      className="w-full border border-white/10 bg-transparent px-3 py-2 text-xs uppercase"
                    >
                      <option value="SHIRTS" className="bg-black">
                        SHIRTS
                      </option>
                      <option value="BOTTOMS" className="bg-black">
                        BOTTOMS
                      </option>
                      <option value="ACCESSORIES" className="bg-black">
                        ACCESSORIES
                      </option>
                      <option value="OUTWEAR" className="bg-black">
                        OUTWEAR
                      </option>
                    </select>
                    <label className="flex cursor-pointer items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-400">
                      <input
                        type="checkbox"
                        checked={adminProductNewArrival}
                        onChange={(e) =>
                          setAdminProductNewArrival(e.target.checked)
                        }
                        className="accent-[--accent]"
                      />
                      New arrival (sorted first in shop)
                    </label>
                    <div className="space-y-2">
                      {adminColorRows.map((row, idx) => (
                        <div
                          key={`color-row-${idx}`}
                          className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_2fr_auto]"
                        >
                          <input
                            value={row.color}
                            onChange={(e) =>
                              updateColorRow(idx, "color", e.target.value)
                            }
                            placeholder="Color (e.g. RED)"
                            className="w-full border border-white/10 bg-transparent px-3 py-2 text-xs uppercase"
                          />
                          <input
                            value={row.url}
                            onChange={(e) =>
                              updateColorRow(idx, "url", e.target.value)
                            }
                            placeholder="Image URL for this color"
                            className="w-full border border-white/10 bg-transparent px-3 py-2 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => removeColorRow(idx)}
                            className="border border-white/20 px-3 py-2 text-[10px] uppercase tracking-widest hover:border-red-400 hover:text-red-300"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addColorRow}
                        className="border border-white/20 px-3 py-2 text-[10px] uppercase tracking-widest hover:border-[--accent] hover:text-[--accent]"
                      >
                        Add another color
                      </button>
                    </div>
                    <button
                      onClick={createAdminProduct}
                      className="bg-white px-4 py-2 text-black text-xs uppercase tracking-widest hover:bg-[--accent]"
                    >
                      Create Product
                    </button>

                    <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
                      <h4 className="text-[10px] uppercase tracking-widest text-zinc-500">
                        Current Products
                      </h4>
                      {adminSortedProducts.map((p) => (
                        <div
                          key={p.id}
                          className="flex flex-col gap-2 border-b border-white/10 pb-3 md:flex-row md:items-center md:justify-between"
                        >
                          {editingProductId === p.id ? (
                            <div className="w-full space-y-3">
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                <input
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  placeholder="Product name"
                                  className="w-full border border-white/10 bg-transparent px-3 py-2 text-xs uppercase"
                                />
                                <input
                                  value={editPrice}
                                  onChange={(e) => setEditPrice(e.target.value)}
                                  placeholder="Price"
                                  className="w-full border border-white/10 bg-transparent px-3 py-2 text-xs uppercase"
                                />
                                <select
                                  value={editCategory}
                                  onChange={(e) =>
                                    setEditCategory(e.target.value)
                                  }
                                  className="w-full border border-white/10 bg-transparent px-3 py-2 text-xs uppercase"
                                >
                                  <option value="SHIRTS" className="bg-black">
                                    SHIRTS
                                  </option>
                                  <option value="BOTTOMS" className="bg-black">
                                    BOTTOMS
                                  </option>
                                  <option
                                    value="ACCESSORIES"
                                    className="bg-black"
                                  >
                                    ACCESSORIES
                                  </option>
                                  <option value="OUTWEAR" className="bg-black">
                                    OUTWEAR
                                  </option>
                                </select>
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-6">
                                <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-400">
                                  <input
                                    type="checkbox"
                                    checked={editVisible}
                                    onChange={(e) =>
                                      setEditVisible(e.target.checked)
                                    }
                                    className="accent-[--accent]"
                                  />
                                  Visible in shop
                                </label>
                                <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-400">
                                  <input
                                    type="checkbox"
                                    checked={editNewArrival}
                                    onChange={(e) =>
                                      setEditNewArrival(e.target.checked)
                                    }
                                    className="accent-[--accent]"
                                  />
                                  New arrival
                                </label>
                              </div>
                              <div className="space-y-2">
                                {editColorRows.map((row, idx) => (
                                  <div
                                    key={`edit-row-${idx}`}
                                    className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_2fr_auto]"
                                  >
                                    <input
                                      value={row.color}
                                      onChange={(e) =>
                                        updateEditColorRow(
                                          idx,
                                          "color",
                                          e.target.value,
                                        )
                                      }
                                      placeholder="Color"
                                      className="w-full border border-white/10 bg-transparent px-3 py-2 text-xs uppercase"
                                    />
                                    <input
                                      value={row.url}
                                      onChange={(e) =>
                                        updateEditColorRow(
                                          idx,
                                          "url",
                                          e.target.value,
                                        )
                                      }
                                      placeholder="Image URL"
                                      className="w-full border border-white/10 bg-transparent px-3 py-2 text-xs"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => removeEditColorRow(idx)}
                                      className="border border-white/20 px-2 py-1 text-[10px] uppercase tracking-widest hover:border-red-400 hover:text-red-300"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={addEditColorRow}
                                  className="border border-white/20 px-3 py-2 text-[10px] uppercase tracking-widest hover:border-[--accent] hover:text-[--accent]"
                                >
                                  Add color row
                                </button>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={saveEditedProduct}
                                  className="border border-emerald-400/40 px-3 py-2 text-[10px] uppercase tracking-widest text-emerald-300 hover:bg-emerald-400/10"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditProduct}
                                  className="border border-white/20 px-3 py-2 text-[10px] uppercase tracking-widest"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="text-[10px] uppercase tracking-wider">
                                {p.newArrival === true ? (
                                  <span className="mr-2 text-[--accent]">
                                    [NEW]
                                  </span>
                                ) : null}
                                {p.name} - N${Number(p.price || 0).toFixed(2)} [
                                {p.category || "UNCATEGORIZED"}]
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => startEditProduct(p)}
                                  className="border border-white/20 px-2 py-1 text-[10px] uppercase tracking-widest hover:border-[--accent] hover:text-[--accent]"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleProductNewArrival(
                                      p.id,
                                      p.newArrival !== true,
                                    )
                                  }
                                  className="border border-white/20 px-2 py-1 text-[10px] uppercase tracking-widest hover:border-[--accent] hover:text-[--accent]"
                                >
                                  {p.newArrival === true
                                    ? "Unmark new"
                                    : "Mark new"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleProductVisibility(
                                      p.id,
                                      p.visible === false,
                                    )
                                  }
                                  className="border border-white/20 px-2 py-1 text-[10px] uppercase tracking-widest hover:border-[--accent] hover:text-[--accent]"
                                >
                                  {p.visible === false
                                    ? "Show in shop"
                                    : "Hide from shop"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteProduct(p.id)}
                                  className="border border-red-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-red-300 hover:bg-red-400/10"
                                >
                                  Delete
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {adminPane === "orders" && (
                  <div className="space-y-4 border border-white/10 p-4">
                    <h3 className="text-xs uppercase tracking-widest">
                      Orders
                    </h3>
                    {orders.length === 0 ? (
                      <p className="text-[10px] uppercase tracking-widest text-zinc-600">
                        No orders yet.
                      </p>
                    ) : (
                      orders.map((o) => {
                        const items = normalizeOrderItems(o.items);
                        const statusRaw = String(
                          o.status || "pending",
                        ).toLowerCase();
                        const isFulfilled = statusRaw === "fulfilled";
                        return (
                          <div
                            key={o.id}
                            className="border border-white/10 bg-black/30 p-4 text-left"
                          >
                            <div className="flex flex-col gap-3 border-b border-white/10 pb-3 md:flex-row md:flex-wrap md:items-start md:justify-between">
                              <div>
                                <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                                  Order #
                                </p>
                                <p className="break-all font-mono text-xs text-white">
                                  {o.id}
                                </p>
                              </div>
                              <div
                                className={`inline-flex w-fit items-center border px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${
                                  isFulfilled
                                    ? "border-emerald-500/50 text-emerald-400"
                                    : "border-amber-500/50 text-amber-300"
                                }`}
                              >
                                {isFulfilled ? "Fulfilled" : "Not fulfilled"}
                              </div>
                              <div className="text-[10px] uppercase tracking-wider text-zinc-500 md:text-right">
                                <p>{formatOrderTimestamp(o.createdAt)}</p>
                              </div>
                            </div>
                            <div className="mt-3 space-y-1 text-[11px] text-zinc-300">
                              <p>
                                <span className="text-zinc-500">Customer: </span>
                                {o.username || "—"}
                              </p>
                              <p>
                                <span className="text-zinc-500">Phone: </span>
                                {o.phone || "—"}
                              </p>
                              {o.notes ? (
                                <p>
                                  <span className="text-zinc-500">Notes: </span>
                                  {o.notes}
                                </p>
                              ) : null}
                              {o.sizes ? (
                                <p>
                                  <span className="text-zinc-500">Sizes: </span>
                                  {o.sizes}
                                </p>
                              ) : null}
                            </div>
                            <div className="mt-4">
                              <p className="mb-2 text-[10px] uppercase tracking-widest text-zinc-500">
                                Products ({items.length})
                              </p>
                              <ul className="space-y-3">
                                {items.length === 0 ? (
                                  <li className="text-[10px] uppercase tracking-widest text-zinc-600">
                                    No line items stored on this order.
                                  </li>
                                ) : (
                                  items.map((line, li) => (
                                    <li
                                      key={`${o.id}-${line.productId}-${line.color}-${li}`}
                                      className="flex gap-3 border border-white/5 bg-black/40 p-2"
                                    >
                                      <img
                                        src={normalizeImageUrl(line.image)}
                                        alt=""
                                        className="h-14 w-14 shrink-0 border border-white/10 object-cover"
                                        onError={(e) => {
                                          e.currentTarget.src =
                                            "/demo/assets/skully.png";
                                        }}
                                      />
                                      <div className="min-w-0 flex-1 text-[10px] uppercase tracking-wider">
                                        <p className="text-white">
                                          {line.name || "Product"}
                                        </p>
                                        <p className="text-zinc-500">
                                          Color: {line.color || "—"} · Sizes:{" "}
                                          {formatLineSizesSummary(line)} · Qty{" "}
                                          {line.quantity ?? 1}
                                        </p>
                                        <p className="mt-1 text-zinc-400">
                                          N$
                                          {(
                                            Number(line.price || 0) *
                                            Number(line.quantity || 1)
                                          ).toFixed(2)}
                                        </p>
                                      </div>
                                    </li>
                                  ))
                                )}
                              </ul>
                            </div>
                            <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-3 sm:flex-row sm:items-center sm:justify-between">
                              <p className="font-mono text-sm text-[--accent]">
                                Total N${Number(o.total || 0).toFixed(2)}
                              </p>
                              {!isFulfilled ? (
                                <button
                                  type="button"
                                  onClick={() => markOrderFulfilled(o.id)}
                                  className="border border-emerald-500/50 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-400 transition hover:bg-emerald-500/10"
                                >
                                  Mark fulfilled
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {adminPane === "reviews" && (
                  <div className="border border-white/10 p-4 space-y-3">
                    <h3 className="uppercase text-xs tracking-widest">
                      Reviews Pane
                    </h3>
                    {reviews.map((r) => (
                      <div
                        key={r.id}
                        className="border-b border-white/10 pb-2 text-xs uppercase tracking-wider flex flex-col items-start justify-between gap-2 md:flex-row md:items-center"
                      >
                        <span className="wrap-break-word">
                          {r.username}: {r.message}
                        </span>
                        <button
                          onClick={() =>
                            updateDoc(doc(db, "s1ntareviews", r.id), {
                              visible: !r.visible,
                            })
                          }
                          className="text-[10px] uppercase text-[--accent]"
                        >
                          {r.visible ? "Hide" : "Show"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                <p className="uppercase tracking-widest text-zinc-600">
                  Admin access required.
                </p>
                {!userProfile ? (
                  <div className="space-y-3">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500">
                      Log in with an admin account to continue.
                    </p>
                    <button
                      onClick={() => {
                        setAuthTab("login");
                        setAuthPassword("");
                        setAuthMessage("");
                        setAuthOpen(true);
                      }}
                      className="border border-white/20 px-6 py-3 text-[10px] uppercase tracking-[0.35em] hover:border-[--accent] hover:text-[--accent]"
                    >
                      Log in as admin
                    </button>
                  </div>
                ) : (
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500">
                    You are logged in, but this account is not an admin.
                  </p>
                )}
              </div>
            )}
          </section>
        )}
      </main>

      <div
        className={`fixed inset-0 z-62 ${authOpen ? "" : "pointer-events-none"}`}
      >
        <div
          className={`absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity duration-500 ${authOpen ? "opacity-100" : "opacity-0"}`}
          onClick={() => setAuthOpen(false)}
        />
        <div
          className={`absolute left-0 top-0 flex h-full w-full max-w-md flex-col border-r border-white/5 bg-[#050505] shadow-2xl transition-transform duration-500 pointer-events-auto md:p-12 ${authOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <button
            onClick={() => setAuthOpen(false)}
            className="absolute right-4 top-4 z-10 md:hidden text-zinc-500 hover:text-white"
            aria-label="Close login"
            type="button"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6L18 18" />
            </svg>
          </button>
          <div className="flex min-h-0 flex-1 flex-col justify-center px-8 pb-10 pt-14 md:px-0 md:py-0 md:pt-0">
            <div className="mb-8 flex flex-col items-center text-center">
              <img
                src={normalizeImageUrl(visualLinks.logo)}
                alt="S1NTA"
                className="h-14 w-auto max-w-[180px] object-contain opacity-90 md:h-16 md:max-w-[200px]"
                onError={(e) => {
                  e.currentTarget.src = "/assets/logo.png";
                }}
              />
              <p className="mt-3 max-w-md text-[10px] font-light uppercase leading-relaxed tracking-[0.35em] text-zinc-500 md:mt-4 md:text-xs md:tracking-[0.4em]">
                To the World
              </p>
            </div>
            {userProfile ? (
              <>
                <p className="mb-2 text-center text-xs font-bold uppercase tracking-[0.35em] text-white md:text-sm">
                  Account
                </p>
                <p className="mb-6 text-center text-[11px] leading-relaxed text-zinc-500">
                  View Account Information
                </p>
                <label className="mb-2 block text-[11px] font-medium uppercase tracking-widest text-zinc-300 md:text-xs">
                  Display name
                </label>
                <input
                  value={accountDisplayName}
                  onChange={(e) => setAccountDisplayName(e.target.value)}
                  maxLength={32}
                  autoComplete="nickname"
                  placeholder="Username"
                  className="mb-5 w-full border-b border-white/15 bg-transparent py-3.5 text-sm tracking-wide text-white outline-none placeholder:text-zinc-600 md:text-base"
                />
                <label className="mb-2 block text-[11px] font-medium uppercase tracking-widest text-zinc-300 md:text-xs">
                  Mobile number
                </label>
                <div className="mb-6 border-b border-white/15 py-3.5 text-sm uppercase tracking-widest text-zinc-500">
                  {userProfile.phone || "—"}
                </div>
                <button
                  type="button"
                  onClick={saveAccountDisplayName}
                  disabled={accountSaving}
                  className="w-full bg-white py-4 text-xs font-black uppercase tracking-[0.35em] text-black transition hover:bg-[#f5f0c8] disabled:cursor-not-allowed disabled:opacity-50 md:py-5 md:tracking-[0.4em]"
                >
                  {accountSaving ? "Saving…" : "Save display name"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    auth && signOut(auth);
                    setAuthOpen(false);
                  }}
                  className="mt-5 w-full border border-white/20 py-4 text-center text-[11px] font-medium uppercase tracking-widest text-zinc-400 transition-colors hover:border-[--accent]/40 hover:text-[#f5f0c8]"
                >
                  Log out
                </button>
              </>
            ) : authPaneMode === "reset" ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setAuthPaneMode("main");
                    setAuthMessage("");
                  }}
                  className="mb-6 self-start text-[11px] font-medium uppercase tracking-widest text-zinc-500 transition-colors duration-200 hover:text-[#f5f0c8]"
                >
                  ← Back to log in
                </button>
                <p className="mb-6 text-center text-xs font-bold uppercase tracking-[0.35em] text-white md:text-sm">
                  Reset password
                </p>
                <p className="mb-6 text-center text-[11px] leading-relaxed text-zinc-500">
                  Enter the mobile number for your account and choose a new
                  password. No verification step for now.
                </p>
                <label className="mb-2 block text-[11px] font-medium uppercase tracking-widest text-zinc-300 md:text-xs">
                  Mobile number
                </label>
                <div className="mb-5 flex items-center border-b border-white/15">
                  <span className="py-3.5 pr-2 text-xs font-medium uppercase tracking-widest text-zinc-400">
                    +264
                  </span>
                  <input
                    value={authPhone}
                    maxLength={9}
                    onChange={(e) =>
                      setAuthPhone(normalizeNamPhone(e.target.value))
                    }
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="81…"
                    className="w-full bg-transparent py-3.5 text-sm uppercase tracking-widest text-white outline-none placeholder:text-zinc-600 md:text-base"
                  />
                </div>
                <label className="mb-2 block text-[11px] font-medium uppercase tracking-widest text-zinc-300 md:text-xs">
                  New password
                </label>
                <div className="mb-5 flex items-center border-b border-white/15">
                  <input
                    value={resetNewPassword}
                    onChange={(e) => setResetNewPassword(e.target.value)}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="New password"
                    className="w-full bg-transparent py-3.5 text-sm tracking-wide text-white outline-none placeholder:text-zinc-600 md:text-base"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="shrink-0 text-[11px] font-medium uppercase tracking-widest text-zinc-400 transition-colors hover:text-[#f5f0c8]"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <label className="mb-2 block text-[11px] font-medium uppercase tracking-widest text-zinc-300 md:text-xs">
                  Confirm new password
                </label>
                <div className="mb-5 flex items-center border-b border-white/15">
                  <input
                    value={resetConfirmPassword}
                    onChange={(e) => setResetConfirmPassword(e.target.value)}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Confirm password"
                    className="w-full bg-transparent py-3.5 text-sm tracking-wide text-white outline-none placeholder:text-zinc-600 md:text-base"
                  />
                </div>
                {authMessage && (
                  <p className="mb-4 text-sm leading-snug text-red-400">
                    {authMessage}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleResetPasswordSubmit}
                  className="w-full bg-white py-4 text-xs font-black uppercase tracking-[0.35em] text-black transition hover:bg-[#f5f0c8] md:py-5 md:tracking-[0.4em]"
                >
                  Update password
                </button>
              </>
            ) : (
              <>
                <div className="mb-8 flex gap-2 border-b border-white/10 pb-1">
                  <button
                    type="button"
                    onClick={() => setAuthTab("login")}
                    className={`flex-1 border-b-2 py-3 text-[11px] font-bold uppercase tracking-widest transition-colors duration-200 md:text-xs ${authTab === "login" ? "border-[--accent] text-white hover:text-[#f5f0c8]" : "border-transparent text-zinc-500 hover:text-[#f5f0c8]"}`}
                  >
                    Log in
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthTab("signup")}
                    className={`flex-1 border-b-2 py-3 text-[11px] font-bold uppercase tracking-widest transition-colors duration-200 md:text-xs ${authTab === "signup" ? "border-[--accent] text-white hover:text-[#f5f0c8]" : "border-transparent text-zinc-500 hover:text-[#f5f0c8]"}`}
                  >
                    Sign up
                  </button>
                </div>
                <label className="mb-2 block text-[11px] font-medium uppercase tracking-widest text-zinc-300 md:text-xs">
                  Mobile number
                </label>
                <div className="mb-5 flex items-center border-b border-white/15">
                  <span className="py-3.5 pr-2 text-xs font-medium uppercase tracking-widest text-zinc-400">
                    +264
                  </span>
                  <input
                    value={authPhone}
                    maxLength={9}
                    onChange={(e) =>
                      setAuthPhone(normalizeNamPhone(e.target.value))
                    }
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="81…"
                    className="w-full bg-transparent py-3.5 text-sm uppercase tracking-widest text-white outline-none placeholder:text-zinc-600 md:text-base"
                  />
                </div>
                {authTab === "signup" ? (
                  <>
                    <label className="mb-2 block text-[11px] font-medium uppercase tracking-widest text-zinc-300 md:text-xs">
                      Display name
                    </label>
                    <input
                      value={authDisplayName}
                      onChange={(e) => setAuthDisplayName(e.target.value)}
                      maxLength={32}
                      autoComplete="nickname"
                      placeholder="Shown on orders & reviews (not your email)"
                      className="mb-5 w-full border-b border-white/15 bg-transparent py-3.5 text-sm tracking-wide text-white outline-none placeholder:text-zinc-600 md:text-base"
                    />
                  </>
                ) : null}
                <label className="mb-2 block text-[11px] font-medium uppercase tracking-widest text-zinc-300 md:text-xs">
                  Password
                </label>
                <div className="mb-5 flex items-center border-b border-white/15">
                  <input
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    type={showPassword ? "text" : "password"}
                    autoComplete={
                      authTab === "signup" ? "new-password" : "current-password"
                    }
                    placeholder="Password"
                    className="w-full bg-transparent py-3.5 text-sm tracking-wide text-white outline-none placeholder:text-zinc-600 md:text-base"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="shrink-0 text-[11px] font-medium uppercase tracking-widest text-zinc-400 transition-colors hover:text-[#f5f0c8]"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                {authMessage && (
                  <p className="mb-4 text-sm leading-snug text-red-400">
                    {authMessage}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleAuthSubmit}
                  className="w-full bg-white py-4 text-xs font-black uppercase tracking-[0.35em] text-black transition hover:bg-[#f5f0c8] md:py-5 md:tracking-[0.4em]"
                >
                  Continue
                </button>
                {authTab === "login" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthPaneMode("reset");
                      setAuthMessage("");
                      setResetNewPassword("");
                      setResetConfirmPassword("");
                    }}
                    className="mt-5 w-full text-center text-[11px] font-medium uppercase tracking-widest text-zinc-500 transition-colors duration-200 hover:text-[#f5f0c8]"
                  >
                    Reset password
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      <div
        className={`fixed inset-0 z-60 ${cartOpen ? "" : "pointer-events-none"}`}
      >
        <div
          className={`absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity duration-500 ${cartOpen ? "opacity-100" : "opacity-0"}`}
          onClick={() => setCartOpen(false)}
        />
        <div
          className={`absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-white/5 bg-[#050505] p-6 shadow-2xl transition-transform duration-500 pointer-events-auto md:p-12 ${cartOpen ? "translate-x-0" : "translate-x-full"}`}
        >
          <button
            onClick={() => setCartOpen(false)}
            className="absolute right-4 top-4 md:hidden text-zinc-500 hover:text-white"
            aria-label="Close cart"
            type="button"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6L18 18" />
            </svg>
          </button>
          <div className="flex justify-between items-center mb-12">
            <h2 className="text-[10px] uppercase tracking-[0.5em] font-bold text-zinc-400">
              Shop_Current
            </h2>
          </div>
          <div className="grow space-y-8 overflow-y-auto custom-scrollbar">
            {cart.length === 0 ? (
              <p className="text-zinc-700 text-[10px] uppercase tracking-widest italic">
                Shop empty.
              </p>
            ) : (
              cart.map((item) => {
                const qty = Math.max(1, item.quantity);
                const sizes = cartSizesArray(item);
                return (
                  <div
                    key={`${item.productId}-${item.color}`}
                    className="border-b border-white/5 pb-5"
                  >
                    <div className="flex items-start gap-3">
                      <img
                        src={normalizeImageUrl(item.image)}
                        alt=""
                        onError={(e) => {
                          e.currentTarget.src = "/demo/assets/skully.png";
                        }}
                        className="h-14 w-14 shrink-0 border border-white/10 object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase leading-tight tracking-widest text-white">
                          {item.name}
                        </p>
                        <p className="mt-0.5 text-[9px] uppercase tracking-wider text-zinc-500">
                          {item.color}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-[11px] font-bold tabular-nums text-white">
                          N${(item.price * item.quantity).toFixed(2)}
                        </p>
                        <p className="mt-1 text-[8px] uppercase tracking-wider text-zinc-500">
                          N${Number(item.price).toFixed(2)} each
                        </p>
                      </div>
                    </div>
                    <div className="mt-4">
                      <CartSizeDisplay sizes={sizes} qty={qty} />
                    </div>
                    <div className="mt-4 border-t border-white/10 pt-4">
                      <p className="mb-3 text-center text-[8px] font-bold uppercase tracking-[0.25em] text-zinc-500">
                        Select size
                      </p>
                      {qty === 1 ? (
                        <div className="flex flex-wrap justify-center">
                          <CartSizeChipRow
                            value={sizes[0]}
                            onChange={(sz) =>
                              setCartSlotSize(
                                item.productId,
                                item.color,
                                0,
                                sz,
                              )
                            }
                            dense={false}
                          />
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div>
                            <p className="mb-2 text-center text-[7px] uppercase tracking-widest text-zinc-600">
                              Set all pieces to
                            </p>
                            <div className="flex flex-wrap justify-center gap-1">
                              {DEFAULT_SIZES.map((sz) => (
                                <button
                                  key={`all-${sz}`}
                                  type="button"
                                  onClick={() =>
                                    applyAllCartSizes(
                                      item.productId,
                                      item.color,
                                      sz,
                                    )
                                  }
                                  className="min-h-8 min-w-[1.75rem] rounded-lg border border-white/15 px-1.5 text-[8px] font-bold uppercase text-zinc-400 transition hover:border-[--accent]/50 hover:text-[--accent]"
                                >
                                  {sz}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-3 border-t border-white/5 pt-3">
                            <p className="text-center text-[7px] uppercase tracking-widest text-zinc-600">
                              Or pick per piece
                            </p>
                            {sizes.slice(0, qty).map((szVal, si) => (
                              <div
                                key={si}
                                className="flex flex-col items-center gap-2"
                              >
                                <span className="text-[8px] font-bold tabular-nums text-zinc-500">
                                  #{si + 1}
                                </span>
                                <CartSizeChipRow
                                  value={szVal}
                                  onChange={(sz) =>
                                    setCartSlotSize(
                                      item.productId,
                                      item.color,
                                      si,
                                      sz,
                                    )
                                  }
                                  dense={false}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
                      <div className="inline-flex items-stretch overflow-hidden rounded-md border border-white/15 bg-black/50">
                        <button
                          type="button"
                          aria-label="Decrease quantity"
                          className="px-3 py-2.5 text-base leading-none text-zinc-400 transition hover:bg-white/5 hover:text-white"
                          onClick={() =>
                            updateCartQuantity(item.productId, item.color, -1)
                          }
                        >
                          −
                        </button>
                        <span className="flex min-w-[2.5rem] items-center justify-center border-x border-white/10 font-mono text-[11px] tabular-nums text-white">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label="Increase quantity"
                          className="px-3 py-2.5 text-base leading-none text-zinc-400 transition hover:bg-white/5 hover:text-white"
                          onClick={() =>
                            updateCartQuantity(item.productId, item.color, 1)
                          }
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          removeCartItem(item.productId, item.color)
                        }
                        className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-red-400/90 transition hover:text-red-300"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="pt-8 border-t border-white/5">
            <p className="font-mono text-2xl font-black text-[--accent] mb-4">
              N${total.toFixed(2)}
            </p>
            <button
              onClick={proceedCheckout}
              className="w-full bg-white py-4 text-[10px] font-black uppercase tracking-[0.3em] text-black hover:bg-[--accent] md:py-5 md:tracking-[0.4em]"
            >
              Proceed to Checkout
            </button>
          </div>
        </div>
      </div>

      <div
        className={`fixed inset-0 z-61 ${ordersOpen && userProfile ? "" : "pointer-events-none"}`}
      >
        <div
          className={`absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity duration-500 ${ordersOpen && userProfile ? "opacity-100" : "opacity-0"}`}
          onClick={() => setOrdersOpen(false)}
        />
        <div
          className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-white/5 bg-[#050505] p-6 shadow-2xl transition-transform duration-500 pointer-events-auto md:p-12 ${ordersOpen && userProfile ? "translate-x-0" : "translate-x-full"}`}
        >
          <button
            type="button"
            onClick={() => setOrdersOpen(false)}
            className="absolute right-4 top-4 md:hidden text-zinc-500 hover:text-white"
            aria-label="Close orders"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6L18 18" />
            </svg>
          </button>
          <div className="mb-8 flex items-center justify-between pr-10 md:pr-0">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.5em] text-zinc-400">
              Your orders
            </h2>
          </div>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto custom-scrollbar pb-6">
            {!userProfile ? (
              <p className="text-[10px] uppercase tracking-widest text-zinc-600">
                Log in to see orders.
              </p>
            ) : userOrdersError ? (
              <div className="space-y-4">
                <p className="text-[10px] leading-relaxed uppercase tracking-widest text-red-300">
                  {userOrdersError}
                </p>
                <button
                  type="button"
                  onClick={() => loadUserOrders()}
                  className="w-full border border-white/20 py-3 text-[10px] font-bold uppercase tracking-widest text-white transition hover:border-[--accent] hover:text-[--accent]"
                >
                  Retry
                </button>
              </div>
            ) : userOrdersLoading ? (
              <p className="text-[10px] uppercase tracking-widest text-zinc-500">
                Loading orders…
              </p>
            ) : userOrders.length === 0 ? (
              <p className="text-[10px] uppercase tracking-widest text-zinc-600">
                No orders yet.
              </p>
            ) : (
              userOrders.map((o) => {
                const lines = normalizeOrderItems(o.items);
                const emailStatus = String(o.emailStatus || "").toLowerCase();
                return (
                  <div
                    key={o.id}
                    className="border border-white/10 bg-black/30 p-4"
                  >
                    <p className="font-mono text-[9px] text-zinc-500">
                      {formatOrderTimestamp(o.createdAt)}
                    </p>
                    <ul className="mt-3 space-y-2 border-b border-white/10 pb-3">
                      {lines.length === 0 ? (
                        <li className="text-[10px] uppercase text-zinc-600">
                          (No line items)
                        </li>
                      ) : (
                        lines.map((line, idx) => (
                          <li
                            key={`${o.id}-line-${idx}`}
                            className="flex justify-between gap-2 text-[10px] uppercase tracking-wider text-zinc-300"
                          >
                            <span>
                              {line.name} ({line.color}) —{" "}
                              {formatLineSizesSummary(line)} ×
                              {line.quantity ?? 1}
                            </span>
                            <span className="shrink-0 text-zinc-500">
                              N$
                              {(
                                Number(line.price || 0) *
                                Number(line.quantity || 1)
                              ).toFixed(2)}
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="font-mono text-sm text-[--accent]">
                        Total N${Number(o.total || 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-4 border-t border-white/10 pt-3">
                      {emailStatus === "sent" ? (
                        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-emerald-400">
                          <span
                            className="flex h-6 w-6 items-center justify-center rounded-full border border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                            aria-hidden="true"
                          >
                            ✓
                          </span>
                          Order confirmed
                        </div>
                      ) : emailStatus === "sending" ? (
                        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-amber-300">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                          Pending…
                        </div>
                      ) : emailStatus === "failed" ? (
                        <div className="space-y-2">
                          <p className="text-[10px] uppercase tracking-widest text-red-300">
                            Email failed
                            {o.emailError ? `: ${o.emailError}` : ""}
                          </p>
                          <button
                            type="button"
                            onClick={() => retryOrderConfirmationEmail(o)}
                            className="w-full border border-amber-500/40 py-2 text-[10px] font-bold uppercase tracking-widest text-amber-200 transition hover:bg-amber-500/10"
                          >
                            Resend confirmation email
                          </button>
                        </div>
                      ) : (
                        <p className="text-[10px] uppercase tracking-widest text-zinc-500">
                          Confirmation status not recorded
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {routeName !== "admin" && (
        <div className="fixed bottom-5 right-5 z-70">
          {!reviewOpen ? (
            <button
              onClick={() => setReviewOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/60 text-zinc-300 hover:border-[--accent] hover:text-white"
              aria-label="Open reviews chat"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path
                  d="M21 12a8.5 8.5 0 0 1-8.5 8.5H6l-3 3v-6.5A8.5 8.5 0 1 1 21 12Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : (
            <div className="w-[min(18rem,90vw)] border border-white/15 bg-[#050505]/95 p-3 shadow-2xl backdrop-blur-sm">
              <p className="mb-2 text-[9px] uppercase tracking-widest text-zinc-500">
                Leave a review
              </p>
              <textarea
                value={reviewInput}
                onChange={(e) => setReviewInput(e.target.value)}
                placeholder="Share feedback..."
                className="mb-3 h-24 w-full resize-none border border-white/10 bg-transparent px-2 py-2 text-[10px] uppercase tracking-wider outline-none focus:border-[--accent]"
              />
              <div className="flex gap-2">
                <button
                  onClick={submitReview}
                  className="bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-black hover:bg-[--accent]"
                >
                  Send
                </button>
                <button
                  onClick={() => setReviewOpen(false)}
                  className="border border-white/20 px-3 py-2 text-[10px] uppercase tracking-widest"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {toast && (
        <div className="pointer-events-none fixed right-5 top-20 z-[110]">
          <div
            className={`max-w-md min-w-64 border px-4 py-3 text-[10px] uppercase tracking-widest shadow-2xl whitespace-pre-line wrap-break-word ${
              toast.type === "success"
                ? "border-emerald-400/40 bg-emerald-950/70 text-emerald-200"
                : "border-red-400/40 bg-red-950/70 text-red-200"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      {routeLoading && (
        <div className="fixed inset-0 z-90 grid place-items-center bg-black/85 backdrop-blur-sm">
          <img
            src={normalizeImageUrl(visualLinks.logo)}
            alt="S1NTA route loading"
            className="h-24 w-24 object-contain animate-pulse"
          />
        </div>
      )}
    </div>
  );
}
