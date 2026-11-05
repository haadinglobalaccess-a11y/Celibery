import { Icon } from '../components/Icon';

/**
 * A line icon given physical form: a bevelled tile with an extruded back plate, an inner light and
 * a lifted glyph (CSS 3D, preserve-3d). Turns toward the viewer on hover of its `.d-icon-host`
 * ancestor; static under reduced motion.
 */
export function DimensionalIcon({ name, tone = 'dark', size = 'md' }: { name: string; tone?: 'dark' | 'light' | 'accent'; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`d-icon d-icon--${tone} d-icon--${size}`} aria-hidden="true">
      <span className="d-icon__back" />
      <span className="d-icon__side" />
      <span className="d-icon__face">
        <Icon name={name} />
      </span>
    </span>
  );
}
