/**
 * CELIBERY immersive 3D layer (storefront only — the admin dashboard does not import this).
 * See docs/3D-EXPERIENCE.md for the design system, performance rules and how to add GLB models.
 *
 * Product3DStage and ThreeDScene are not re-exported here on purpose: they are loaded lazily by
 * CinematicHero so the WebGL code stays out of the main bundle.
 */
export { Ambient, bannerVideo, CinematicHero, useLinkFor } from './CinematicHero';
export { DimensionalIcon } from './DimensionalIcon';
export { hasWebGL, immersiveLevel, useImmersiveLevel, type ImmersiveLevel } from './env';
export { FloatingProduct } from './FloatingProduct';
export { flyToCart } from './flyToCart';
export { InteractiveProductGallery } from './InteractiveProductGallery';
export { PremiumButton, useMagnetic } from './PremiumButton';
export { ScrollScene, useScrollProgress } from './ScrollScene';
export { SpatialCarousel } from './SpatialCarousel';
export { TiltCard, useTilt } from './TiltCard';
