import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './state/auth';
import { CartProvider } from './state/cart';
import { initCurrency } from './state/currency';
import { SettingsProvider } from './state/settings';
import { ToastProvider } from './state/toast';
import { WishlistProvider } from './state/wishlist';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/store.css';
import './styles/motion.css';
import './styles/premium.css';
import './styles/immersive.css';
import './styles/luxuryMotion.css';
import './styles/signature.css';
import './styles/celibery.css';
import './styles/commerce.css';
import './styles/structure.css';
import './styles/ugreen.css';

// Brand fonts load without blocking first paint (index.html marks the stylesheet media="print").
document.querySelector('link[data-brand-fonts]')?.setAttribute('media', 'all');

// Display currency: detection + rates load in the background (never blocks the first paint). The
// admin dashboard always works in SAR and does not need it.
if (!window.location.pathname.startsWith('/admin')) initCurrency();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SettingsProvider>
        <AuthProvider>
          <CartProvider>
            <WishlistProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </WishlistProvider>
          </CartProvider>
        </AuthProvider>
      </SettingsProvider>
    </BrowserRouter>
  </StrictMode>,
);
