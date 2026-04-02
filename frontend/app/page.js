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
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { S1NTA_VISUAL_LINKS_TEMPLATE } from "@/lib/s1ntaVisualLinks";

const ADMIN_PHONES = ["+264857884817", "+264814989258"];
const ENABLE_EMAILJS_AT_CHECKOUT = false;

export default function Home({ forcedRoute = "home" }) {
  const [routeName, setRouteName] = useState(forcedRoute);
  const [isLoaded, setIsLoaded] = useState(false);
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState(() => {
    if (typeof window === "undefined") return [];
    const saved = window.localStorage.getItem("s1nta_cart");
    return saved ? JSON.parse(saved) : [];
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState("ALL");
  const [authTab, setAuthTab] = useState("login");
  const [authPhone, setAuthPhone] = useState("");
  const [authPassword, setAuthPassword] = useState("");
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
  const [editingProductId, setEditingProductId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editCategory, setEditCategory] = useState("SHIRTS");
  const [editVisible, setEditVisible] = useState(true);
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

  const navigateTo = useCallback(
    (nextRoute) => {
      if (nextRoute === routeName) return;
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
  }, [routeName]);

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
        setIsLoaded(true);
        return;
      }
      const p = await getDocs(collection(db, "s1ntaproducts"));
      setProducts(p.docs.map((d) => ({ id: d.id, ...d.data() })));
      const visualsDoc = await getDoc(doc(db, "s1ntavisuals", "default"));
      if (visualsDoc.exists()) {
        setVisualLinks((prev) => ({ ...prev, ...visualsDoc.data() }));
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
  }, []);

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
    return ["ALL", ...Array.from(new Set(base))];
  }, [products]);

  const visibleProducts = useMemo(() => {
    const categoryOrder = ["SHIRTS", "BOTTOMS", "OUTWEAR", "ACCESSORIES"];
    const rank = (category) => {
      const idx = categoryOrder.indexOf(category);
      return idx === -1 ? categoryOrder.length : idx;
    };

    return products
      .filter((p) => {
        if (p.visible === false) return false;
        const matchesSearch = `${p.name || ""} ${p.description || ""}`
          .toLowerCase()
          .includes(searchQuery.toLowerCase());
        const category = (p.category || "UNCATEGORIZED").toUpperCase();
        const matchesCategory =
          activeCategoryFilter === "ALL" || category === activeCategoryFilter;
        return matchesSearch && matchesCategory;
      })
      .sort((a, b) => {
        const categoryA = (a.category || "UNCATEGORIZED").toUpperCase();
        const categoryB = (b.category || "UNCATEGORIZED").toUpperCase();
        const categoryDiff = rank(categoryA) - rank(categoryB);
        if (categoryDiff !== 0) return categoryDiff;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
  }, [products, searchQuery, activeCategoryFilter]);

  const addToCart = (product, variant) => {
    setCart((prev) => {
      const variantColor = variant?.color || "default";
      const idx = prev.findIndex(
        (x) => x.productId === product.id && x.color === variantColor,
      );
      if (idx > -1) {
        const next = [...prev];
        next[idx].quantity += 1;
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
          image: normalizeImageUrl(
            variant?.url ||
              product.images?.[0]?.url ||
              "/demo/assets/skully.png",
          ),
        },
      ];
    });
    setCartOpen(true);
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
            return { ...item, quantity: item.quantity + delta };
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
        const cred = await createUserWithEmailAndPassword(
          auth,
          email,
          authPassword,
        );
        const isAdmin = ADMIN_PHONES.includes(phone);
        await setDoc(doc(db, "s1ntausers", cred.user.uid), {
          username: phone,
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

  const proceedCheckout = () => {
    if (!userProfile) {
      setAuthMessage("Login required to continue");
      setAuthOpen(true);
      showToast("error", "Login required to continue.");
      return;
    }
    setCartOpen(false);
    navigateTo("checkout");
  };

  const scrollToNextSection = () => {
    const el = document.getElementById("home-next-section");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const finalizeManifest = async () => {
    if (!db || !userProfile || cart.length === 0) return;
    const payload = {
      uid: userProfile.uid,
      username: userProfile.username || "Guest",
      phone: userProfile.phone || `+264${normalizeNamPhone(authPhone)}`,
      items: cart,
      total,
      notes: checkoutNotes,
      status: "pending",
      createdAt: serverTimestamp(),
    };
    await addDoc(collection(db, "s1ntaorders"), payload);
    if (ENABLE_EMAILJS_AT_CHECKOUT) {
      await emailjs.send(
        process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID,
        process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID,
        {
          username: payload.username,
          phone: payload.phone,
          items: JSON.stringify(payload.items),
          total: payload.total.toFixed(2),
        },
        { publicKey: process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY },
      );
    }
    setCart([]);
    setCheckoutNotes("");
    navigateTo("home");
    showToast("success", "Order placed successfully.");
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
      createdAt: serverTimestamp(),
    });
    setAdminProductName("");
    setAdminProductPrice("");
    setAdminProductCategory("SHIRTS");
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
      username: userProfile?.username || "Anonymous",
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
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

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
          <div className="story-content-fallback">Archive_04</div>
        </div>
        <div
          className="story-rect w-72 h-96 bottom-[8%] right-[25%]"
          style={{ transform: "rotate(1deg)" }}
        >
          <img
            src={normalizeImageUrl(visualLinks.background_visual_05)}
            alt=""
          />
          <div className="story-content-fallback">Archive_05</div>
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
                onClick={() => navigateTo("archive")}
                className="hover:text-[--accent]"
              >
                ARCHIVE
              </button>
              <button
                onClick={() => setCartOpen(true)}
                className="hover:text-[--accent]"
              >
                CART ({cartCount})
              </button>
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
              onClick={() => auth && signOut(auth)}
              className="hover:text-[--accent]"
            >
              LOG OUT
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
                    navigateTo("archive");
                    setMobileMenuOpen(false);
                  }}
                  className="border-b border-white/5 pb-4 text-left transition-colors hover:text-[--accent]"
                >
                  Archive
                </button>
                <button
                  onClick={() => {
                    setCartOpen(true);
                    setMobileMenuOpen(false);
                  }}
                  className="border-b border-white/5 pb-4 text-left transition-colors hover:text-[--accent]"
                >
                  Cart ({cartCount})
                </button>
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
                Log in
              </button>
            ) : (
              <button
                onClick={() => {
                  auth && signOut(auth);
                  setMobileMenuOpen(false);
                }}
                className="border-b border-white/5 pb-4 text-left transition-colors hover:text-[--accent]"
              >
                Log out
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
                    onClick={() => navigateTo("archive")}
                    className="border border-white/20 px-8 py-3 text-[9px] uppercase tracking-[0.45em] transition-all hover:bg-white hover:text-black"
                  >
                    View archive
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
                    onClick={() => navigateTo("archive")}
                    className="border border-white/20 px-8 py-3 text-[9px] uppercase tracking-[0.45em] transition-all hover:bg-white hover:text-black"
                  >
                    View archive
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
                    onClick={() => navigateTo("archive")}
                    className="border border-white/20 px-8 py-3 text-[9px] uppercase tracking-[0.45em] transition-all hover:bg-white hover:text-black"
                  >
                    View archive
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
                    onClick={() => navigateTo("archive")}
                    className="border border-white/20 px-8 py-3 text-[9px] uppercase tracking-[0.45em] transition-all hover:bg-white hover:text-black"
                  >
                    View archive
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
                  onClick={() => navigateTo("archive")}
                  className="text-2xl font-light uppercase tracking-[0.4em] transition-colors hover:text-[--accent] md:text-3xl"
                >
                  EXPLORE ARCHIVE
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

        {routeName === "archive" && (
          <section className="mx-auto max-w-[1320px] px-4 py-24 md:px-6 md:py-40">
            <div className="mb-8 flex flex-col gap-6 border-b border-white/5 pb-6 md:mb-10 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-[10px] uppercase tracking-[0.8em] text-zinc-500">
                  Archive / All_Arrivals
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
          <section className="max-w-4xl mx-auto px-6 py-40">
            <div className="grid md:grid-cols-2 gap-20">
              <div className="space-y-12">
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
                      {item.name} ({item.color}) x{item.quantity}
                    </p>
                  ))}
                </div>
                <button
                  onClick={finalizeManifest}
                  className="w-full bg-white text-black py-4 text-[10px] font-black uppercase tracking-[0.4em] hover:bg-[--accent]"
                >
                  Finalize Manifest
                </button>
              </div>
              <div className="bg-[#050505] border border-white/5 p-10 h-fit sticky top-32">
                <div className="text-3xl font-black font-mono text-[--accent]">
                  N${total.toFixed(2)}
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
                      {products.map((p) => (
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
                              <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-400">
                                <input
                                  type="checkbox"
                                  checked={editVisible}
                                  onChange={(e) =>
                                    setEditVisible(e.target.checked)
                                  }
                                />
                                Visible in shop
                              </label>
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
                                {p.name} - N${Number(p.price || 0).toFixed(2)} [
                                {p.category || "UNCATEGORIZED"}]
                              </div>
                              <div className="flex gap-2">
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
                  <div className="border border-white/10 p-4 space-y-3">
                    <h3 className="uppercase text-xs tracking-widest">
                      Orders Pane
                    </h3>
                    {orders.map((o) => (
                      <div
                        key={o.id}
                        className="border-b border-white/10 pb-2 text-xs uppercase tracking-wider"
                      >
                        {o.username} / {o.phone} - N$
                        {Number(o.total || 0).toFixed(2)} (
                        {o.status || "pending"})
                      </div>
                    ))}
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
          className={`absolute left-0 top-0 flex h-full w-full max-w-md flex-col border-r border-white/5 bg-[#050505] p-8 shadow-2xl transition-transform duration-500 pointer-events-auto md:p-12 ${authOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="mb-8 flex gap-2 border-b border-white/10 pb-1">
            <button
              onClick={() => setAuthTab("login")}
              className={`flex-1 border-b-2 py-3 text-[9px] font-bold uppercase tracking-widest ${authTab === "login" ? "border-[--accent] text-white" : "border-transparent text-zinc-500"}`}
            >
              Log in
            </button>
            <button
              onClick={() => setAuthTab("signup")}
              className={`flex-1 border-b-2 py-3 text-[9px] font-bold uppercase tracking-widest ${authTab === "signup" ? "border-[--accent] text-white" : "border-transparent text-zinc-500"}`}
            >
              Sign up
            </button>
          </div>
          <label className="mb-2 block text-[9px] uppercase tracking-widest text-zinc-600">
            Mobile number
          </label>
          <div className="mb-4 flex items-center border-b border-white/10">
            <span className="py-4 pr-2 text-[10px] uppercase tracking-widest text-zinc-500">
              +264
            </span>
            <input
              value={authPhone}
              maxLength={9}
              onChange={(e) => setAuthPhone(normalizeNamPhone(e.target.value))}
              type="tel"
              placeholder="81..."
              className="w-full bg-transparent py-4 text-[10px] uppercase tracking-widest outline-none"
            />
          </div>
          <label className="mb-2 block text-[9px] uppercase tracking-widest text-zinc-600">
            Password
          </label>
          <div className="mb-4 flex items-center border-b border-white/10">
            <input
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              className="w-full bg-transparent py-4 text-[10px] tracking-wide outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="text-[9px] uppercase tracking-widest text-zinc-500 hover:text-white"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {authMessage && (
            <p className="text-[10px] text-red-400 mb-3">{authMessage}</p>
          )}
          <button
            onClick={handleAuthSubmit}
            className="mt-auto w-full bg-white py-5 text-[10px] font-black uppercase tracking-[0.4em] text-black hover:bg-[--accent]"
          >
            Continue
          </button>
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
          className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-white/5 bg-[#050505] p-6 shadow-2xl transition-transform duration-500 pointer-events-auto md:p-12 ${cartOpen ? "translate-x-0" : "translate-x-full"}`}
        >
          <div className="flex justify-between items-center mb-12">
            <h2 className="text-[10px] uppercase tracking-[0.5em] font-bold text-zinc-400">
              Archive_Current
            </h2>
          </div>
          <div className="grow space-y-8 overflow-y-auto custom-scrollbar">
            {cart.length === 0 ? (
              <p className="text-zinc-700 text-[10px] uppercase tracking-widest italic">
                Archive empty.
              </p>
            ) : (
              cart.map((item) => (
                <div
                  key={`${item.productId}-${item.color}`}
                  className="border-b border-white/5 pb-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <img
                      src={normalizeImageUrl(item.image)}
                      alt=""
                      onError={(e) => {
                        e.currentTarget.src = "/demo/assets/skully.png";
                      }}
                      className="h-14 w-14 object-cover border border-white/10"
                    />
                    <div className="flex-1 text-[10px] uppercase tracking-widest">
                      <p>
                        {item.name} ({item.color})
                      </p>
                      <p className="text-zinc-500">
                        N${Number(item.price).toFixed(2)}
                      </p>
                    </div>
                    <p className="text-[10px] uppercase tracking-widest">
                      N${(item.price * item.quantity).toFixed(2)}
                    </p>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-widest">
                    <button
                      type="button"
                      onClick={() =>
                        updateCartQuantity(item.productId, item.color, -1)
                      }
                      className="border border-white/20 px-2 py-1"
                    >
                      -
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() =>
                        updateCartQuantity(item.productId, item.color, 1)
                      }
                      className="border border-white/20 px-2 py-1"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => removeCartItem(item.productId, item.color)}
                      className="ml-auto border border-red-400/40 px-2 py-1 text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
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
        <div className="fixed right-5 top-20 z-80">
          <div
            className={`min-w-64 border px-4 py-3 text-[10px] uppercase tracking-widest shadow-2xl ${
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
