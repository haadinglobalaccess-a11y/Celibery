import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { StoreLayout } from './components/StoreLayout';
import { NotFound, Spinner } from './components/ui';
import { preferredLang } from './i18n/I18n';
import { AccountAddresses, AccountLayout, AccountOrderDetail, AccountOrders, AccountProfile, WishlistPage } from './pages/Account';
import { ForgotPassword, Login, Register, ResetPassword } from './pages/AuthPages';
import CartPage from './pages/CartPage';
import Checkout from './pages/Checkout';
import { CampaignPage, PolicyPage } from './pages/ContentPages';
import FaqPage from './pages/FaqPage';
import Home from './pages/Home';
import { CheckoutReturn, SandboxPay, TrackOrder } from './pages/OrderPages';
import ProductPage from './pages/ProductPage';
import Shop from './pages/Shop';

// The admin dashboard is a separate bundle, only downloaded by staff.
const AdminApp = lazy(() => import('./admin/AdminApp'));

/** Q35: keep old Shopify links working (/products/:handle, /collections/:handle). */
function LegacyRedirect({ kind }: { kind: 'product' | 'collection' }) {
  const { handle } = useParams();
  const lang = preferredLang();
  return <Navigate to={kind === 'product' ? `/${lang}/p/${handle}` : `/${lang}/c/${handle}`} replace />;
}

export default function App() {
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
