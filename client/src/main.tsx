import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './state/auth';
import { CartProvider } from './state/cart';
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
import './styles/productMotion.css';
import './styles/luxuryMotion.css';

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
