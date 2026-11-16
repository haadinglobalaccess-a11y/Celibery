import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { StoreLayout } from './components/StoreLayout';
import { NotFound, Spinner } from './components/ui';
import { preferredLang } from './i18n/I18n';
import CartPage from './pages/CartPage';
import Home from './pages/Home';
import ProductPage from './pages/ProductPage';
import Shop from './pages/Shop';

// The admin dashboard is a separate bundle, only downloaded by staff.
const AdminApp = lazy(() => import('./admin/AdminApp'));

/*
 * Landing pages (home, listings, product, bag) are in the main bundle: visitors arrive on them directly.
 * Pages reached after a click (checkout, account, sign-in, order status, FAQ, policies, campaigns) are
 * separate chunks, so the first visit parses less JavaScript. They are fetched in idle time right after
 * the first page has loaded (prefetchSecondaryPages), so moving on to them is still instant.
 */
const loadAccount = () => import('./pages/Account');
const loadAuth = () => import('./pages/AuthPages');
const loadCheckout = () => import('./pages/Checkout');
const loadOrders = () => import('./pages/OrderPages');
const loadContent = () => import('./pages/ContentPages');
const loadFaq = () => import('./pages/FaqPage');
const AccountLayout = lazy(() => loadAccount().then((m) => ({ default: m.AccountLayout })));
const AccountOrders = lazy(() => loadAccount().then((m) => ({ default: m.AccountOrders })));
const AccountOrderDetail = lazy(() => loadAccount().then((m) => ({ default: m.AccountOrderDetail })));
const AccountAddresses = lazy(() => loadAccount().then((m) => ({ default: m.AccountAddresses })));
const AccountProfile = lazy(() => loadAccount().then((m) => ({ default: m.AccountProfile })));
const WishlistPage = lazy(() => loadAccount().then((m) => ({ default: m.WishlistPage })));
const Login = lazy(() => loadAuth().then((m) => ({ default: m.Login })));
const Register = lazy(() => loadAuth().then((m) => ({ default: m.Register })));
const ForgotPassword = lazy(() => loadAuth().then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => loadAuth().then((m) => ({ default: m.ResetPassword })));
const Checkout = lazy(loadCheckout);
const CheckoutReturn = lazy(() => loadOrders().then((m) => ({ default: m.CheckoutReturn })));
const SandboxPay = lazy(() => loadOrders().then((m) => ({ default: m.SandboxPay })));
const TrackOrder = lazy(() => loadOrders().then((m) => ({ default: m.TrackOrder })));
const PolicyPage = lazy(() => loadContent().then((m) => ({ default: m.PolicyPage })));
const CampaignPage = lazy(() => loadContent().then((m) => ({ default: m.CampaignPage })));
const FaqPage = lazy(loadFaq);

let prefetched = false;
/** Downloads the secondary page chunks once the browser is idle after the first page load. */
export function prefetchSecondaryPages() {
  if (prefetched) return;
  prefetched = true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return; // honour Data Saver: chunks then load on navigation instead
  const run = () => {
    for (const load of [loadCheckout, loadAuth, loadAccount, loadOrders, loadContent, loadFaq]) void load().catch(() => undefined);
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const start = () => (idle ? idle(run, { timeout: 4000 }) : setTimeout(run, 1500));
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

/** Q35: keep old Shopify links working (/products/:handle, /collections/:handle). */
function LegacyRedirect({ kind }: { kind: 'product' | 'collection' }) {
  const { handle } = useParams();
  const lang = preferredLang();
  return <Navigate to={kind === 'product' ? `/${lang}/p/${handle}` : `/${lang}/c/${handle}`} replace />;
}

export default function App() {
  useEffect(() => {
    if (!window.location.pathname.startsWith('/admin')) prefetchSecondaryPages();
  }, []);
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/${preferredLang()}`} replace />} />
      <Route path="/faq" element={<Navigate to={`/${preferredLang()}/faq`} replace />} />
      <Route path="/products/:handle" element={<LegacyRedirect kind="product" />} />
      <Route path="/collections/:handle" element={<LegacyRedirect kind="collection" />} />
      <Route
        path="/admin/*"
        element={
          <Suspense fallback={<Spinner label="Loading admin…" />}>
            <AdminApp />
          </Suspense>
        }
      />
      <Route path="/:lang" element={<StoreLayout />}>
        <Route index element={<Home />} />
        <Route path="shop" element={<Shop mode="all" />} />
        <Route path="c/:slug" element={<Shop mode="category" />} />
        <Route path="collection/:slug" element={<Shop mode="collection" />} />
        <Route path="bundles" element={<Shop mode="collection" collectionSlug="bundles" />} />
        <Route path="search" element={<Shop mode="search" />} />
        <Route path="p/:slug" element={<ProductPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="checkout" element={<Checkout />} />
        <Route path="checkout/return" element={<CheckoutReturn />} />
        <Route path="sandbox-pay/:ref" element={<SandboxPay />} />
        <Route path="track" element={<TrackOrder />} />
        <Route path="wishlist" element={<WishlistPage />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password" element={<ResetPassword />} />
        <Route path="page/:slug" element={<PolicyPage />} />
        <Route path="faq" element={<FaqPage />} />
        <Route path="campaign/:slug" element={<CampaignPage />} />
        <Route path="account" element={<AccountLayout />}>
          <Route index element={<AccountOrders />} />
          <Route path="orders/:orderNumber" element={<AccountOrderDetail />} />
          <Route path="addresses" element={<AccountAddresses />} />
          <Route path="profile" element={<AccountProfile />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
